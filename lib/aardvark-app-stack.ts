import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export class AardvarkAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = ec2.Vpc.fromLookup(this, 'AardvarkVpc', {
      vpcId: 'vpc-3cb0c054',
    });

    const cluster = new ecs.Cluster(this, 'AardvarkCluster', {
      vpc,
      clusterName: 'aardvark-app-cluster',
    });

    const autoScalingGroup = cluster.addCapacity('AardvarkAutoScalingGroup', {
      instanceType: new ec2.InstanceType('t3.micro'),
      minCapacity: 1,
      maxCapacity: 3,
      desiredCapacity: 1,
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    });

    autoScalingGroup.addUserData(
      'yum update -y',
      'yum install -y docker',
      'systemctl start docker',
      'systemctl enable docker',
      'usermod -a -G docker ec2-user',
      'echo ECS_CLUSTER=aardvark-app-cluster >> /etc/ecs/ecs.config',
      'echo ECS_ENABLE_CONTAINER_INSIGHTS=true >> /etc/ecs/ecs.config'
    );

    const logGroup = new logs.LogGroup(this, 'AardvarkLogGroup', {
      logGroupName: '/ecs/aardvark-app',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // --- RDS MySQL ---
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'AardvarkDbSecurityGroup', {
      vpc,
      description: 'Allow MySQL access from ECS instances',
      allowAllOutbound: false,
    });

    dbSecurityGroup.addIngressRule(
      autoScalingGroup.connections.securityGroups[0],
      ec2.Port.tcp(3306),
      'MySQL from ECS'
    );

    const database = new rds.DatabaseInstance(this, 'AardvarkDatabase', {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      credentials: rds.Credentials.fromGeneratedSecret('aardvark_admin', {
        secretName: 'aardvark-app/db',
      }),
      databaseName: 'aardvark',
      storageEncrypted: true,
      allocatedStorage: 20,
      maxAllocatedStorage: 50,
      securityGroups: [dbSecurityGroup],
      publiclyAccessible: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
    });

    // Reference existing Slack credentials in Secrets Manager (created via AWS CLI)
    const slackSecret = secretsmanager.Secret.fromSecretNameV2(this, 'AardvarkSlackSecret', 'aardvark-app/slack');

    const taskDefinition = new ecs.Ec2TaskDefinition(this, 'AardvarkTaskDefinition', {
      family: 'aardvark-app',
    });

    const container = taskDefinition.addContainer('AardvarkContainer', {
      image: ecs.ContainerImage.fromEcrRepository(
        ecr.Repository.fromRepositoryName(this, 'AardvarkRepo', 'aardvark-app'),
        'latest'
      ),
      memoryLimitMiB: 256,
      cpu: 128,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'aardvark-app',
        logGroup,
      }),
      environment: {
        NODE_ENV: 'production',
      },
      secrets: {
        SLACK_BOT_TOKEN: ecs.Secret.fromSecretsManager(slackSecret, 'SLACK_BOT_TOKEN'),
        SLACK_SIGNING_SECRET: ecs.Secret.fromSecretsManager(slackSecret, 'SLACK_SIGNING_SECRET'),
        SLACK_CLIENT_ID: ecs.Secret.fromSecretsManager(slackSecret, 'SLACK_CLIENT_ID'),
        SLACK_CLIENT_SECRET: ecs.Secret.fromSecretsManager(slackSecret, 'SLACK_CLIENT_SECRET'),
        DB_SECRET: ecs.Secret.fromSecretsManager(database.secret!),
      },
    });

    container.addPortMappings({
      containerPort: 80,
      hostPort: 0,
      protocol: ecs.Protocol.TCP,
    });

    const loadBalancer = new ecsPatterns.ApplicationLoadBalancedEc2Service(this, 'AardvarkAlbService', {
      cluster,
      taskDefinition,
      serviceName: 'aardvark-alb-service',
      desiredCount: 1,
      publicLoadBalancer: true,
      listenerPort: 80,
    });

    loadBalancer.targetGroup.configureHealthCheck({
      path: '/health',
      healthyHttpCodes: '200',
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    });

    new cdk.CfnOutput(this, 'AardvarkClusterName', {
      value: cluster.clusterName,
      description: 'Aardvark App ECS Cluster Name',
    });

    new cdk.CfnOutput(this, 'AardvarkLoadBalancerUrl', {
      value: `http://${loadBalancer.loadBalancer.loadBalancerDnsName}`,
      description: 'Aardvark App Load Balancer URL',
    });

    new cdk.CfnOutput(this, 'AardvarkVpcId', {
      value: vpc.vpcId,
      description: 'Aardvark App VPC ID',
    });

    new cdk.CfnOutput(this, 'AardvarkAutoScalingGroupName', {
      value: autoScalingGroup.autoScalingGroupName,
      description: 'Aardvark App Auto Scaling Group Name',
    });

    new cdk.CfnOutput(this, 'AardvarkDatabaseEndpoint', {
      value: database.dbInstanceEndpointAddress,
      description: 'Aardvark App RDS MySQL Endpoint',
    });
  }
}
