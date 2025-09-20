import { SmartStack } from '@alma-cdk/project';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';

export interface VpcDiscoveryStackProps extends cdk.StackProps {

}

export class VpcDiscoveryStack extends SmartStack {
  constructor(scope: Construct, id: string, props?: VpcDiscoveryStackProps) {
    super(scope, id, props);

    // TODO
  }
}
