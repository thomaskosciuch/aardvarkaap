# Aardvark Slack App - ECS on EC2 with CDK

This project demonstrates how to deploy a Slack app with webhook functionality on Amazon ECS using EC2 instances, managed through AWS CDK.

## Architecture

The project creates the following AWS resources:

### Slack App Features:
- **App Home**: Interactive home tab for users to view webhook messages
- **Webhook Endpoint**: `/webhook` for external applications to send messages
- **Message Storage**: Stores recent webhook messages in memory
- **Real-time Updates**: Updates app home when new webhook messages arrive
- **Channel Integration**: Can post messages to specific Slack channels

### AWS Infrastructure:

- **VPC** with public and private subnets across 2 availability zones
- **ECS Cluster** with EC2 instances running the ECS optimized AMI
- **Auto Scaling Group** to manage EC2 instances (1-3 instances, t3.medium)
- **Application Load Balancer** for external access to the application
- **ECS Service** running the containerized application
- **CloudWatch Logs** for application logging

## Prerequisites

Before deploying this stack, ensure you have:

1. **AWS CLI** installed and configured
   ```bash
   aws configure
   ```

2. **Node.js** (version 18 or later)
   ```bash
   node --version
   ```

3. **npm** or **yarn**
   ```bash
   npm --version
   ```

4. **AWS CDK** (will be installed automatically)
   ```bash
   npm install -g aws-cdk
   ```

5. **Docker** (for building custom applications)
   ```bash
   docker --version
   ```

## Quick Start

### 1. Deploy the Infrastructure

```bash
# Make deployment script executable
chmod +x deploy.sh

# Deploy the stack
./deploy.sh
```

This will:
- Install dependencies
- Build the CDK project
- Bootstrap CDK (if needed)
- Deploy the ECS infrastructure

### 2. Access Your Application

After deployment, you'll see output including the Load Balancer URL. Your application will be available at:

```
http://<load-balancer-dns-name>
```

The Slack app provides the following endpoints:
- `GET /health` - Health check endpoint
- `GET /webhook-messages` - Get all stored webhook messages
- `DELETE /webhook-messages` - Clear all stored webhook messages
- `POST /webhook` - Receive webhook messages from external apps
- `POST /slack/events` - Slack event subscriptions
- `POST /slack/install` - Slack app installation

### 3. Test the Slack App Webhook

Test the webhook functionality:

```bash
# Make the script executable
chmod +x test-webhook.sh

# Run webhook tests
./test-webhook.sh
```

### 4. Deploy Custom Application

To deploy your own Docker application:

```bash
# Make the script executable
chmod +x build-and-deploy-custom-app.sh

# Deploy custom application
./build-and-deploy-custom-app.sh
```

This will:
- Build your Docker image from the `example-app` directory
- Push it to Amazon ECR
- Update the ECS service to use the new image

## Project Structure

```
├── bin/
│   └── app.ts                 # CDK app entry point
├── lib/
│   └── ecs-ec2-stack.ts      # Main CDK stack definition
├── aardvark-aap/             # Aardvark Slack App Docker application
│   ├── Dockerfile
│   ├── package.json
│   ├── slack-app.js          # Main Slack app with webhook functionality
│   ├── server.js              # Original simple server (backup)
│   ├── healthcheck.js
│   └── slack-app-config.md    # Slack app configuration guide
├── deploy.sh                 # Deployment script
├── destroy.sh                # Destruction script
├── build-and-deploy-custom-app.sh  # Custom app deployment
├── package.json
├── tsconfig.json
└── cdk.json
```

## Customization

### Modify the Application

Edit the files in the `aardvark-aap/` directory:
- `slack-app.js` - Main Slack app with webhook logic
- `server.js` - Original simple server (backup)
- `Dockerfile` - Docker image configuration
- `package.json` - Node.js dependencies including Slack SDK

### Modify Infrastructure

Edit `lib/ecs-ec2-stack.ts` to customize:
- Instance types and sizes
- VPC configuration
- Security groups
- Load balancer settings
- ECS service configuration

### Environment Variables

You can set environment variables in the CDK stack:

```typescript
container.addEnvironment('CUSTOM_VAR', 'value');
```

## Monitoring and Logs

### CloudWatch Logs

Application logs are automatically sent to CloudWatch Logs:
- Log Group: `/ecs/example-app`
- Retention: 7 days

### ECS Console

Monitor your services in the AWS ECS Console:
1. Go to ECS → Clusters
2. Select `ecs-ec2-cluster`
3. View services and tasks

### Load Balancer Health Checks

The Application Load Balancer performs health checks:
- Path: `/`
- Interval: 30 seconds
- Timeout: 5 seconds
- Healthy threshold: 2
- Unhealthy threshold: 3

## Scaling

### Manual Scaling

Scale the service manually:
```bash
aws ecs update-service \
  --cluster ecs-ec2-cluster \
  --service alb-example-service \
  --desired-count 3
```

### Auto Scaling

The Auto Scaling Group can scale EC2 instances:
- Minimum: 1 instance
- Maximum: 3 instances
- Desired: 1 instance

You can add ECS Service Auto Scaling by modifying the stack.

## Security

### Network Security

- EC2 instances run in private subnets
- Load balancer is in public subnets
- Security groups restrict traffic appropriately

### Container Security

- Non-root user in Docker container
- Health checks for container monitoring
- Resource limits configured

## Troubleshooting

### Common Issues

1. **Deployment fails with permissions error**
   - Ensure your AWS credentials have sufficient permissions
   - Run `aws sts get-caller-identity` to verify

2. **Service fails to start**
   - Check ECS console for task failures
   - Review CloudWatch logs for application errors

3. **Load balancer returns 502 errors**
   - Verify health check endpoint is working
   - Check security group allows traffic on port 80

### Useful Commands

```bash
# View stack outputs
cdk list

# View stack details
cdk synth

# Check ECS service status
aws ecs describe-services --cluster ecs-ec2-cluster --services alb-example-service

# View application logs
aws logs tail /ecs/example-app --follow
```

## Cleanup

To destroy all resources:

```bash
# Make script executable
chmod +x destroy.sh

# Destroy the stack
./destroy.sh
```

**Warning**: This will delete all resources and data. Make sure to backup any important data first.

## Cost Optimization

This stack uses:
- t3.medium EC2 instances (2 vCPU, 4 GB RAM)
- Application Load Balancer
- NAT Gateway (for private subnet internet access)

To reduce costs:
- Use smaller instance types (t3.small or t3.micro)
- Remove NAT Gateway if internet access not needed
- Use Spot instances for non-critical workloads

## Next Steps

- Add ECS Service Auto Scaling
- Implement CI/CD pipeline
- Add monitoring and alerting
- Configure custom domain names
- Add SSL/TLS certificates
- Implement blue/green deployments

