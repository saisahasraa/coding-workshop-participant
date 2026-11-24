#!/usr/bin/env python3
"""
Load test for the read paths people hit most: lists, reports and search. No dependencies.

It signs in once, then sends requests from several threads and reports latency percentiles and errors
per endpoint. Exit status is 1 when any request fails or a limit given with --max-p95-ms is exceeded.

Usage:
    ./bin/load-test.py                                   # local stack, demo manager account
    ./bin/load-test.py --base-url https://<cloudfront> --requests 400 --concurrency 20 --max-p95-ms 1500
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ENDPOINTS = [
    "/projects?limit=25",
    "/deliverables?limit=25&sort=due_date",
    "/reports/summary",
    "/reports/capacity",
    "/reports/budget",
    "/search?q=pa",
]


def call(url: str, token: str | None = None, body: dict | None = None) -> tuple[int, float, bytes]:
    """One request: (status, seconds, body). Network failures count as status 0."""
    request = urllib.request.Request(url, data=json.dumps(body).encode() if body else None)  # noqa: S310
    request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310 - URL comes from the operator
            return response.status, time.perf_counter() - started, response.read()
    except urllib.error.HTTPError as error:
        return error.code, time.perf_counter() - started, error.read()
    except (urllib.error.URLError, TimeoutError):
        return 0, time.perf_counter() - started, b""


def percentile(values: list[float], pct: float) -> float:
    """The value below which ``pct`` percent of the sorted values fall (nearest rank)."""
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, round(pct / 100 * len(ordered)) - 1))]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default="http://localhost:3001")
    parser.add_argument("--email", default="alice.pm@acme.example")
    parser.add_argument("--password", default="Demo#2026!")
    parser.add_argument("--requests", type=int, default=120, help="total requests, spread over the endpoints")
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--max-p95-ms", type=float, default=None, help="fail when any endpoint's p95 exceeds this")
    args = parser.parse_args()

    api = args.base_url.rstrip("/") + "/api/v1"
    status, _, raw = call(f"{api}/auth/login", body={"email": args.email, "password": args.password})
    if status != 200:
        print(f"Sign-in failed ({status}): {raw[:200]!r}", file=sys.stderr)
        return 1
    token = json.loads(raw)["access_token"]
    for path in ENDPOINTS:  # one warm-up each, so cold starts do not skew the figures
        call(api + path, token)

    jobs = [ENDPOINTS[i % len(ENDPOINTS)] for i in range(args.requests)]
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        results = list(pool.map(lambda path: (path, *call(api + path, token)[:2]), jobs))
    elapsed = time.perf_counter() - started

    print(f"{args.requests} requests, {args.concurrency} at a time, {elapsed:.1f}s "
          f"({args.requests / elapsed:.1f} req/s) against {api}\n")
    print(f"{'endpoint':<40}{'n':>5}{'errors':>8}{'p50 ms':>9}{'p95 ms':>9}{'max ms':>9}")
    failed = False
    for path in ENDPOINTS:
        rows = [(code, seconds) for p, code, seconds in results if p == path]
        times = [seconds * 1000 for _, seconds in rows]
        errors = sum(1 for code, _ in rows if code != 200)
        p95 = percentile(times, 95)
        slow = args.max_p95_ms is not None and p95 > args.max_p95_ms
        failed = failed or errors > 0 or slow
        print(f"{path:<40}{len(rows):>5}{errors:>8}{statistics.median(times):>9.0f}{p95:>9.0f}{max(times):>9.0f}"
              f"{'  <- over the limit' if slow else ''}")
    print("\nFAILED" if failed else "\nOK")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
