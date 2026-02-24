#!/bin/bash

# Destroy the CDK stack and all AWS resources

source "$(dirname "$0")/_common.sh"

check_aws
check_cdk

cd "$PROJECT_DIR"

echo ""
echo "  WARNING: This will destroy all resources in the stack!"
echo "  - ECS cluster and service"
echo "  - EC2 instances"
echo "  - Application Load Balancer"
echo "  - Secrets Manager secret"
echo "  - CloudWatch log group"
echo ""
read -p "  Are you sure? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
  echo "  Cancelled."
  exit 0
fi

echo "  Destroying stack..."
cdk destroy --force

echo ""
echo "  Stack destroyed!"
