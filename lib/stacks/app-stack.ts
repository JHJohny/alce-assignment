import { SmartStack } from '@alma-cdk/project';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
// import * as ec2 from 'aws-cdk-lib/aws-ec2';
// import * as ecs from 'aws-cdk-lib/aws-ecs';
// import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
// import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';

export interface AppStackProps extends cdk.StackProps {

}

export class AppStack extends SmartStack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);

    // TODO
  }
}
