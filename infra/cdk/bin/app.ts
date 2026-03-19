#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack.js';
import { DataStack } from '../lib/data-stack.js';
import { AuthStack } from '../lib/auth-stack.js';
import { IotStack } from '../lib/iot-stack.js';
import { ServicesStack } from '../lib/services-stack.js';
import { FrontendStack } from '../lib/frontend-stack.js';

const app = new cdk.App();
const env = { account: process.env.AWS_ACCOUNT_ID!, region: 'ap-south-1' };
const tags = { Project: 'CommunityGate', Environment: process.env.ENVIRONMENT || 'dev' };

const net = new NetworkStack(app, 'CommunityGateNetwork', { env, tags });
const data = new DataStack(app, 'CommunityGateData', { env, tags, vpc: net.vpc });
const auth = new AuthStack(app, 'CommunityGateAuth', { env, tags });
const iot = new IotStack(app, 'CommunityGateIot', { env, tags });
const svc = new ServicesStack(app, 'CommunityGateServices', {
  env, tags, vpc: net.vpc, cluster: net.cluster,
  database: data.database, redis: data.redis, s3Bucket: data.mediaBucket,
  userPool: auth.residentPool, iotEndpoint: iot.iotEndpoint,
});
const fe = new FrontendStack(app, 'CommunityGateFrontend', { env, tags });
