import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export class AuthStack extends cdk.Stack {
  public readonly residentPool: cognito.UserPool;
  public readonly adminPool: cognito.UserPool;
  public readonly residentClient: cognito.UserPoolClient;
  public readonly adminClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Resident User Pool — phone OTP sign-in
    this.residentPool = new cognito.UserPool(this, 'ResidentPool', {
      userPoolName: 'communitygate-residents',
      selfSignUpEnabled: true,
      signInAliases: {
        phone: true,
      },
      autoVerify: {
        phone: true,
      },
      standardAttributes: {
        phoneNumber: { required: true, mutable: true },
        fullname: { required: true, mutable: true },
      },
      mfa: cognito.Mfa.OFF,
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: false,
        requireUppercase: false,
      },
      accountRecovery: cognito.AccountRecovery.PHONE_ONLY_WITHOUT_MFA,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.residentClient = this.residentPool.addClient('ResidentAppClient', {
      userPoolClientName: 'communitygate-resident-app',
      authFlows: {
        custom: true,
        userSrp: true,
      },
      preventUserExistenceErrors: true,
    });

    // Admin User Pool — email + MFA
    this.adminPool = new cognito.UserPool(this, 'AdminPool', {
      userPoolName: 'communitygate-admins',
      selfSignUpEnabled: false,
      signInAliases: {
        email: true,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: true, mutable: true },
      },
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: {
        sms: true,
        otp: true,
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: true,
        requireUppercase: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.adminClient = this.adminPool.addClient('AdminPortalClient', {
      userPoolClientName: 'communitygate-admin-portal',
      authFlows: {
        userSrp: true,
      },
      preventUserExistenceErrors: true,
    });

    // Outputs
    new cdk.CfnOutput(this, 'ResidentPoolId', {
      value: this.residentPool.userPoolId,
    });
    new cdk.CfnOutput(this, 'ResidentClientId', {
      value: this.residentClient.userPoolClientId,
    });
    new cdk.CfnOutput(this, 'AdminPoolId', {
      value: this.adminPool.userPoolId,
    });
    new cdk.CfnOutput(this, 'AdminClientId', {
      value: this.adminClient.userPoolClientId,
    });
  }
}
