#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AardvarkAppStack } from '../lib/aardvark-app-stack';

const app = new cdk.App();
new AardvarkAppStack(app, 'AardvarkAppStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'ca-central-1',
  },
});

app.synth();
