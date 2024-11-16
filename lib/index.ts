// import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export interface TemplateProps {
  // Define construct properties here
}

export class Template extends Construct {

  constructor(scope: Construct, id: string, props: TemplateProps = {}) {
    super(scope, id);

    // Define construct contents here

    // example resource
    // const queue = new sqs.Queue(this, 'TemplateQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });
  }
}
