"""
Collaboration on deliverables: comments and linked work items ("blocks" / "relates to").

Both live under a deliverable and inherit its visibility: you can only see or touch them if you
can see the deliverable (``/deliverables/ENG-12/comments``).
"""

from __future__ import annotations

from psycopg import sql

from app import audit, db
from app.crud import fetch, record_id_from
from app.http import Conflict, Forbidden, NotFound, Request, ValidationFailed, created, no_content, ok
from app.rbac import PROJECT_MANAGER, VIEWER, has_role, is_admin
from app.resources import DELIVERABLES, block_waiting, project_visibility, release_unblocked
from app.validation import Field, parse_id, validate_fields


def _deliverable(request: Request) -> dict:
    """The deliverable named in the path, if visible to the user (else 404)."""
    return fetch(DELIVERABLES, request.user, record_id_from(DELIVERABLES, request.params["id"]))


def _manages(user: dict, deliverable: dict) -> bool:
    return is_admin(user) or (has_role(user, PROJECT_MANAGER) and deliverable["project_manager_id"] == user["id"])


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------

COMMENT_FIELDS = {"body": Field("string", required=True, nullable=False, max_len=5000)}

_COMMENT_SELECT = sql.SQL(
    "SELECT c.id, c.deliverable_id, c.author_id, u.name AS author_name, c.body, c.created_at, c.updated_at,"
    " c.updated_at > c.created_at + interval '1 second' AS edited"
    " FROM comments c JOIN users u ON u.id = c.author_id"
)


def _comment_view(user: dict, deliverable: dict, row: dict) -> dict:
    mine = row["author_id"] == user["id"]
    return {**row, "permissions": {"update": mine, "delete": mine or _manages(user, deliverable)}}


def list_comments(request: Request) -> dict:
    """GET /deliverables/{id}/comments: oldest first, like a conversation."""
    deliverable = _deliverable(request)
    rows = db.fetch_all(_COMMENT_SELECT + sql.SQL(" WHERE c.deliverable_id = %s ORDER BY c.created_at, c.id LIMIT 500"),
                        (deliverable["id"],))
    return ok({"data": [_comment_view(request.user, deliverable, r) for r in rows], "total": len(rows)})


def add_comment(request: Request) -> dict:
    """POST /deliverables/{id}/comments: anyone who can see the deliverable, except viewers."""
    deliverable = _deliverable(request)
    if has_role(request.user, VIEWER):
        raise Forbidden("Viewers cannot comment")
    values = validate_fields(COMMENT_FIELDS, request.body)
    row = db.fetch_one("INSERT INTO comments (deliverable_id, author_id, body) VALUES (%s, %s, %s) RETURNING id",
                       (deliverable["id"], request.user["id"], values["body"]))
    audit.record(request, "create", "comments", row["id"], {"deliverable_id": deliverable["id"]})
    comment = db.fetch_one(_COMMENT_SELECT + sql.SQL(" WHERE c.id = %s"), (row["id"],))
    return created(_comment_view(request.user, deliverable, comment))


def _comment_for(request: Request) -> tuple[dict, dict]:
    comment = db.fetch_one(_COMMENT_SELECT + sql.SQL(" WHERE c.id = %s"), (parse_id(request.params["comment_id"]),))
    if comment is None:
        raise NotFound("Comment not found")
    try:
        deliverable = fetch(DELIVERABLES, request.user, comment["deliverable_id"])
    except NotFound:
        raise NotFound("Comment not found") from None
    return comment, deliverable


def update_comment(request: Request) -> dict:
    """PUT /comments/{comment_id}: authors edit their own comments."""
    comment, deliverable = _comment_for(request)
    if comment["author_id"] != request.user["id"]:
        raise Forbidden("Only the author can edit a comment")
    values = validate_fields(COMMENT_FIELDS, request.body)
    db.execute("UPDATE comments SET body = %s, updated_at = now() WHERE id = %s", (values["body"], comment["id"]))
    audit.record(request, "update", "comments", comment["id"],
                 {"body": {"from": comment["body"], "to": values["body"]}})
    fresh = db.fetch_one(_COMMENT_SELECT + sql.SQL(" WHERE c.id = %s"), (comment["id"],))
    return ok(_comment_view(request.user, deliverable, fresh))


def delete_comment(request: Request) -> dict:
    """DELETE /comments/{comment_id}: the author, the project's manager, or an admin."""
    comment, deliverable = _comment_for(request)
    if not _comment_view(request.user, deliverable, comment)["permissions"]["delete"]:
        raise Forbidden()
    db.execute("DELETE FROM comments WHERE id = %s", (comment["id"],))
    audit.record(request, "delete", "comments", comment["id"], {"before": {"body": comment["body"]}})
    return no_content()


# ---------------------------------------------------------------------------
# Linked work items
# ---------------------------------------------------------------------------

LINK_TYPES = ("blocks", "is_blocked_by", "relates_to")
LINK_FIELDS = {
    "type": Field("enum", required=True, nullable=False, choices=LINK_TYPES),
    "target": Field("string", required=True, nullable=False, max_len=20),  # key (ENG-12) or id
}


def _links_of(user: dict, deliverable_id: int) -> list[dict]:
    """Links touching the deliverable, seen from its side; the other side must be visible too."""
    query = sql.SQL(
        "SELECT l.id, CASE WHEN l.type = 'relates_to' THEN 'relates_to'"
        "            WHEN l.source_id = %s THEN 'blocks' ELSE 'is_blocked_by' END AS type,"
        " o.id AS deliverable_id, op.key || '-' || o.number AS key, o.name, o.status, o.priority,"
        " ow.name AS owner_name"
        " FROM deliverable_links l"
        " JOIN deliverables o ON o.id = CASE WHEN l.source_id = %s THEN l.target_id ELSE l.source_id END"
        " JOIN projects op ON op.id = o.project_id LEFT JOIN users ow ON ow.id = o.owner_id"
        " WHERE (l.source_id = %s OR l.target_id = %s)"
    )
    params: list = [deliverable_id] * 4
    scope = project_visibility("op", user)
    if scope is not None:
        query += sql.SQL(" AND ({})").format(scope[0])
        params += scope[1]
    return db.fetch_all(query + sql.SQL(" ORDER BY 2, 4"), params)


def list_links(request: Request) -> dict:
    """GET /deliverables/{id}/links."""
    deliverable = _deliverable(request)
    return ok({"data": _links_of(request.user, deliverable["id"])})


def _creates_cycle(source_id: int, target_id: int) -> bool:
    """Would "source blocks target" close a loop (target already blocks source, directly or not)?"""
    row = db.fetch_one(
        """
        WITH RECURSIVE downstream(id) AS (
            SELECT target_id FROM deliverable_links WHERE type = 'blocks' AND source_id = %(target)s
            UNION
            SELECT l.target_id FROM deliverable_links l JOIN downstream d ON l.source_id = d.id
             WHERE l.type = 'blocks'
        )
        SELECT 1 AS hit FROM downstream WHERE id = %(source)s LIMIT 1
        """,
        {"source": source_id, "target": target_id},
    )
    return row is not None


def add_link(request: Request) -> dict:
    """POST /deliverables/{id}/links ``{"type": "blocks|is_blocked_by|relates_to", "target": "ENG-3"}``."""
    deliverable = _deliverable(request)
    if not _manages(request.user, deliverable):
        raise Forbidden("Only the project's manager can link work items")
    values = validate_fields(LINK_FIELDS, request.body)
    try:
        target = fetch(DELIVERABLES, request.user, record_id_from(DELIVERABLES, values["target"]))
    except NotFound:
        raise ValidationFailed({"target": f"{values['target']} not found"}) from None
    if target["id"] == deliverable["id"]:
        raise ValidationFailed({"target": "a work item cannot link to itself"})

    kind = values["type"]
    source, dest = (target, deliverable) if kind == "is_blocked_by" else (deliverable, target)
    stored = "relates_to" if kind == "relates_to" else "blocks"
    duplicate = db.fetch_one(
        "SELECT 1 AS hit FROM deliverable_links WHERE type = %(t)s AND ((source_id = %(a)s AND target_id = %(b)s)"
        " OR (%(t)s = 'relates_to' AND source_id = %(b)s AND target_id = %(a)s))",
        {"t": stored, "a": source["id"], "b": dest["id"]},
    )
    if duplicate:
        raise Conflict(f"{deliverable['key']} is already linked to {target['key']} this way")
    if stored == "blocks" and _creates_cycle(source["id"], dest["id"]):
        raise ValidationFailed({"target": f"{source['key']} blocking {dest['key']} would create a circular dependency"})
    row = db.fetch_one(
        "INSERT INTO deliverable_links (source_id, target_id, type, created_by) VALUES (%s, %s, %s, %s) RETURNING id",
        (source["id"], dest["id"], stored, request.user["id"]),
    )
    audit.record(request, "create", "deliverable_links", row["id"],
                 {"source": source["key"], "target": dest["key"], "type": stored})
    if stored == "blocks":
        block_waiting(request, [dest["id"]])  # a new, unfinished blocker puts the other item on hold
    link = next(x for x in _links_of(request.user, deliverable["id"]) if x["id"] == row["id"])
    return created(link)


def delete_link(request: Request) -> dict:
    """DELETE /deliverables/{id}/links/{link_id}."""
    deliverable = _deliverable(request)
    if not _manages(request.user, deliverable):
        raise Forbidden("Only the project's manager can unlink work items")
    link_id = parse_id(request.params["link_id"])
    row = db.fetch_one("SELECT id, source_id, target_id, type FROM deliverable_links WHERE id = %s"
                       " AND (source_id = %s OR target_id = %s)", (link_id, deliverable["id"], deliverable["id"]))
    if row is None:
        raise NotFound("Link not found")
    db.execute("DELETE FROM deliverable_links WHERE id = %s", (link_id,))
    audit.record(request, "delete", "deliverable_links", link_id, {"before": row})
    if row["type"] == "blocks":
        release_unblocked(request, [row["target_id"]])
    return no_content()

