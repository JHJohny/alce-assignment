import { EnvironmentWrapper } from '@alma-cdk/project';
import { RegistryStack } from './stacks/image-registry-stack';
import { Construct } from 'constructs';
import { VpcStack } from './stacks/vpc-stack';
import { VpcDiscoveryStack } from './stacks/vpc-discovery-stack';
import { AppStack } from './stacks/app-stack';
import { IdentityStack } from './stacks/identity-stack';

export class Environment extends EnvironmentWrapper {
  constructor(scope: Construct) {
    super(scope);

    const cfg: any = (this as any).project?.accounts?.current?.config ?? {};

    new RegistryStack(this, 'Registry', {
      repositories: cfg.repositories ?? ['backend'],
      repoPrefix:  cfg.repoPrefix  ?? 'app',
      enablePullThroughCache: cfg.enablePullThroughCache ?? true,
      cachePrefix: cfg.cachePrefix ?? 'dockerhub',
      upstreamRegistryUrl: cfg.upstreamRegistryUrl ?? 'public.ecr.aws',  // Upstream just for this assignment, otherwise fully private ECR
      description: 'ECR repository',
    });

    const vpc = new VpcStack(this, 'Vpc', {
      description: 'Networking (VPC, subnets, gw, sg, ...)',

    });

    const discover = new VpcDiscoveryStack(this, 'VpcDiscovery', {
      description: 'Discovery/lookup of existing VPCs or metadata',

    });

    const app = new AppStack(this, 'App', {
      description: 'Main workload (ECS/Fargate, LB, CF, etc.)',

    });

    const identity = new IdentityStack(this, 'Identity', {
      description: 'Identity & authn (OAuth/OIDC/Cognito, ALB auth actions, etc.)',

    });

  }
}
