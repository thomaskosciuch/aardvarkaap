#!/bin/bash

# Tail ECS container logs from CloudWatch

source "$(dirname "$0")/_common.sh"

check_aws

echo "  Tailing logs from /ecs/aardvark-app ..."
echo "  (Ctrl+C to stop)"
echo ""

aws logs tail /ecs/aardvark-app --follow --region $REGION
