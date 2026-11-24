"""Route table. Phase 0 exposes only the health check."""

from __future__ import annotations

import logging

import psycopg
from app import db, migrations
from app.config import ENV
from app.http import Request, response, router

logger = logging.getLogger(__name__)


@router.get("/health", transactional=False)
def health(_request: Request) -> dict:
    """Liveness and database readiness. Returns 503 when the database is unreachable."""
    body = {
        "status": "ok",
        "version": ENV.app_version,
        "environment": ENV.environment,
        "database": "ok",
        "schema_version": None,
        "schema_latest": migrations.latest_version(),
    }
    try:
        body["schema_version"] = migrations.ensure_migrated()
        db.fetch_one("SELECT 1 AS ok")
    except psycopg.Error:
        logger.warning("Health check: database unavailable", exc_info=True)
        db.close()
        body.update(status="degraded", database="unavailable")
        return response(503, body)
    return response(200, body)
