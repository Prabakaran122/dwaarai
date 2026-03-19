import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface ServicesStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  cluster: ecs.Cluster;
  database: rds.DatabaseInstance;
  redis: elasticache.CfnCacheCluster;
  s3Bucket: s3.Bucket;
  userPool: cognito.UserPool;
  iotEndpoint: string;
}

const MICROSERVICES = [
  'api-gateway',
  'vehicle-service',
  'visitor-service',
  'gate-command-service',
  'notification-service',
  'audit-service',
  'anpr-service',
] as const;

export class ServicesStack extends cdk.Stack {
  public readonly alb: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: ServicesStackProps) {
    super(scope, id, props);

    const { vpc, cluster, database, redis, s3Bucket, userPool, iotEndpoint } = props;

    // Shared environment variables for all services
    const sharedEnv: Record<string, string> = {
      NODE_ENV: props.tags?.Environment ?? process.env.ENVIRONMENT ?? 'dev',
      AWS_REGION: 'ap-south-1',
      DB_HOST: database.dbInstanceEndpointAddress,
      DB_PORT: database.dbInstanceEndpointPort,
      DB_NAME: 'communitygate',
      REDIS_HOST: redis.attrRedisEndpointAddress,
      REDIS_PORT: redis.attrRedisEndpointPort,
      S3_MEDIA_BUCKET: s3Bucket.bucketName,
      COGNITO_USER_POOL_ID: userPool.userPoolId,
      IOT_ENDPOINT: iotEndpoint,
    };

    // Security group for Fargate services
    const serviceSecurityGroup = new ec2.SecurityGroup(this, 'ServiceSecurityGroup', {
      vpc,
      description: 'Security group for CommunityGate Fargate services',
      allowAllOutbound: true,
    });

    // ALB for api-gateway
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'ApiAlb', {
      vpc,
      internetFacing: true,
      loadBalancerName: 'communitygate-api',
    });

    const listener = this.alb.addListener('HttpListener', {
      port: 80,
      defaultAction: elbv2.ListenerAction.fixedResponse(404, {
        contentType: 'text/plain',
        messageBody: 'Not Found',
      }),
    });

    // Create a Fargate service for each microservice
    for (const serviceName of MICROSERVICES) {
      const sanitizedName = serviceName.replace(/-/g, '');

      const taskDefinition = new ecs.FargateTaskDefinition(this, `${sanitizedName}Task`, {
        memoryLimitMiB: 512,
        cpu: 256, // 0.25 vCPU
      });

      const container = taskDefinition.addContainer(`${sanitizedName}Container`, {
        image: ecs.ContainerImage.fromRegistry(`communitygate/${serviceName}:latest`),
        environment: sharedEnv,
        logging: ecs.LogDrivers.awsLogs({
          streamPrefix: serviceName,
          logGroup: new logs.LogGroup(this, `${sanitizedName}Logs`, {
            logGroupName: `/communitygate/${serviceName}`,
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
          }),
        }),
        portMappings: [{ containerPort: 3000, protocol: ecs.Protocol.TCP }],
      });

      const fargateService = new ecs.FargateService(this, `${sanitizedName}Service`, {
        cluster,
        taskDefinition,
        desiredCount: 1,
        securityGroups: [serviceSecurityGroup],
        assignPublicIp: false,
        serviceName: `communitygate-${serviceName}`,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      });

      // Auto-scale on CPU 70%
      const scaling = fargateService.autoScaleTaskCount({
        minCapacity: 1,
        maxCapacity: 4,
      });
      scaling.scaleOnCpuUtilization(`${sanitizedName}CpuScaling`, {
        targetUtilizationPercent: 70,
        scaleInCooldown: cdk.Duration.seconds(60),
        scaleOutCooldown: cdk.Duration.seconds(60),
      });

      // Grant S3 access
      s3Bucket.grantReadWrite(taskDefinition.taskRole);

      // Register api-gateway with ALB
      if (serviceName === 'api-gateway') {
        const targetGroup = new elbv2.ApplicationTargetGroup(this, 'ApiGatewayTargetGroup', {
          vpc,
          port: 3000,
          protocol: elbv2.ApplicationProtocol.HTTP,
          targets: [fargateService],
          healthCheck: {
            path: '/health',
            interval: cdk.Duration.seconds(30),
            timeout: cdk.Duration.seconds(5),
          },
        });

        listener.addAction('ApiGatewayRoute', {
          priority: 1,
          conditions: [elbv2.ListenerCondition.pathPatterns(['/api/*', '/health'])],
          action: elbv2.ListenerAction.forward([targetGroup]),
        });
      }
    }

    // Outputs
    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: this.alb.loadBalancerDnsName,
    });
    new cdk.CfnOutput(this, 'AlbArn', {
      value: this.alb.loadBalancerArn,
    });
  }
}
