#!/bin/bash

# Shared configuration and checks for all scripts

set -e

REPOSITORY_NAME="aardvark-app"
CLUSTER_NAME="aardvark-app-cluster"
SERVICE_NAME="aardvark-alb-service"
TASK_FAMILY="aardvark-app"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

check_aws() {
  if ! command -v aws &> /dev/null; then
    echo "  AWS CLI is not installed. Please install it first."
    exit 1
  fi
  if ! aws sts get-caller-identity &> /dev/null; then
    echo "  AWS credentials not configured. Please run 'aws configure' first."
    exit 1
  fi
  ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
  REGION=$(aws configure get region || echo "ca-central-1")
}

check_docker() {
  if ! command -v docker &> /dev/null; then
    echo "  Docker is not installed. Please install Docker first."
    exit 1
  fi
}

check_cdk() {
  if ! command -v cdk &> /dev/null; then
    echo "  AWS CDK is not installed. Installing..."
    npm install -g aws-cdk
  fi
}
