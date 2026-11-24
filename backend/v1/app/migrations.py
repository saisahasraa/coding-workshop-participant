"""
Versioned schema migrations.

``CREATE TABLE IF NOT EXISTS`` cannot evolve an existing table, so every schema change is an
append-only, numbered entry in ``MIGRATIONS``. Each runs exactly once per database, in order,
recorded in ``schema_migrations``. Never edit an applied migration; add a new one instead.
"""

from __future__ import annotations

import logging

from app import db

logger = logging.getLogger(__name__)

# Arbitrary constant: serializes concurrent cold starts so two containers never migrate at once.
_LOCK_ID = 726354001

MIGRATIONS: list[tuple[int, str, str]] = [
    (
        1,
        "runtime settings",
        """
        CREATE TABLE app_settings (
            key        TEXT PRIMARY KEY,
            value      JSONB NOT NULL,
            updated_by BIGINT,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """,
    ),
]

_current_version: int | None = None


def migrate() -> int:
    """Apply pending migrations and return the resulting schema version."""
    conn = db.connection()
    with conn.transaction():
        conn.execute("SELECT pg_advisory_xact_lock(%s)", (_LOCK_ID,))
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version    INTEGER PRIMARY KEY,
                name       TEXT NOT NULL,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        row = conn.execute("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations").fetchone()
        version = row["v"]
        for number, name, statement in MIGRATIONS:
            if number <= version:
                continue
            logger.info("Applying migration %s: %s", number, name)
            with conn.transaction():  # savepoint: a failing migration is reported with its number
                conn.execute(statement)
                conn.execute("INSERT INTO schema_migrations (version, name) VALUES (%s, %s)", (number, name))
            version = number
    return version


def ensure_migrated() -> int:
    """Run ``migrate()`` once per container; later calls return the cached version."""
    global _current_version  # pylint: disable=global-statement
    if _current_version is None:
        _current_version = migrate()
        logger.info("Database schema at version %s", _current_version)
    return _current_version


def latest_version() -> int:
    """Highest migration number defined in code."""
    return MIGRATIONS[-1][0] if MIGRATIONS else 0
