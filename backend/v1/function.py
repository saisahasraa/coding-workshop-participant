"""
Lambda entry point (handler: ``function.handler``).

Cold start configures JSON logging and graceful shutdown once; each invocation is delegated
to ``app.http.dispatch``, which routes the Function URL event and builds the response.
"""

from typing import Any

from app import db, log
from app.config import ENV

log.configure(ENV.log_level)
db.install_shutdown_handler()

# Imported after logging is configured; importing routes registers them on the router.
from app import routes  # noqa: E402,F401  pylint: disable=wrong-import-position,unused-import
from app.http import dispatch  # noqa: E402  pylint: disable=wrong-import-position


def handler(event: dict | None, context: Any = None) -> dict:
    """AWS Lambda handler."""
    return dispatch(event, context)
