"""
Notifications: telling people about changes to work they are part of.

``push`` writes one row per recipient in the same transaction as the change, so a notification exists
exactly when the change does. The web app shows them in the bell. An optional email channel (Amazon SES)
sends the same text when ``notifications.email_enabled`` is on and a sender address is configured; a failed
email never fails the request.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable

from app import db
from app.config import ENV, get_setting
from app.http import Forbidden, Request, no_content, ok
from app.validation import parse_id

logger = logging.getLogger(__name__)

MAX_LISTED = 50


def push(request: Request, user_ids: Iterable[int | None], kind: str, message: str, link: str | None = None) -> None:
    """Notify ``user_ids`` (minus the person acting, and nobody twice) that something happened."""
    actor = request.user["id"] if request.user else None
    recipients = sorted({uid for uid in user_ids if uid is not None and uid != actor})
    if not recipients:
        return
    db.execute(
        "INSERT INTO notifications (user_id, actor_id, kind, message, link)"
        " SELECT u.id, %s, %s, %s, %s FROM users u WHERE u.id = ANY(%s) AND u.is_active",
        (actor, kind, message, link, recipients),
    )
    if get_setting("notifications.email_enabled") and ENV.notify_from_email:
        _email(recipients, message, link)


def _send(to: str, subject: str, body: str) -> None:
    """Send one email through SES. Short timeouts: a missing network route must not hang the request."""
    import boto3  # pylint: disable=import-outside-toplevel  (present in the Lambda runtime only)
    from botocore.config import Config  # pylint: disable=import-outside-toplevel

    client = boto3.client("ses", config=Config(connect_timeout=2, read_timeout=3, retries={"max_attempts": 1}))
    client.send_email(Source=ENV.notify_from_email, Destination={"ToAddresses": [to]},
                      Message={"Subject": {"Data": subject[:120]}, "Body": {"Text": {"Data": body}}})


def _email(recipients: list[int], message: str, link: str | None) -> None:
    """Best-effort email to the recipients; problems are logged and never raised."""
    try:
        rows = db.fetch_all("SELECT email FROM users WHERE id = ANY(%s) AND is_active", (recipients,))
        for row in rows:
            _send(row["email"], message, message + (f"\n\nOpen: {link}" if link else ""))
        db.execute("UPDATE notifications SET emailed_at = now() WHERE user_id = ANY(%s) AND message = %s"
                   " AND emailed_at IS NULL", (recipients, message))
    except Exception:  # pylint: disable=broad-except
        logger.warning("Could not send notification emails", exc_info=True)


def test_email(request: Request) -> dict:
    """POST /notifications/test-email (admins): try to email the caller and report exactly what happened."""
    if request.user["role"] != "admin":
        raise Forbidden()
    status = {"to": request.user["email"], "from": ENV.notify_from_email or None,
              "enabled": get_setting("notifications.email_enabled")}
    if not ENV.notify_from_email:
        return ok({**status, "sent": False, "error": "No sender address is configured (NOTIFY_FROM_EMAIL / "
                                                     "Terraform variable app_notify_from_email)."})
    try:
        _send(request.user["email"], "ACME Project Tracker test email", "Email notifications can be delivered.")
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("Test email failed", exc_info=True)
        return ok({**status, "sent": False, "error": f"{type(exc).__name__}: {exc}"[:500]})
    return ok({**status, "sent": True, "error": None})


def list_mine(request: Request) -> dict:
    """GET /notifications: my newest notifications and how many are unread (``?unread=true`` for those only)."""
    unread_only = request.query.get("unread") == "true"
    rows = db.fetch_all(
        "SELECT n.id, n.kind, n.message, n.link, n.read_at, n.created_at, a.name AS actor_name"
        " FROM notifications n LEFT JOIN users a ON a.id = n.actor_id"
        " WHERE n.user_id = %s AND (NOT %s OR n.read_at IS NULL) ORDER BY n.created_at DESC, n.id DESC LIMIT %s",
        (request.user["id"], unread_only, MAX_LISTED),
    )
    unread = db.fetch_one("SELECT count(*) AS n FROM notifications WHERE user_id = %s AND read_at IS NULL",
                          (request.user["id"],))["n"]
    return ok({"data": rows, "unread": unread})


def mark_read(request: Request) -> dict:
    """POST /notifications/read: mark some (``{"ids": [...]}``) or all of my notifications as read."""
    ids = (request.body or {}).get("ids") if isinstance(request.body, dict) else None
    if ids is None:
        db.execute("UPDATE notifications SET read_at = now() WHERE user_id = %s AND read_at IS NULL",
                   (request.user["id"],))
    else:
        wanted = [parse_id(str(i)) for i in ids] if isinstance(ids, list) else []
        db.execute("UPDATE notifications SET read_at = now() WHERE user_id = %s AND id = ANY(%s) AND read_at IS NULL",
                   (request.user["id"], wanted))
    return no_content()
