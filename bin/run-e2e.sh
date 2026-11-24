#!/usr/bin/env bash
# Script: Run the end-to-end tests (Playwright) against a running stack
# Usage:  ./bin/run-e2e.sh [playwright args...]
#
# Local (default): needs ./bin/start-dev.sh running and the demo data (./bin/seed-demo.py).
# Cloud: E2E_BASE_URL=https://<cloudfront> E2E_API_URL=https://<cloudfront>/api/v1 E2E_ADMIN_PASSWORD=... ./bin/run-e2e.sh
#
# The admin password is read from the local Terraform state when not provided.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" > /dev/null 2>&1 && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." > /dev/null 2>&1 && pwd -P)"

if [ -z "${E2E_ADMIN_PASSWORD:-}" ] && [ -z "${E2E_BASE_URL:-}" ]; then
    E2E_ADMIN_PASSWORD="$(cd "$PROJECT_ROOT/infra" && AWS_ENDPOINT_URL=http://localhost.localstack.cloud:4566 \
        AWS_ENDPOINT_URL_S3=http://s3.localhost.localstack.cloud:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
        AWS_REGION=us-east-1 terraform output -raw app_admin_password 2>/dev/null || true)"
    export E2E_ADMIN_PASSWORD
fi

cd "$PROJECT_ROOT/frontend"
[ -d node_modules ] || npm install --no-audit --no-fund
npx playwright install chromium > /dev/null
npx playwright test "$@"
