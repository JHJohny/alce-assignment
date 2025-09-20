import { SmartStack } from '@alma-cdk/project';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';

export interface VpcStackProps extends cdk.StackProps {

}

export class VpcStack extends SmartStack {

  constructor(scope: Construct, id: string, props: VpcStackProps) {
    super(scope, id, props);

    // TODO
  }
}
