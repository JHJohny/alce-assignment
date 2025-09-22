import { SmartStack } from '@alma-cdk/project';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface VpcStackProps extends cdk.StackProps {
  repoPrefix: string;
  cidr: string;
  maxAzs: number;
  natGateways: number;
  enableS3Gateway: boolean;
  enableEcrEndpoints: boolean;
  enableLogsEndpoint: boolean;
}

export class VpcStack extends SmartStack {
  public readonly vpc: ec2.Vpc;
  public readonly albSubnets: ec2.SubnetSelection;
  public readonly appSubnets: ec2.SubnetSelection;
  public readonly interfaceEndpointSg: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: VpcStackProps) {
    super(scope, id, props);

    const {
      repoPrefix, cidr, maxAzs, natGateways,
      enableS3Gateway, enableEcrEndpoints, enableLogsEndpoint
    } = props;

    const publicSubnetGroupName = `${repoPrefix}Public`;
    const privateSubnetGroupName = `${repoPrefix}Private`;
    const useNat = natGateways > 0;

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr(cidr),
      maxAzs,
      natGateways,
      enableDnsSupport: true,
      enableDnsHostnames: true,
      subnetConfiguration: [
        { name: publicSubnetGroupName, subnetType: ec2.SubnetType.PUBLIC },
        { name: privateSubnetGroupName, subnetType: useNat ? ec2.SubnetType.PRIVATE_WITH_EGRESS : ec2.SubnetType.PRIVATE_ISOLATED }
      ]
    });

    this.albSubnets = { subnetGroupName: publicSubnetGroupName };
    this.appSubnets = { subnetGroupName: privateSubnetGroupName };

    this.interfaceEndpointSg = new ec2.SecurityGroup(this, 'InterfaceEndpointSg', {
      vpc: this.vpc,
      description: 'Interface VPC Endpoints SG',
      allowAllOutbound: true
    });

    // TODO - do explicitly resources as well, not just IP
    this.interfaceEndpointSg.addIngressRule(ec2.Peer.ipv4(this.vpc.vpcCidrBlock), ec2.Port.tcp(443), 'HTTPS from VPC');

    if (enableS3Gateway) {
      const s3Ep = this.vpc.addGatewayEndpoint('S3Endpoint', {
        service: ec2.GatewayVpcEndpointAwsService.S3
      });
      s3Ep.addToPolicy(new iam.PolicyStatement({
        principals: [new iam.AnyPrincipal()],
        actions: ['s3:GetObject', 's3:HeadObject'],
        resources: ['arn:aws:s3:::prod-eu-north-1-starport-layer-bucket/*'],
        conditions: {
          StringEquals: {
            'aws:PrincipalAccount': this.account,
            // TODO - endpoint as well
          },
        },
      }));
    }

    const endpointSubnets = { subnetGroupName: privateSubnetGroupName };

    if (enableEcrEndpoints) {
      this.vpc.addInterfaceEndpoint('EcrApiEndpoint', {
        service: ec2.InterfaceVpcEndpointAwsService.ECR,
        subnets: endpointSubnets,
        privateDnsEnabled: true,
        securityGroups: [this.interfaceEndpointSg]
      });
      this.vpc.addInterfaceEndpoint('EcrDkrEndpoint', {
        service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
        subnets: endpointSubnets,
        privateDnsEnabled: true,
        securityGroups: [this.interfaceEndpointSg]
      });
    }

    if (enableLogsEndpoint) {
      this.vpc.addInterfaceEndpoint('LogsEndpoint', {
        service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
        subnets: endpointSubnets,
        privateDnsEnabled: true,
        securityGroups: [this.interfaceEndpointSg]
      });
    }

    this.vpc.addInterfaceEndpoint('EcsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.ECS,
      subnets: endpointSubnets,
      privateDnsEnabled: true,
      securityGroups: [this.interfaceEndpointSg]
    });
    this.vpc.addInterfaceEndpoint('EcsAgentEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.ECS_AGENT,
      subnets: endpointSubnets,
      privateDnsEnabled: true,
      securityGroups: [this.interfaceEndpointSg]
    });
    this.vpc.addInterfaceEndpoint('EcsTelemetryEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.ECS_TELEMETRY,
      subnets: endpointSubnets,
      privateDnsEnabled: true,
      securityGroups: [this.interfaceEndpointSg]
    });
    this.vpc.addInterfaceEndpoint('StsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.STS,
      subnets: endpointSubnets,
      privateDnsEnabled: true,
      securityGroups: [this.interfaceEndpointSg]
    });

    const flowLogGroup = new logs.LogGroup(this, 'VpcFlowLogs', {
      retention: logs.RetentionDays.ONE_MONTH // TODO - move it to config and based on env
    });
    new ec2.FlowLog(this, 'VpcFlowLogsToCw', {
      resourceType: ec2.FlowLogResourceType.fromVpc(this.vpc),
      destination: ec2.FlowLogDestination.toCloudWatchLogs(flowLogGroup),
      trafficType: ec2.FlowLogTrafficType.ALL
    });

    new cdk.CfnOutput(this, 'VpcId', { value: this.vpc.vpcId });
    new cdk.CfnOutput(this, 'PublicSubnetIds', {
      value: this.vpc.selectSubnets(this.albSubnets).subnetIds.join(',')
    });
    new cdk.CfnOutput(this, 'PrivateSubnetIds', {
      value: this.vpc.selectSubnets(this.appSubnets).subnetIds.join(',')
    });
  }
}
