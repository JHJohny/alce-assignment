import { EnvironmentWrapper, EC } from '@alma-cdk/project';
import { Construct } from 'constructs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';

import { RegistryStack } from './stacks/image-registry-stack';
import { VpcStack } from './stacks/vpc-stack';
import { VpcDiscoveryStack } from './stacks/vpc-discovery-stack';
import { AppStack } from './stacks/app-stack';
import { IdentityStack } from './stacks/identity-stack';

export class Environment extends EnvironmentWrapper {
  constructor(scope: Construct) {
    super(scope);

    const cfg: any = (this as any).project?.accounts?.current?.config ?? {};

    const registry = new RegistryStack(this, 'Registry', {
      repositories: cfg.repositories ?? ['backend'],
      repoPrefix:  cfg.repoPrefix  ?? 'app',
      enablePullThroughCache: cfg.enablePullThroughCache ?? true,
      cachePrefix: cfg.cachePrefix ?? 'dockerhub',
      upstreamRegistryUrl: cfg.upstreamRegistryUrl ?? 'public.ecr.aws',  // Upstream just for this assignment, otherwise fully private ECR
      description: 'ECR repository',
    });

    const vpc = new VpcStack(this, 'Vpc', {
      repoPrefix:  cfg.repoPrefix  ?? 'app',
      cidr: cfg.vpc?.cidr ?? '10.0.0.0/16',
      maxAzs: cfg.vpc?.maxAzs ?? 2,
      natGateways: cfg.vpc?.natGateways ?? 0,
      enableS3Gateway: cfg.vpc?.enableS3Gateway ?? true,
      enableEcrEndpoints: cfg.vpc?.enableEcrEndpoints ?? true,
      enableLogsEndpoint: cfg.vpc?.enableLogsEndpoint ?? true,
      description: 'VPC (public + private isolated) + endpoints for ECR/S3/Logs',
    });

    const discover = new VpcDiscoveryStack(this, 'VpcDiscovery', {
      description: 'Discovery/lookup of existing VPCs or metadata',

    });

    const isStable = EC.isStable(this);

    const originSecretHeaderName = cfg.network?.originSecretHeaderName ?? 'x-origin-secret';
    const originSecretHeaderValue =
      cfg.network?.originSecretHeaderValue ??
      `cf-${cfg.repoPrefix ?? 'app'}-${this.node.addr}`;

    new AppStack(this, 'App', {
      vpc: vpc.vpc,
      albSubnets: vpc.albSubnets,
      appSubnets: vpc.appSubnets,
      interfaceEndpointSg: vpc.interfaceEndpointSg,

      repositories: cfg.repositories ?? ['backend'],
      repoPrefix: cfg.repoPrefix ?? 'app',
      imageTag: cfg.imageTag ?? (isStable ? 'latest' : 'dev'),
      imagePortMap: cfg.imagePortMap ?? { backend: 8080 },

      healthCheckPath: cfg.healthCheckPath ?? '/health',
      containerEnv: cfg.containerEnv ?? { NODE_ENV: isStable ? 'production' : 'development' },

      network: {
        albListenerPort: cfg.network?.albListenerPort ?? 8080,
        albProtocol: cfg.network?.albProtocol ?? elbv2.ApplicationProtocol.HTTP,
        cfEnabled: true, //cfg.network?.cfEnabled ?? isStable,
        cfOriginHttpPort: cfg.network?.cfOriginHttpPort ?? (cfg.network?.albListenerPort ?? 8080),
        originSecretHeaderName,
        originSecretHeaderValue,
      },

      scaling: {
        minTasks: cfg.scaling?.minTasks ?? (isStable ? 2 : 1),
        maxTasks: cfg.scaling?.maxTasks ?? (isStable ? 6 : 2),
        cpuTargetUtilizationPercent: cfg.scaling?.cpuTargetUtilizationPercent ?? 60,
        cpuScaleInCooldownSec: cfg.scaling?.cpuScaleInCooldownSec ?? 60,
        cpuScaleOutCooldownSec: cfg.scaling?.cpuScaleOutCooldownSec ?? 30,
        reqPerTargetPerMin: cfg.scaling?.reqPerTargetPerMin ?? (isStable ? 120 : 100),
        reqScaleInCooldownSec: cfg.scaling?.reqScaleInCooldownSec ?? 60,
        reqScaleOutCooldownSec: cfg.scaling?.reqScaleOutCooldownSec ?? 30,
      },

      // “Use Cognito to process user logins”
      cognito: {
        enabled: true, //cfg.cognito?.enabled ?? isStable,
        publicPaths: cfg.cognito?.publicPaths ?? ['/health'],
      },

      cloudfront: {
        enabled: true,
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
        cachingDisabled: true,
        cfWafEnabled: true,
        exploitHeaderName: 'x-exploit-activate',
      },

      description: 'Application tier (ALB + ECS/Fargate + Cognito + optional CloudFront)',
    });

    const identity = new IdentityStack(this, 'Identity', {
      description: 'Identity & authn (OAuth/OIDC/Cognito, ALB auth actions, etc.)',

    });

  }
}
