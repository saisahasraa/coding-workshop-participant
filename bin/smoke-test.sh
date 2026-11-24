#!/usr/bin/env bash
# Script: Smoke test a deployed (or local) environment
# Usage:  ./bin/smoke-test.sh [site-url] [api-url]
#           local:  ./bin/smoke-test.sh                       (http://localhost:3000 and :3001)
#           cloud:  ./bin/smoke-test.sh https://<cloudfront>  (API on the same origin)
#         Optional sign-in checks: SMOKE_EMAIL and SMOKE_PASSWORD (default: the demo viewer).
#
# Checks: API health and schema version, the single-page app and its deep links, that the API refuses
# anonymous callers, and (signed in) a list, the dashboard report and search.

set -uo pipefail

SITE="${1:-http://localhost:3000}"
API="${2:-$([ "$SITE" = "http://localhost:3000" ] && echo "http://localhost:3001" || echo "$SITE")}/api/v1"
EMAIL="${SMOKE_EMAIL:-grace.exec@acme.example}"
PASSWORD="${SMOKE_PASSWORD:-Demo#2026!}"
FAILURES=0

check() {  # check "<what>" <expected> <actual>
    if [ "$2" = "$3" ]; then echo "  ok    $1"; else echo "  FAIL  $1 (expected $2, got $3)"; FAILURES=$((FAILURES + 1)); fi
}
status() { curl -s -o /dev/null -m 30 -w "%{http_code}" "$@"; }
field() { python3 -c "import sys, json; print(json.load(sys.stdin).get('$1', ''))" 2>/dev/null; }

echo "Smoke test: site $SITE, API $API"

HEALTH="$(curl -s -m 60 "$API/health")"
check "API is healthy" "ok" "$(echo "$HEALTH" | field status)"
check "database is reachable" "ok" "$(echo "$HEALTH" | field database)"
check "schema is up to date" "$(echo "$HEALTH" | field schema_latest)" "$(echo "$HEALTH" | field schema_version)"

check "site serves the app" "200" "$(status "$SITE/")"
check "deep links open the app" "200" "$(status "$SITE/projects/WEB")"
check "anonymous API calls are refused" "401" "$(status "$API/projects")"
check "unknown API paths are 404" "404" "$(status "$API/no-such-thing")"

TOKEN="$(curl -s -m 60 -X POST "$API/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | field access_token)"
if [ -n "$TOKEN" ]; then
    echo "  ok    sign-in as $EMAIL"
    for path in "/auth/me" "/projects?limit=1" "/deliverables?limit=1" "/reports/summary" "/search?q=pa"; do
        check "GET $path" "200" "$(status -H "Authorization: Bearer $TOKEN" "$API$path")"
    done
    check "settings stay admin-only" "403" "$(status -H "Authorization: Bearer $TOKEN" "$API/settings")"
else
    echo "  FAIL  sign-in as $EMAIL (seed the demo data, or set SMOKE_EMAIL / SMOKE_PASSWORD)"
    FAILURES=$((FAILURES + 1))
fi

if [ "$FAILURES" -eq 0 ]; then echo "All checks passed."; else echo "$FAILURES check(s) failed."; exit 1; fi
