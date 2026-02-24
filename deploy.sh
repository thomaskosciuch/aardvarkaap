#!/bin/bash

# Aardvark App — deploy menu

SCRIPT_DIR="$(cd "$(dirname "$0")/scripts" && pwd)"

echo ""
echo "  Aardvark App"
echo "  ────────────"
echo ""
echo "  1) Deploy app        Push code changes to ECS"
echo "  2) Deploy infra      Update CDK stack (AWS resources)"
echo "  3) Status            Check service health"
echo "  4) Logs              Tail container logs"
echo "  5) Destroy           Tear down the stack"
echo ""
read -p "  Pick one [1-5]: " choice

case $choice in
  1) bash "$SCRIPT_DIR/deploy-app.sh" ;;
  2) bash "$SCRIPT_DIR/deploy-infra.sh" ;;
  3) bash "$SCRIPT_DIR/status.sh" ;;
  4) bash "$SCRIPT_DIR/logs.sh" ;;
  5) bash "$SCRIPT_DIR/destroy.sh" ;;
  *) echo "  Invalid choice." && exit 1 ;;
esac
