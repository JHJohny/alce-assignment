import { SmartStack } from '@alma-cdk/project';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as elbv2_actions from 'aws-cdk-lib/aws-elasticloadbalancingv2-actions';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';

export interface NetworkProps {
  cfEnabled: boolean;
  originSecretHeaderName?: string;
  originSecretHeaderValue?: string;  // TODO - move this to secret manager or rotate it somehow
}

export interface ScalingProps {
  minTasks: number;
  maxTasks: number;
  cpuTargetUtilizationPercent: number;
  cpuScaleInCooldownSec: number;
  cpuScaleOutCooldownSec: number;
  reqPerTargetPerMin: number;
  reqScaleInCooldownSec: number;
  reqScaleOutCooldownSec: number;
}

export interface CognitoProps {
  enabled: boolean;
  callbackUrls?: string[];
  publicPaths?: string[]; // '/health'
}

export interface CloudFrontProps {
  enabled: boolean;
  priceClass?: cloudfront.PriceClass;
  cachingDisabled?: boolean;
  cfWafEnabled?: boolean;
  exploitHeaderName?: string;  // 'x-exploit-activate'
}

export interface AppStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  albSubnets: ec2.SubnetSelection;
  appSubnets: ec2.SubnetSelection;
  interfaceEndpointSg: ec2.ISecurityGroup;

  repositories: string[];
  repoPrefix: string;
  imageTag: string;
  imagePortMap: Record<string, number>;
  healthCheckPath: string;
  containerEnv?: Record<string, string>;

  network: NetworkProps;
  scaling: ScalingProps;
  cognito?: CognitoProps;
  cloudfront?: CloudFrontProps;

  logRetentionDays?: logs.RetentionDays;
}

export class AppStack extends SmartStack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);

    const {
      vpc, albSubnets, appSubnets, interfaceEndpointSg,
      repositories, repoPrefix, imageTag, imagePortMap,
      healthCheckPath, containerEnv = {},
      network, scaling,
      cognito: cognitoProps = { enabled: false },
      cloudfront: cfProps = { enabled: false },
      logRetentionDays = logs.RetentionDays.ONE_MONTH,
    } = props;

    const namePrefix = `${repoPrefix}-${this.stackName}`;
    const albCert = acm.Certificate.fromCertificateArn(this, 'AlbCert', 'arn:aws:acm:eu-north-1:641691899998:certificate/54cf8a41-0681-4c8f-879e-664ed9c1ec21');
    const cfCert = acm.Certificate.fromCertificateArn(this, 'CfCertUSE1', 'arn:aws:acm:us-east-1:641691899998:certificate/f5e0c9f5-8e71-4eef-a635-e5b4c05c605b');

    const albSg = new ec2.SecurityGroup(this, 'AlbSg', { vpc, allowAllOutbound: true, description: 'ALB SG (public)' });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80),  'Public HTTP 80');
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Public HTTPS 443');

    const serviceSg = new ec2.SecurityGroup(this, 'ServiceSg', { vpc, allowAllOutbound: true, description: 'Service SG' });

    for (const name of repositories) {
      const port = imagePortMap[name];
      if (port == null) throw new Error(`imagePortMap missing port for repo "${name}"`);
      serviceSg.addIngressRule(albSg, ec2.Port.tcp(port), `ALB to ${name}:${port}`);
    }

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc, containerInsights: true, clusterName: `${namePrefix}-cluster`,
    });

    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    const taskExecRole = new iam.Role(this, 'TaskExecRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')],
    });

    const logGroup = new logs.LogGroup(this, 'AppLogs', { retention: logRetentionDays });

    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc, internetFacing: true, securityGroup: albSg, vpcSubnets: albSubnets,
      loadBalancerName: 'alb',
    });

    //const listener = alb.addListener(`Listener${network.albListenerPort}`, {
    //  port: network.albListenerPort,
    //  protocol: network.albProtocol,
    //  open: true,
    //});

    // https listener
    const httpsListener = alb.addListener('HttpsListener', {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificates: [elbv2.ListenerCertificate.fromArn(albCert.certificateArn)],
      open: true,
    });
    const httpListener = alb.addListener('HttpListener', { port: 80, protocol: elbv2.ApplicationProtocol.HTTP, open: true });
    httpListener.addAction('RedirectToHttps', {
      action: elbv2.ListenerAction.redirect({ protocol: 'HTTPS', port: '443', permanent: true }),
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Public HTTPS 443');

    let userPool: cognito.IUserPool | undefined;
    let userPoolClient: cognito.IUserPoolClient | undefined;
    let userPoolDomain: cognito.IUserPoolDomain | undefined;

    if (cognitoProps.enabled) {
      const up = new cognito.UserPool(this, 'UserPool', {
        selfSignUpEnabled: true,
        signInAliases: { email: true },
        standardAttributes: { email: { required: true, mutable: false } },
      });

    const upc = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: up,
      generateSecret: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
          // Maybe
          cognito.OAuthScope.COGNITO_ADMIN,
        ],
        callbackUrls: ['https://app.slavakia.com/oauth2/idpresponse'],
        logoutUrls:   ['https://app.slavakia.com/logout'],
      },
    });

      const upd = new cognito.UserPoolDomain(this, 'UserPoolDomain', {
        userPool: up,
        cognitoDomain: { domainPrefix: `${repoPrefix}-${this.node.addr}`.slice(0, 63) },
      });

      userPool = up; userPoolClient = upc; userPoolDomain = upd;
    }

    const services: { name: string; tg: elbv2.ApplicationTargetGroup }[] = [];
    let priority = 50;

    for (const name of repositories) {
      const port = imagePortMap[name]!;
      const td = new ecs.FargateTaskDefinition(this, `${name}TaskDef`, {
        cpu: 256, // TODO
        memoryLimitMiB: 512, // TODO
        executionRole: taskExecRole,
        taskRole,
        runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.X86_64 },
      });

      const repo = ecr.Repository.fromRepositoryName(this, `${name}Repo`, `${repoPrefix}/${name}`);

      td.addContainer(`${name}Container`, {
        image: ecs.ContainerImage.fromEcrRepository(repo, imageTag),
        portMappings: [{ containerPort: port }],
        logging: ecs.LogDrivers.awsLogs({ streamPrefix: name, logGroup }),
        environment: { ...containerEnv },
      });

      const svc = new ecs.FargateService(this, `${name}Service`, {
        cluster,
        taskDefinition: td,
        desiredCount: scaling.minTasks,
        assignPublicIp: false,
        securityGroups: [serviceSg],
        vpcSubnets: appSubnets,
        circuitBreaker: { enable: true, rollback: true },
        minHealthyPercent: 100,
        maxHealthyPercent: 200,
        serviceName: `${repoPrefix}-${name}`,
      });

      const tg = new elbv2.ApplicationTargetGroup(this, `${name}Tg`, {
        vpc,
        targetType: elbv2.TargetType.IP,
        port,
        protocol: elbv2.ApplicationProtocol.HTTP,
        healthCheck: {
          path: healthCheckPath,
          healthyHttpCodes: '200-399',
          interval: cdk.Duration.seconds(30),
        },
      });

      tg.enableCookieStickiness(cdk.Duration.minutes(5));
      tg.setAttribute('slow_start.duration_seconds', '30');

      svc.attachToApplicationTargetGroup(tg);

      const appPath = `/${name}/*`;
      if (cognitoProps.enabled && userPool && userPoolClient && userPoolDomain) {
        httpsListener.addAction(`${name}Rule`, {
          priority: priority++,
          conditions: [elbv2.ListenerCondition.pathPatterns([appPath])],
          action: new elbv2_actions.AuthenticateCognitoAction({
            userPool,
            userPoolClient,
            userPoolDomain,
            sessionTimeout: cdk.Duration.hours(8),
            next: elbv2.ListenerAction.forward([tg]),
          }),
        });
      } else {
        httpsListener.addAction(`${name}Rule`, {
          priority: priority++,
          conditions: [elbv2.ListenerCondition.pathPatterns([appPath])],
          action: elbv2.ListenerAction.forward([tg]),
        });
      }

      const scalable = svc.autoScaleTaskCount({
        minCapacity: scaling.minTasks,
        maxCapacity: scaling.maxTasks,
      });

      scalable.scaleOnCpuUtilization(`${name}CpuScale`, {
        targetUtilizationPercent: scaling.cpuTargetUtilizationPercent,
        scaleInCooldown: cdk.Duration.seconds(scaling.cpuScaleInCooldownSec),
        scaleOutCooldown: cdk.Duration.seconds(scaling.cpuScaleOutCooldownSec),
      });

      scalable.scaleOnRequestCount(`${name}ReqScale`, {
        requestsPerTarget: scaling.reqPerTargetPerMin,
        targetGroup: tg,
        scaleInCooldown: cdk.Duration.seconds(scaling.reqScaleInCooldownSec),
        scaleOutCooldown: cdk.Duration.seconds(scaling.reqScaleOutCooldownSec),
      });

      services.push({ name, tg });
    }

    if (cognitoProps.enabled && cognitoProps.publicPaths?.length) {
      let p = 2;
      for (const pub of cognitoProps.publicPaths) {
        httpsListener.addAction(`Public-${p}`, {
          priority: p++,
          conditions: [elbv2.ListenerCondition.pathPatterns([pub])],
          action: elbv2.ListenerAction.fixedResponse(200, {
            contentType: 'text/plain',
            messageBody: 'OK',
          }),
        });
      }
    }

    if (services.length > 0) {
      const defaultTg = services[0].tg;

      if (cognitoProps.enabled && userPool && userPoolClient && userPoolDomain) {
        httpsListener.addAction('Default', {
          action: new elbv2_actions.AuthenticateCognitoAction({
            userPool,
            userPoolClient,
            userPoolDomain,
            sessionTimeout: cdk.Duration.hours(8),
            next: elbv2.ListenerAction.forward([defaultTg]),
          }),
        });
      } else {
        httpsListener.addAction('Default', {
          action: elbv2.ListenerAction.forward([defaultTg]),
        });
      }
    }

    if (network.cfEnabled && cfProps.enabled) {
      if (!network.originSecretHeaderName || !network.originSecretHeaderValue) {
        throw new Error('CloudFront origin lock requires originSecretHeaderName & originSecretHeaderValue');
      }

      const albWaf = new wafv2.CfnWebACL(this, 'AlbWebAcl', {
        scope: 'REGIONAL',
        defaultAction: { block: {} },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: `${namePrefix}-AlbWaf`,
          sampledRequestsEnabled: true
        },
        rules: [{
          name: `${namePrefix}-AllowFromCF`,
          priority: 0,
          action: { allow: {} },
          statement: {
            byteMatchStatement: {
              fieldToMatch: { singleHeader: { Name: network.originSecretHeaderName.toLowerCase() } },
              positionalConstraint: 'EXACTLY',
              searchString: network.originSecretHeaderValue,
              textTransformations: [{ priority: 0, type: 'NONE' }],
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${namePrefix}-AllowCFOnly`,
            sampledRequestsEnabled: true
          },
        }],
      });

      new wafv2.CfnWebACLAssociation(this, 'AlbWafAssoc', {
        resourceArn: alb.loadBalancerArn,
        webAclArn: albWaf.attrArn,
      });

      const isUsEast1 = cdk.Stack.of(this).region === 'us-east-1';
      const cfWaf = (cfProps.cfWafEnabled && isUsEast1)
        ? new wafv2.CfnWebACL(this, 'CfWebAcl', {
            scope: 'CLOUDFRONT',
            defaultAction: { allow: {} },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: `${namePrefix}-CfWaf`,
              sampledRequestsEnabled: true
            },
            rules: cfProps.exploitHeaderName ? [{
              name: `${namePrefix}-BlockExploitHeader`,
              priority: 0,
              action: { block: {} },
              statement: {
                byteMatchStatement: {
                  fieldToMatch: { singleHeader: { Name: cfProps.exploitHeaderName.toLowerCase() } },
                  positionalConstraint: 'EXACTLY',
                  searchString: 'true',
                  textTransformations: [{ priority: 0, type: 'NONE' }],
                },
              },
              visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: `${namePrefix}-BlockExploitHeader`,
                sampledRequestsEnabled: true
              },
            }] : [],
          })
        : undefined;

      const distribution = new cloudfront.Distribution(this, 'Distribution', {
        domainNames: ['app.slavakia.com'],
        certificate: cfCert,
        defaultBehavior: {
          origin: new origins.HttpOrigin('origin.slavakia.com', {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
            customHeaders: { [network.originSecretHeaderName]: network.originSecretHeaderValue },
            connectionAttempts: 3,
            connectionTimeout: cdk.Duration.seconds(10),
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          //cachePolicy: cfProps.cachingDisabled !== false
          //  ? cloudfront.CachePolicy.CACHING_DISABLED
          //  : cloudfront.CachePolicy.CACHING_OPTIMIZED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        },
        enableLogging: true,
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
        webAclId: cfWaf ? cfWaf.attrArn : undefined,
        priceClass: cfProps.priceClass ?? cloudfront.PriceClass.PRICE_CLASS_100,
        comment: `${namePrefix} distribution`,
      });

      new cdk.CfnOutput(this, 'CloudFrontDomain', { value: distribution.distributionDomainName });

    }

    new cdk.CfnOutput(this, 'AlbDnsName', { value: alb.loadBalancerDnsName });
  }
}
