"""
Dependency graph of a project: which deliverables block which, and how deep each chain goes.

Edges are the "blocks" links between deliverables (``A blocks B`` means B waits for A). The graph holds
the project's deliverables plus the deliverables of other projects they are linked to, as long as the
caller can see those projects. ``depth`` is the length of the longest chain of blockers before a node
(0 = nothing blocks it), which is the column the UI draws it in.
"""

from __future__ import annotations

from collections import defaultdict, deque

from psycopg import sql

from app import db
from app.crud import fetch, record_id_from
from app.resources import PROJECTS, project_visibility


def layer(node_ids: list[int], edges: list[tuple[int, int]]) -> dict[int, int]:
    """Depth of every node: the longest path of ``(blocker, blocked)`` edges ending at it.

    Cycles cannot be created through the API; should one exist anyway, its nodes keep depth 0
    rather than looping forever.
    """
    successors: dict[int, list[int]] = defaultdict(list)
    waiting = dict.fromkeys(node_ids, 0)
    for blocker, blocked in edges:
        successors[blocker].append(blocked)
        waiting[blocked] += 1
    depth = dict.fromkeys(node_ids, 0)
    queue = deque(n for n, count in waiting.items() if count == 0)
    while queue:
        node = queue.popleft()
        for nxt in successors[node]:
            depth[nxt] = max(depth[nxt], depth[node] + 1)
            waiting[nxt] -= 1
            if waiting[nxt] == 0:
                queue.append(nxt)
    return depth


_NODE_SELECT = (
    "SELECT d.id, p.key || '-' || d.number AS key, d.name, d.status, d.priority, d.due_date, d.project_id,"
    " p.key AS project_key, o.name AS owner_name,"
    " (SELECT count(*) FROM deliverable_links bl JOIN deliverables bs ON bs.id = bl.source_id"
    "   WHERE bl.type = 'blocks' AND bl.target_id = d.id AND bs.status <> 'completed') AS open_blockers"
    " FROM deliverables d JOIN projects p ON p.id = d.project_id LEFT JOIN users o ON o.id = d.owner_id"
)


def project_dependencies(user: dict, ref: str) -> dict:
    """``GET /projects/{id}/dependencies``: nodes, edges and chain depths for one project."""
    project = fetch(PROJECTS, user, record_id_from(PROJECTS, ref))  # 404 when not visible
    edges = db.fetch_all(
        "SELECT l.source_id, l.target_id FROM deliverable_links l"
        " WHERE l.type = 'blocks' AND (l.source_id IN (SELECT id FROM deliverables WHERE project_id = %(p)s)"
        " OR l.target_id IN (SELECT id FROM deliverables WHERE project_id = %(p)s))", {"p": project["id"]})
    linked = {e["source_id"] for e in edges} | {e["target_id"] for e in edges}

    query = sql.SQL(_NODE_SELECT + " WHERE (d.project_id = %s OR d.id = ANY(%s))")
    params: list = [project["id"], list(linked)]
    scope = project_visibility("p", user)
    if scope is not None:
        query += sql.SQL(" AND ({})").format(scope[0])
        params += scope[1]
    nodes = db.fetch_all(query + sql.SQL(" ORDER BY p.key, d.number"), params)

    shown = {n["id"] for n in nodes}
    pairs = [(e["source_id"], e["target_id"]) for e in edges if e["source_id"] in shown and e["target_id"] in shown]
    depth = layer(list(shown), pairs)
    keys = {n["id"]: n["key"] for n in nodes}
    return {
        "project": {"id": project["id"], "key": project["key"], "name": project["name"]},
        "nodes": [{
            **n, "depth": depth[n["id"]], "external": n["project_id"] != project["id"],
            "ready": n["status"] != "completed" and n["open_blockers"] == 0,
        } for n in nodes],
        "edges": [{"source": keys[a], "target": keys[b]} for a, b in pairs],
        "longest_chain": max(depth.values(), default=-1) + 1 if pairs else 0,
    }
