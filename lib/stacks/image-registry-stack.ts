import { SmartStack, EC } from '@alma-cdk/project';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';

export interface RegistryStackProps extends cdk.StackProps {
  repositories: string[];
  repoPrefix?: string;

  enablePullThroughCache?: boolean;
  cachePrefix?: string;
  upstreamRegistryUrl?: string;
}

export class RegistryStack extends SmartStack {
  constructor(scope: Construct, id: string, props: RegistryStackProps) {
    super(scope, id, props);

    const {
      repositories,
      repoPrefix = 'app',
      enablePullThroughCache = false,
      cachePrefix = 'dockerhub',
      upstreamRegistryUrl = 'registry-1.docker.io',  // Just for this assignment, otherwise I expect fully private ECR
    } = props;

    const isStable = EC.isStable(this);
    const removalPolicy = isStable ? cdk.RemovalPolicy.RETAIN
                                   : cdk.RemovalPolicy.DESTROY;
    const tagMutability = isStable ? ecr.TagMutability.IMMUTABLE
                                   : ecr.TagMutability.MUTABLE;
    const lifecycleRules: ecr.LifecycleRule[] = isStable
    ? [
      { tagStatus: ecr.TagStatus.UNTAGGED, maxImageCount: 5 },
      ]
    : [
      { tagStatus: ecr.TagStatus.UNTAGGED, maxImageCount: 3 },
      { tagStatus: ecr.TagStatus.TAGGED, maxImageCount: 6 },
    ];
    const scanOnPush = true;

    for (const rawName of repositories) {
      const component = rawName.toLowerCase();
      const repositoryName = `${repoPrefix.toLowerCase()}/${component}`;

      const repo = new ecr.Repository(this, `${component}Repo`, {
        repositoryName,
        imageScanOnPush: scanOnPush,
        imageTagMutability: tagMutability,
        encryption: ecr.RepositoryEncryption.AES_256,
        lifecycleRules,
        removalPolicy,
      });

      new cdk.CfnOutput(this, `${component}RepoUri`, {
        value: repo.repositoryUri,
        exportName: `${this.stackName}-${component}-repo-uri`,
      });
    }

    if (enablePullThroughCache) {
      new ecr.CfnPullThroughCacheRule(this, 'PullThroughCache', {
        ecrRepositoryPrefix: cachePrefix.toLowerCase(),
        upstreamRegistryUrl,
      });

      new cdk.CfnOutput(this, 'CacheUsageHint', {
        value: `${this.account}.dkr.ecr.${this.region}.amazonaws.com/${cachePrefix.toLowerCase()}/<namespace>/<name>:<tag>`,
      });
    }
  }
}
