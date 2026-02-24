#!/bin/bash

# Check the status of the ECS service and health endpoint

source "$(dirname "$0")/_common.sh"

check_aws

echo ""

# Stack status
STACK_STATUS=$(aws cloudformation describe-stacks \
  --stack-name AardvarkAppStack \
  --query "Stacks[0].StackStatus" \
  --output text \
  --region $REGION 2>/dev/null || echo "NOT_FOUND")
echo "  Stack:   $STACK_STATUS"

# Service status
RUNNING=$(aws ecs describe-services \
  --cluster $CLUSTER_NAME \
  --services $SERVICE_NAME \
  --query "services[0].runningCount" \
  --output text \
  --region $REGION 2>/dev/null || echo "?")
DESIRED=$(aws ecs describe-services \
  --cluster $CLUSTER_NAME \
  --services $SERVICE_NAME \
  --query "services[0].desiredCount" \
  --output text \
  --region $REGION 2>/dev/null || echo "?")
echo "  Service: $RUNNING/$DESIRED running"

# ALB URL
ALB_URL=$(aws cloudformation describe-stacks \
  --stack-name AardvarkAppStack \
  --query "Stacks[0].Outputs[?OutputKey=='AardvarkLoadBalancerUrl'].OutputValue" \
  --output text \
  --region $REGION 2>/dev/null || echo "")

if [ -n "$ALB_URL" ]; then
  echo "  URL:     $ALB_URL"
  echo ""
  echo "  Health:"
  curl -s "$ALB_URL/health" 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "    unreachable"
fi

echo ""
