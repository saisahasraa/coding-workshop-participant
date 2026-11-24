"""
PostgreSQL access.

One connection per warm Lambda container is reused across invocations and transparently
re-opened when it is missing, closed, or broken. Each request runs inside ``transaction()``
so a failure (or an interrupted invocation) never leaves partial writes behind.
"""

from __future__ import annotations

import logging
import signal
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import psycopg
from psycopg.rows import dict_row

from app import log
from app.config import ENV

logger = logging.getLogger(__name__)

_conn: psycopg.Connection | None = None


def conninfo() -> str:
    """Build the libpq connection string from the environment (TLS required in AWS)."""
    params = {
        "host": ENV.postgres_host,
        "port": ENV.postgres_port,
        "dbname": ENV.postgres_name,
        "user": ENV.postgres_user,
        "password": ENV.postgres_pass,
        # Aurora Serverless v2 with min capacity 0 pauses when idle; resuming takes ~15 s.
        "connect_timeout": "5" if ENV.is_local else "30",
        "application_name": "acme-tracker",
    }
    if not ENV.is_local:
        params["sslmode"] = "require"
    return psycopg.conninfo.make_conninfo(**params)


def connection() -> psycopg.Connection:
    """Return the shared connection, opening a new one if needed."""
    global _conn  # pylint: disable=global-statement
    if _conn is None or _conn.closed or _conn.broken:
        logger.info("Opening PostgreSQL connection", extra={"fields": {"db_host": ENV.postgres_host}})
        _conn = psycopg.connect(conninfo(), autocommit=True, row_factory=dict_row)
    return _conn


def close() -> None:
    """Close the shared connection (safe to call at any time)."""
    global _conn  # pylint: disable=global-statement
    if _conn is not None:
        try:
            _conn.close()
        except Exception:  # pylint: disable=broad-except
            logger.debug("Ignoring error while closing connection", exc_info=True)
    _conn = None


@contextmanager
def transaction(statement_timeout_ms: int | None = None) -> Iterator[psycopg.Connection]:
    """Run the block in one transaction: commit on success, roll back on any exception."""
    conn = connection()
    with conn.transaction():
        if statement_timeout_ms:
            conn.execute("SELECT set_config('statement_timeout', %s, true)", (str(statement_timeout_ms),))
        yield conn


def fetch_one(query: Any, params: Any = None) -> dict | None:
    """Execute ``query`` and return the first row (or ``None``)."""
    with connection().cursor() as cur:
        cur.execute(query, params)
        return cur.fetchone()


def fetch_all(query: Any, params: Any = None) -> list[dict]:
    """Execute ``query`` and return all rows."""
    with connection().cursor() as cur:
        cur.execute(query, params)
        return cur.fetchall()


def execute(query: Any, params: Any = None) -> int:
    """Execute ``query`` and return the affected row count."""
    with connection().cursor() as cur:
        cur.execute(query, params)
        return cur.rowcount


def _on_sigterm(signum: int, _frame: Any) -> None:
    """Graceful shutdown: release the DB connection and flush logs before exiting.

    Lambda only delivers SIGTERM to the runtime when an extension is registered; without one
    the container is frozen and discarded, and per-request transactions keep data consistent.
    """
    logger.info("Received signal %s, shutting down", signum)
    close()
    log.flush()
    sys.exit(0)


def install_shutdown_handler() -> None:
    """Register the SIGTERM handler (call once at cold start)."""
    signal.signal(signal.SIGTERM, _on_sigterm)
