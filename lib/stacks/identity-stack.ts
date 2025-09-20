import { SmartStack } from '@alma-cdk/project';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
// import * as cognito from 'aws-cdk-lib/aws-cognito';
// import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
// import * as actions from 'aws-cdk-lib/aws-elasticloadbalancingv2-actions';

export interface IdentityStackProps extends cdk.StackProps {

}

export class IdentityStack extends SmartStack {
  constructor(scope: Construct, id: string, props: IdentityStackProps) {
    super(scope, id, props);

    // TODO
  }
}
