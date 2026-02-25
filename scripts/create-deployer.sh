#!/bin/bash

# Create an IAM user with minimum permissions to deploy the app

source "$(dirname "$0")/_common.sh"

check_aws

USER_NAME="aardvark-app-deployer"
POLICY_NAME="aardvark-app-deploy-policy"

echo ""
echo "  Creating deployer: $USER_NAME"
echo "  Account: $ACCOUNT_ID"
echo "  Region:  $REGION"
echo ""

# Create the policy document
POLICY_DOC=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECRAuth",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "ECRPush",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"
      ],
      "Resource": "arn:aws:ecr:${REGION}:${ACCOUNT_ID}:repository/${REPOSITORY_NAME}"
    },
    {
      "Sid": "ECSUpdate",
      "Effect": "Allow",
      "Action": [
        "ecs:UpdateService",
        "ecs:DescribeServices"
      ],
      "Resource": "arn:aws:ecs:${REGION}:${ACCOUNT_ID}:service/${CLUSTER_NAME}/${SERVICE_NAME}"
    }
  ]
}
EOF
)

# Create IAM policy
echo "  Creating IAM policy..."
POLICY_ARN=$(aws iam create-policy \
  --policy-name $POLICY_NAME \
  --policy-document "$POLICY_DOC" \
  --query "Policy.Arn" \
  --output text 2>&1)

if echo "$POLICY_ARN" | grep -q "EntityAlreadyExists"; then
  POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}"
  echo "  Policy already exists, reusing."
else
  echo "  Policy created: $POLICY_ARN"
fi

# Create IAM user
echo "  Creating IAM user..."
aws iam create-user --user-name $USER_NAME > /dev/null 2>&1 || echo "  User already exists, reusing."

# Attach policy
echo "  Attaching policy..."
aws iam attach-user-policy \
  --user-name $USER_NAME \
  --policy-arn $POLICY_ARN

# Create access key
echo "  Creating access key..."
KEYS=$(aws iam create-access-key --user-name $USER_NAME --query "AccessKey.{id:AccessKeyId,secret:SecretAccessKey}" --output json)

ACCESS_KEY_ID=$(echo "$KEYS" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
SECRET_ACCESS_KEY=$(echo "$KEYS" | python3 -c "import sys,json; print(json.load(sys.stdin)['secret'])")

echo ""
echo "  ────────────────────────────────────────"
echo "  Add these as GitHub repo secrets:"
echo ""
echo "  AWS_ACCESS_KEY_ID:     $ACCESS_KEY_ID"
echo "  AWS_SECRET_ACCESS_KEY: $SECRET_ACCESS_KEY"
echo "  ────────────────────────────────────────"
echo ""
echo "  Settings > Secrets and variables > Actions > New repository secret"
echo ""
