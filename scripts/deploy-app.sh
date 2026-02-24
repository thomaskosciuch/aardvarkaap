#!/bin/bash

# Build Docker image, push to ECR, and redeploy the ECS service

source "$(dirname "$0")/_common.sh"

check_aws
check_docker

echo ""
echo "  Account:    $ACCOUNT_ID"
echo "  Region:     $REGION"
echo "  Repository: $REPOSITORY_NAME"
echo ""

# Ensure ECR repository exists
aws ecr describe-repositories --repository-names $REPOSITORY_NAME --region $REGION 2>/dev/null || \
aws ecr create-repository --repository-name $REPOSITORY_NAME --region $REGION

# Login to ECR
echo "  Logging into ECR..."
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com

# Build
echo "  Building Docker image..."
cd "$PROJECT_DIR/aardvark-aap"
docker buildx build --platform linux/amd64 -t $REPOSITORY_NAME .

# Tag
IMAGE_TAG=$(date +%Y%m%d-%H%M%S)
docker tag $REPOSITORY_NAME:latest $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$REPOSITORY_NAME:$IMAGE_TAG
docker tag $REPOSITORY_NAME:latest $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$REPOSITORY_NAME:latest

# Push
echo "  Pushing image to ECR..."
docker push $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$REPOSITORY_NAME:$IMAGE_TAG
docker push $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$REPOSITORY_NAME:latest

# Redeploy
echo "  Redeploying ECS service..."
aws ecs update-service \
  --cluster $CLUSTER_NAME \
  --service $SERVICE_NAME \
  --task-definition $TASK_FAMILY \
  --force-new-deployment \
  --region $REGION > /dev/null

echo ""
echo "  Done! New container will be live in ~60 seconds."
echo "  Image: $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$REPOSITORY_NAME:$IMAGE_TAG"
