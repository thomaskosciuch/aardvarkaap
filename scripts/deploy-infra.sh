#!/bin/bash

# Build and deploy CDK infrastructure stack

source "$(dirname "$0")/_common.sh"

check_aws
check_cdk

cd "$PROJECT_DIR"

echo "  Installing dependencies..."
npm install

echo "  Building TypeScript..."
npm run build

echo "  Bootstrapping CDK..."
cdk bootstrap

echo "  Deploying stack..."
cdk deploy --require-approval never

echo ""
echo "  Infrastructure deployed!"
