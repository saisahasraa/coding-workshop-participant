"""GET /projects/{id}/dependencies: the blocking graph of a project."""

import pytest


def _item(call, org, project, name, **fields):
    status, body = call("POST", "/deliverables", {"project_id": project["id"], "name": name, **fields},
                        org["project_manager"]["token"])
    assert status == 201, body
    return body


def _block(call, org, blocker, blocked):
    status, body = call("POST", f"/deliverables/{blocker['key']}/links", {"type": "blocks", "target": blocked["key"]},
                        org["project_manager"]["token"])
    assert status == 201, body


@pytest.fixture
def chain(call, org, make_project):
    """ENG-1 -> ENG-2 -> ENG-4 and ENG-1 -> ENG-3 -> ENG-4; ENG-5 stands alone."""
    project = make_project(key="ENG")
    items = [_item(call, org, project, f"Step {n}") for n in range(1, 6)]
    for a, b in ((0, 1), (0, 2), (1, 3), (2, 3)):
        _block(call, org, items[a], items[b])
    return project, items


def test_nodes_edges_depths_and_readiness(call, org, chain):
    _, items = chain
    call("PUT", f"/deliverables/{items[0]['id']}", {"status": "completed"}, org["project_manager"]["token"])
    status, body = call("GET", "/projects/ENG/dependencies", token=org["viewer"]["token"])
    assert status == 200
    assert body["project"]["key"] == "ENG" and body["longest_chain"] == 3
    nodes = {n["key"]: n for n in body["nodes"]}
    assert {k: n["depth"] for k, n in nodes.items()} == {"ENG-1": 0, "ENG-2": 1, "ENG-3": 1, "ENG-4": 2, "ENG-5": 0}
    assert nodes["ENG-2"]["ready"] is True and nodes["ENG-4"]["ready"] is False   # ENG-1 done; ENG-4 awaits 2 and 3
    assert nodes["ENG-1"]["ready"] is False and nodes["ENG-4"]["open_blockers"] == 2
    assert sorted((e["source"], e["target"]) for e in body["edges"]) == [
        ("ENG-1", "ENG-2"), ("ENG-1", "ENG-3"), ("ENG-2", "ENG-4"), ("ENG-3", "ENG-4")]


def test_unlinked_work_is_shown_at_depth_zero(call, org, chain):
    body = call("GET", "/projects/ENG/dependencies", token=org["admin"]["token"])[1]
    standalone = next(n for n in body["nodes"] if n["key"] == "ENG-5")
    assert standalone["depth"] == 0 and standalone["ready"] is True


def test_cross_project_links_appear_as_external_nodes(call, org, make_project, chain):
    other = make_project(key="OPS")
    ops = _item(call, org, other, "Provision")
    _block(call, org, ops, chain[1][1])  # OPS-1 blocks ENG-2
    body = call("GET", "/projects/ENG/dependencies", token=org["admin"]["token"])[1]
    external = [n for n in body["nodes"] if n["external"]]
    assert [n["key"] for n in external] == ["OPS-1"] and external[0]["depth"] == 0
    assert next(n for n in body["nodes"] if n["key"] == "ENG-2")["depth"] == 1
    assert ("OPS-1", "ENG-2") in [(e["source"], e["target"]) for e in body["edges"]]


def test_links_into_hidden_projects_are_left_out(call, org, make_project, chain):
    secret = make_project(key="SEC", visibility="members")
    hidden = _item(call, org, secret, "Secret work")
    _block(call, org, hidden, chain[1][4])  # SEC-1 blocks ENG-5
    viewer = call("GET", "/projects/ENG/dependencies", token=org["viewer"]["token"])[1]
    assert "SEC-1" not in [n["key"] for n in viewer["nodes"]]
    assert all("SEC-1" not in (e["source"], e["target"]) for e in viewer["edges"])
    admin = call("GET", "/projects/ENG/dependencies", token=org["admin"]["token"])[1]
    assert "SEC-1" in [n["key"] for n in admin["nodes"]]
    standalone = next(n for n in viewer["nodes"] if n["key"] == "ENG-5")
    assert standalone["open_blockers"] == 1 and standalone["ready"] is False        # still waiting, even unseen


def test_empty_project_hidden_project_and_auth(call, org, make_project):
    make_project(key="EMP")
    make_project(key="SEC", visibility="members")
    body = call("GET", "/projects/EMP/dependencies", token=org["viewer"]["token"])[1]
    assert body["nodes"] == [] and body["edges"] == [] and body["longest_chain"] == 0
    assert call("GET", "/projects/SEC/dependencies", token=org["viewer"]["token"])[0] == 404
    assert call("GET", "/projects/NOPE/dependencies", token=org["admin"]["token"])[0] == 404
    assert call("GET", "/projects/EMP/dependencies")[0] == 401
