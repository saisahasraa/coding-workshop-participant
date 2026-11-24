"""Route table: system, auth, admin, and the generic CRUD resources."""

from __future__ import annotations

import logging

import psycopg

from app import admin, auth, capacity, collab, crud, db, migrations
from app.config import ENV
from app.http import Request, ok, response, router
from app.resources import RESOURCES

logger = logging.getLogger(__name__)


@router.get("/health", transactional=False, public=True)
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


auth.register()

# Auth
router.add("POST", "/auth/login", auth.login, public=True)
router.add("POST", "/auth/refresh", auth.refresh, public=True)
router.add("GET", "/auth/me", auth.me)
router.add("PUT", "/auth/me", auth.update_me)
router.add("POST", "/auth/logout-all", auth.logout_all)

# System
router.add("GET", "/meta", admin.meta)
router.add("GET", "/settings", admin.list_settings)
router.add("PUT", "/settings/{key}", admin.update_setting)
router.add("DELETE", "/settings/{key}", admin.reset_setting)

# Collaboration on deliverables (registered before the generic routes; paths are distinct anyway)
router.add("GET", "/deliverables/{id}/comments", collab.list_comments)
router.add("POST", "/deliverables/{id}/comments", collab.add_comment)
router.add("PUT", "/comments/{comment_id}", collab.update_comment)
router.add("DELETE", "/comments/{comment_id}", collab.delete_comment)
router.add("GET", "/deliverables/{id}/links", collab.list_links)
router.add("POST", "/deliverables/{id}/links", collab.add_link)
router.add("DELETE", "/deliverables/{id}/links/{link_id}", collab.delete_link)

# Reports
router.add("GET", "/reports/capacity", lambda request: ok(capacity.build_report(request.user, request.query)))

router.add("GET", "/projects/{id}/team", lambda request: ok(capacity.project_team(request.user, request.params["id"])))

# Resources
for _resource in RESOURCES:
    crud.register(router, _resource)
