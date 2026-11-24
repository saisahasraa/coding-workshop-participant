"""GET /projects/{id}/team: the people working on a project and their deliverables."""

from datetime import date

import pytest

from app import capacity


@pytest.fixture(autouse=True)
def pinned_today(monkeypatch):
    monkeypatch.setattr(capacity, "_today", lambda: date(2026, 3, 2))


def _item(call, org, project, owner=None, **fields):
    body = {"project_id": project["id"], "name": "Work", **({"owner_id": owner["id"]} if owner else {}), **fields}
    status, item = call("POST", "/deliverables", body, org["project_manager"]["token"])
    assert status == 201, item
    return item


def test_groups_deliverables_by_owner_with_hours(call, org, make_project):
    project = make_project(key="ENG")
    dan, erin = org["team_member"], org["team_lead"]
    _item(call, org, project, dan, name="Late", estimated_hours=40, progress_pct=50, due_date="2026-02-01")
    _item(call, org, project, dan, name="Done", estimated_hours=10, status="completed", due_date="2026-02-20")
    _item(call, org, project, dan, name="Soon", estimated_hours=8, due_date="2026-03-20")
    _item(call, org, project, erin, name="Hers", estimated_hours=16)
    _item(call, org, project, name="Nobody's")

    status, body = call("GET", "/projects/ENG/team", token=org["viewer"]["token"])
    assert status == 200 and body["truncated"] is False
    assert body["project"] == {"id": project["id"], "key": "ENG", "name": project["name"]}
    assert [g["name"] for g in body["data"]] == sorted([dan["name"], erin["name"]]) + ["Unassigned"]

    mine = next(g for g in body["data"] if g["user_id"] == dan["id"])
    assert (mine["deliverables_total"], mine["deliverables_open"], mine["deliverables_completed"]) == (3, 2, 1)
    assert mine["overdue"] == 1 and mine["estimated_hours"] == 58.0 and mine["remaining_hours"] == 28.0  # 20 + 8
    assert [(d["key"], d["is_overdue"]) for d in mine["deliverables"]] == [("ENG-1", True), ("ENG-2", False),
                                                                            ("ENG-3", False)]
    assert mine["deliverables"][0] | {"progress_pct": 50} == mine["deliverables"][0]

    nobody = body["data"][-1]
    assert nobody["user_id"] is None and nobody["deliverables_total"] == 1 and nobody["remaining_hours"] == 0.0


def test_lookup_by_key_or_id_and_visibility(call, org, make_project):
    secret = make_project(key="SEC", visibility="members")
    _item(call, org, secret, org["team_member"])
    admin, viewer, member = org["admin"]["token"], org["viewer"]["token"], org["team_member"]["token"]
    assert call("GET", f"/projects/{secret['id']}/team", token=admin)[0] == 200
    assert call("GET", "/projects/sec/team", token=member)[0] == 200            # owns a deliverable: a member
    assert call("GET", "/projects/SEC/team", token=viewer)[0] == 404            # hidden from outsiders
    assert call("GET", "/projects/NOPE/team", token=admin)[0] == 404
    assert call("GET", "/projects/SEC/team")[0] == 401


def test_empty_project_and_row_cap(call, org, make_project, monkeypatch):
    project = make_project(key="EMP")
    assert call("GET", "/projects/EMP/team", token=org["viewer"]["token"])[1]["data"] == []
    monkeypatch.setattr(capacity, "MAX_TEAM_ROWS", 2)
    for _ in range(3):
        _item(call, org, project, org["team_member"])
    body = call("GET", "/projects/EMP/team", token=org["viewer"]["token"])[1]
    assert body["truncated"] is True and body["data"][0]["deliverables_total"] == 2
