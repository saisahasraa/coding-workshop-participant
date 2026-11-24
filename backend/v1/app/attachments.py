"""
Attachments: files people add to a deliverable through its comments.

Flow: the client asks for an upload slot (``POST /deliverables/{id}/attachments`` with the file's name, type
and size), PUTs the bytes to the signed link it gets back, and references the file in a comment as
``[name](attachment:ID)``. Anyone who can see the deliverable can list its files and get a short-lived
download link; the uploader, the project's manager and admins can remove one.
"""

from __future__ import annotations

import re
import uuid

from app import audit, db, storage
from app.collab import _deliverable, _manages, _require_comment_access
from app.config import get_setting
from app.crud import fetch
from app.http import Forbidden, NotFound, Request, ValidationFailed, created, no_content, ok
from app.resources import DELIVERABLES
from app.validation import Field, parse_id, validate_fields

FIELDS = {
    "filename": Field("string", required=True, nullable=False, max_len=255),
    "content_type": Field("string", required=True, nullable=False, max_len=150),
    "size_bytes": Field("integer", required=True, nullable=False, minimum=1),
}
# Types a browser may show in place. Everything else is always downloaded, never rendered.
INLINE_TYPES = ("image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf")
_UNSAFE = re.compile(r"[^A-Za-z0-9._ -]+")

_SELECT = (
    "SELECT a.id, a.deliverable_id, a.comment_id, a.uploader_id, u.name AS uploader_name, a.filename,"
    " a.content_type, a.size_bytes, a.created_at, a.storage_key FROM attachments a"
    " LEFT JOIN users u ON u.id = a.uploader_id"
)


def _view(user: dict, deliverable: dict, row: dict) -> dict:
    body = {k: v for k, v in row.items() if k != "storage_key"}
    body["is_image"] = row["content_type"].startswith("image/") and row["content_type"] in INLINE_TYPES
    body["permissions"] = {"delete": row["uploader_id"] == user["id"] or _manages(user, deliverable)}
    return body


def list_attachments(request: Request) -> dict:
    """GET /deliverables/{id}/attachments: every file on the deliverable, newest first."""
    deliverable = _deliverable(request)
    rows = db.fetch_all(_SELECT + " WHERE a.deliverable_id = %s ORDER BY a.created_at DESC, a.id DESC LIMIT 500",
                        (deliverable["id"],))
    return ok({"data": [_view(request.user, deliverable, r) for r in rows], "total": len(rows),
               "max_size_mb": get_setting("attachments.max_size_mb"), "enabled": storage.is_configured()})


def create_attachment(request: Request) -> dict:
    """POST /deliverables/{id}/attachments: reserve a file and get the link to upload it to."""
    deliverable = _deliverable(request)
    _require_comment_access(request.user, deliverable)
    values = validate_fields(FIELDS, request.body)
    limit = get_setting("attachments.max_size_mb")
    if values["size_bytes"] > limit * 1024 * 1024:
        raise ValidationFailed({"size_bytes": f"files can be at most {limit} MB"})
    filename = _UNSAFE.sub("_", values["filename"].replace("\\", "/").split("/")[-1]).strip(" .") or "file"
    content_type = values["content_type"].lower()
    key = f"deliverables/{deliverable['id']}/{uuid.uuid4().hex}/{filename}"
    upload = storage.upload_link(key, content_type)
    row = db.fetch_one(
        "INSERT INTO attachments (deliverable_id, uploader_id, filename, content_type, size_bytes, storage_key)"
        " VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
        (deliverable["id"], request.user["id"], filename, content_type, values["size_bytes"], key))
    audit.record(request, "create", "attachments", row["id"], {"deliverable": deliverable["key"], "filename": filename})
    saved = db.fetch_one(_SELECT + " WHERE a.id = %s", (row["id"],))
    return created({**_view(request.user, deliverable, saved), "upload": upload})


def _attachment_for(request: Request) -> tuple[dict, dict]:
    row = db.fetch_one(_SELECT + " WHERE a.id = %s", (parse_id(request.params["attachment_id"]),))
    if row is None:
        raise NotFound("Attachment not found")
    try:
        deliverable = fetch(DELIVERABLES, request.user, row["deliverable_id"])
    except NotFound:
        raise NotFound("Attachment not found") from None
    return row, deliverable


def download(request: Request) -> dict:
    """GET /attachments/{attachment_id}/download: a short-lived link to the file."""
    row, _ = _attachment_for(request)
    inline = row["content_type"] in INLINE_TYPES
    return ok({"url": storage.download_link(row["storage_key"], row["filename"], row["content_type"], inline),
               "filename": row["filename"], "expires_in": storage.LINK_SECONDS})


def delete_attachment(request: Request) -> dict:
    """DELETE /attachments/{attachment_id}: the uploader, the project's manager, or an admin."""
    row, deliverable = _attachment_for(request)
    if not _view(request.user, deliverable, row)["permissions"]["delete"]:
        raise Forbidden()
    db.execute("DELETE FROM attachments WHERE id = %s", (row["id"],))
    audit.record(request, "delete", "attachments", row["id"], {"before": {"filename": row["filename"]}})
    return no_content()
