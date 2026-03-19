import * as cdk from 'aws-cdk-lib';
import * as iot from 'aws-cdk-lib/aws-iot';
import { Construct } from 'constructs';

export class IotStack extends cdk.Stack {
  public readonly iotEndpoint: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // IoT Policy for edge devices
    new iot.CfnPolicy(this, 'EdgeDevicePolicy', {
      policyName: 'CommunityGateEdgePolicy',
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'iot:Connect',
            Resource: `arn:aws:iot:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:client/cg-*`,
          },
          {
            Effect: 'Allow',
            Action: 'iot:Publish',
            Resource: `arn:aws:iot:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:topic/cg/*`,
          },
          {
            Effect: 'Allow',
            Action: 'iot:Subscribe',
            Resource: `arn:aws:iot:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:topicfilter/cg/*`,
          },
          {
            Effect: 'Allow',
            Action: 'iot:Receive',
            Resource: `arn:aws:iot:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:topic/cg/*`,
          },
        ],
      },
    });

    // IoT endpoint — use a placeholder since the actual endpoint is account-specific
    // and discovered at runtime via `aws iot describe-endpoint`
    this.iotEndpoint = `${cdk.Aws.ACCOUNT_ID}-ats.iot.${cdk.Aws.REGION}.amazonaws.com`;

    // Outputs
    new cdk.CfnOutput(this, 'IotEndpoint', {
      value: this.iotEndpoint,
      description: 'IoT Core endpoint (placeholder — use aws iot describe-endpoint for actual value)',
    });
    new cdk.CfnOutput(this, 'EdgePolicyName', {
      value: 'CommunityGateEdgePolicy',
    });
  }
}
