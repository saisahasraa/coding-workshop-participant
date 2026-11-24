#!/usr/bin/env bash
# Script: Run all automated checks (backend + frontend)
# Usage:  ./bin/run-tests.sh [backend|frontend]
#
# Backend:  ruff lint, bandit security scan, pytest with coverage. Integration tests use a
#           disposable "acme_test" database on the local PostgreSQL and are skipped if it is
#           unreachable. Override with TEST_POSTGRES_HOST/PORT/USER/PASS/NAME.
# Frontend: ESLint, Vitest with coverage (API calls are mocked with MSW).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" > /dev/null 2>&1 && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." > /dev/null 2>&1 && pwd -P)"
TARGET="${1:-all}"
VENV="$PROJECT_ROOT/.venv"

run_backend() {
    echo "=== Backend (backend/v1) ==="
    if [ ! -x "$VENV/bin/python" ]; then
        echo "Creating Python 3.13 virtualenv at .venv ..."
        python3.13 -m venv "$VENV"
    fi
    "$VENV/bin/pip" install --quiet -r "$PROJECT_ROOT/backend/v1/requirements-dev.txt"
    cd "$PROJECT_ROOT/backend/v1"
    "$VENV/bin/ruff" check .
    "$VENV/bin/bandit" -q -r app function.py
    "$VENV/bin/pytest"
}

run_frontend() {
    echo "=== Frontend ==="
    cd "$PROJECT_ROOT/frontend"
    [ -d node_modules ] || npm install --no-audit --no-fund
    npm run lint
    npm run coverage
}

case "$TARGET" in
    backend) run_backend ;;
    frontend) run_frontend ;;
    all) run_backend; run_frontend ;;
    *) echo "Usage: $0 [backend|frontend]"; exit 1 ;;
esac

echo "All checks passed."
