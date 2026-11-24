"""Teams, team-lead permissions and planned leave."""


# -- teams --------------------------------------------------------------------------------

def test_admin_manages_teams_and_lead_must_be_a_team_lead(call, org):
    admin = org["admin"]["token"]
    base = {"department_id": org["department_id"], "name": "Platform"}
    status, body = call("POST", "/teams", {**base, "lead_id": org["team_lead"]["id"]}, admin)
    assert status == 201 and body["lead_name"] == org["team_lead"]["name"] and body["member_count"] == 0
    assert body["department_name"] == "Engineering"
    for bad_lead in (org["project_manager"], org["team_member"]):
        status, err = call("POST", "/teams", {**base, "name": "Other", "lead_id": bad_lead["id"]}, admin)
        assert status == 400 and "lead_id" in err["error"]["details"]
    assert call("POST", "/teams", base, admin)[0] == 409  # same name in the same department
    assert call("POST", "/teams", {"department_id": 999, "name": "X"}, admin)[0] == 400
    assert call("PUT", f"/teams/{body['id']}", {"lead_id": None}, admin)[1]["lead_id"] is None


def test_only_admins_write_teams_but_everyone_reads(call, org, team):
    for role in ("project_manager", "team_lead", "team_member", "viewer"):
        token = org[role]["token"]
        assert call("POST", "/teams", {"department_id": org["department_id"], "name": "N"}, token)[0] == 403
        assert call("PUT", f"/teams/{team['id']}", {"name": "N"}, token)[0] == 403
        assert call("DELETE", f"/teams/{team['id']}", token=token)[0] == 403
        assert call("GET", "/teams", token=token)[1]["total"] == 1
    assert call("GET", "/teams", token=org["team_lead"]["token"], query={"lead_id": "me"})[1]["total"] == 1
    assert call("GET", "/teams", token=org["team_member"]["token"], query={"lead_id": "me"})[1]["total"] == 0


def test_membership_filters_and_team_deletion(call, org, team):
    token = org["viewer"]["token"]
    assert call("GET", f"/teams/{team['id']}", token=token)[1]["member_count"] == 2
    members = call("GET", "/users", token=token, query={"team_id": str(team["id"])})[1]["data"]
    assert {m["id"] for m in members} == {org["team_lead"]["id"], org["team_member"]["id"]}
    assert members[0]["team_name"] == "Platform" and members[0]["department_name"] == "Engineering"
    assert call("GET", "/users", token=token, query={"department_id": str(org["department_id"])})[1]["total"] == 2
    assert call("DELETE", f"/teams/{team['id']}", token=org["admin"]["token"])[0] == 204
    assert call("GET", f"/users/{org['team_member']['id']}", token=token)[1]["team_id"] is None


def test_team_lead_edits_capacity_of_own_team_only(call, org, team, make_user):
    lead = org["team_lead"]["token"]
    path = f"/users/{org['team_member']['id']}"
    status, body = call("PUT", path, {"weekly_capacity_hours": 32}, lead)
    assert status == 200 and body["weekly_capacity_hours"] == 32
    assert body["permissions"]["editable_fields"] == ["weekly_capacity_hours"]
    status, body = call("PUT", path, {"weekly_capacity_hours": 32, "role": "admin"}, lead)
    assert status == 403
    assert call("PUT", path, {"weekly_capacity_hours": 200}, lead)[0] == 400
    outsider = make_user("team_member")
    assert call("PUT", f"/users/{outsider['id']}", {"weekly_capacity_hours": 10}, lead)[0] == 403
    assert call("PUT", path, {"weekly_capacity_hours": 10}, org["team_member"]["token"])[0] == 403
    assert call("PUT", path, {"weekly_capacity_hours": 10}, org["project_manager"]["token"])[0] == 403
    assert call("DELETE", path, token=lead)[0] == 403


# -- leave --------------------------------------------------------------------------------

LEAVE = {"type": "vacation", "start_date": "2026-03-09", "end_date": "2026-03-11"}


def test_members_record_their_own_leave(call, org):
    token = org["team_member"]["token"]
    status, body = call("POST", "/leaves", LEAVE, token)
    assert status == 201 and body["user_id"] == org["team_member"]["id"] and body["user_name"]
    assert body["permissions"] == {"update": True, "delete": True,
                                   "editable_fields": ["end_date", "note", "start_date", "type"]}
    assert call("PUT", f"/leaves/{body['id']}", {"note": "Trip", "end_date": "2026-03-12"}, token)[0] == 200
    assert call("PUT", f"/leaves/{body['id']}", {"user_id": org["admin"]["id"]}, token)[0] == 403
    assert call("DELETE", f"/leaves/{body['id']}", token=token)[0] == 204


def test_leave_validation(call, org):
    token = org["team_member"]["token"]
    assert call("POST", "/leaves", {**LEAVE, "type": "sabbatical"}, token)[0] == 400
    status, body = call("POST", "/leaves", {**LEAVE, "end_date": "2026-03-01"}, token)
    assert status == 400 and "end_date" in body["error"]["details"]
    assert call("POST", "/leaves", {"type": "sick"}, token)[0] == 400
    assert call("POST", "/leaves", LEAVE, token)[0] == 201
    status, body = call("POST", "/leaves", {**LEAVE, "start_date": "2026-03-11", "end_date": "2026-03-15"}, token)
    assert status == 400 and "overlaps" in body["error"]["details"]["start_date"]
    assert call("POST", "/leaves", {**LEAVE, "start_date": "2026-03-12", "end_date": "2026-03-13"}, token)[0] == 201


def test_leave_scoping_by_role(call, org, team, make_user):
    lead, member, outsider = org["team_lead"]["token"], org["team_member"], make_user("team_member")
    status, body = call("POST", "/leaves", {**LEAVE, "user_id": member["id"]}, lead)
    assert status == 201 and body["user_id"] == member["id"] and "created_by" not in body
    assert call("PUT", f"/leaves/{body['id']}", {"note": "Planned by lead"}, lead)[0] == 200
    assert call("DELETE", f"/leaves/{body['id']}", token=lead)[0] == 204

    assert call("POST", "/leaves", {**LEAVE, "user_id": outsider["id"]}, lead)[0] == 403          # not in their team
    assert call("POST", "/leaves", {**LEAVE, "user_id": member["id"]}, outsider["token"])[0] == 403
    assert call("POST", "/leaves", {**LEAVE, "user_id": member["id"]}, org["project_manager"]["token"])[0] == 403
    assert call("POST", "/leaves", LEAVE, org["viewer"]["token"])[0] == 403
    assert call("POST", "/leaves", {**LEAVE, "user_id": outsider["id"]}, org["admin"]["token"])[0] == 201

    mine = call("POST", "/leaves", {**LEAVE, "start_date": "2026-05-04", "end_date": "2026-05-05",
                                    "user_id": member["id"]}, org["admin"]["token"])[1]
    assert call("PUT", f"/leaves/{mine['id']}", {"note": "x"}, outsider["token"])[0] == 403
    assert call("DELETE", f"/leaves/{mine['id']}", token=outsider["token"])[0] == 403
    assert call("GET", f"/leaves/{mine['id']}", token=org["viewer"]["token"])[1]["permissions"]["update"] is False


def test_leave_filters(call, org, team):
    admin = org["admin"]["token"]
    plans = ((org["team_member"], "2026-03-09", "2026-03-11"), (org["team_lead"], "2026-04-06", "2026-04-07"))
    for user, start, end in plans:
        call("POST", "/leaves", {**LEAVE, "user_id": user["id"], "start_date": start, "end_date": end}, admin)

    def ids(**query):
        return [x["user_id"] for x in call("GET", "/leaves", token=org["viewer"]["token"], query=query)[1]["data"]]

    assert ids(user_id=str(org["team_member"]["id"])) == [org["team_member"]["id"]]
    assert ids(team_id=str(team["id"]), sort="start_date") == [org["team_member"]["id"], org["team_lead"]["id"]]
    assert ids(**{"from": "2026-03-11", "to": "2026-03-31"}) == [org["team_member"]["id"]]  # overlap, inclusive
    assert ids(**{"from": "2026-03-12", "to": "2026-04-05"}) == []
    assert call("GET", "/leaves", token=org["team_member"]["token"], query={"user_id": "me"})[1]["total"] == 1
    assert call("GET", "/leaves", token=admin, query={"from": "later"})[0] == 400
