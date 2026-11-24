#!/usr/bin/env python3
"""
Seed demo data through the public REST API (works locally and against CloudFront).

Usage:
    ./bin/seed-demo.py --base-url http://localhost:3001 --email admin@acme.example --password '...'

The admin credentials can also come from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD. The bootstrap admin's
password is a Terraform output:  terraform -chdir=infra output -raw app_admin_password

Safe to re-run: existing departments, users and projects (matched by code/email) are reused, and
deliverables are only added to projects that have none. Uses only the Python standard library.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta

DEMO_PASSWORD = "Demo#2026!"  # noqa: S105 - documented demo credential, printed at the end

DEPARTMENTS = [
    {"code": "ENG", "name": "Engineering", "description": "Product engineering and platform"},
    {"code": "MKT", "name": "Marketing", "description": "Brand, campaigns and web"},
    {"code": "FIN", "name": "Finance", "description": "Finance systems and reporting"},
]

USERS = [
    {"email": "alice.pm@acme.example", "name": "Alice Morgan", "role": "project_manager", "job_title": "Senior PM"},
    {"email": "bob.pm@acme.example", "name": "Bob Chen", "role": "project_manager", "job_title": "Project Manager"},
    {"email": "carol.lead@acme.example", "name": "Carol Diaz", "role": "team_lead", "job_title": "Engineering Lead"},
    {"email": "dan.dev@acme.example", "name": "Dan Okafor", "role": "team_member", "job_title": "Backend Engineer"},
    {"email": "erin.dev@acme.example", "name": "Erin Walsh", "role": "team_member", "job_title": "Frontend Engineer",
     "weekly_capacity_hours": 32},
    {"email": "frank.analyst@acme.example", "name": "Frank Ito", "role": "team_member", "job_title": "Data Analyst"},
    {"email": "grace.exec@acme.example", "name": "Grace Patel", "role": "viewer", "job_title": "VP Operations"},
]


def _days(n: int) -> str:
    return (date.today() + timedelta(days=n)).isoformat()


# (key, name, department, manager email, status, priority, start offset, end offset, budget, visibility)
PROJECTS = [
    ("WEB", "Website relaunch", "MKT", "alice.pm@acme.example", "active", "high", -60, 30, 120000, "inherit"),
    ("PAY", "Payments platform v2", "ENG", "alice.pm@acme.example", "active", "critical", -90, 10, 450000,
     "inherit"),
    ("ERP", "ERP finance module", "FIN", "bob.pm@acme.example", "on_hold", "medium", -30, 120, 200000, "members"),
    ("APP", "Mobile app MVP", "ENG", "bob.pm@acme.example", "planning", "high", 14, 180, 300000, "inherit"),
    ("DWH", "Data warehouse migration", "FIN", "bob.pm@acme.example", "completed", "low", -200, -20, 80000,
     "inherit"),
]

# project code -> [(name, owner email, status, priority, due offset, estimated hours, progress)]
DELIVERABLES = {
    "WEB": [
        ("Information architecture", "erin.dev@acme.example", "completed", "high", -40, 40, 100),
        ("Design system", "erin.dev@acme.example", "in_progress", "high", -5, 80, 70),
        ("CMS integration", "dan.dev@acme.example", "in_progress", "medium", 15, 60, 30),
        ("Launch campaign", None, "not_started", "medium", 30, 24, 0),
    ],
    "PAY": [
        ("Card tokenization service", "dan.dev@acme.example", "completed", "critical", -50, 120, 100),
        ("Fraud rules engine", "dan.dev@acme.example", "blocked", "critical", -10, 100, 10),
        ("PCI audit", "carol.lead@acme.example", "in_progress", "high", 5, 40, 20),
        ("Merchant dashboard", "erin.dev@acme.example", "not_started", "medium", 10, 60, 0),
    ],
    "ERP": [
        ("Chart of accounts mapping", "frank.analyst@acme.example", "in_progress", "medium", 20, 30, 50),
        ("Ledger import", "dan.dev@acme.example", "not_started", "high", 60, 80, 0),
    ],
    "APP": [
        ("Product requirements", "carol.lead@acme.example", "in_progress", "high", 20, 20, 25),
        ("Prototype", "erin.dev@acme.example", "not_started", "medium", 45, 60, 0),
    ],
    "DWH": [
        ("Schema migration", "frank.analyst@acme.example", "completed", "medium", -60, 50, 100),
        ("Report cut-over", "frank.analyst@acme.example", "completed", "low", -25, 30, 100),
    ],
}


# (team, department, lead email or None, member emails)
TEAMS = [
    ("Platform", "ENG", "carol.lead@acme.example",
     ["carol.lead@acme.example", "dan.dev@acme.example", "erin.dev@acme.example"]),
    ("Analytics", "FIN", None, ["frank.analyst@acme.example"]),
]

# (person email, type, start offset, end offset, note)
LEAVES = [
    ("erin.dev@acme.example", "vacation", 7, 11, "Family trip"),
    ("dan.dev@acme.example", "training", 14, 15, "Conference"),
]

CRITERIA = {
    "Design system": ("- Tokens for colour, type and spacing published\n- 20 core components in Storybook\n"
                      "- WCAG AA contrast"),
    "Fraud rules engine": ("- Blocks the 5 known fraud patterns\n- p95 decision time under 50 ms\n"
                           "- Rules editable without deploy"),
    "CMS integration": "- Editors can publish without developers\n- Preview matches production",
}

# (from key, link type, to key)
LINKS = [
    ("WEB-2", "blocks", "WEB-3"),
    ("PAY-1", "blocks", "PAY-2"),
    ("PAY-2", "blocks", "PAY-4"),
    ("WEB-3", "blocks", "WEB-4"),
    ("WEB-2", "relates_to", "PAY-4"),
]

# (project key, amount, category, days ago, description) - spend that leaves WEB amber, PAY red and ERP green
EXPENSES = [
    ("WEB", 30000, "labor", 50, "Design contractors, phase 1"),
    ("WEB", 25000, "labor", 25, "Design contractors, phase 2"),
    ("WEB", 12000, "software", 40, "CMS licences"),
    ("WEB", 13000, "services", 10, "Copywriting agency"),
    ("PAY", 220000, "labor", 70, "Engineering contractors"),
    ("PAY", 120000, "labor", 30, "Engineering contractors"),
    ("PAY", 45000, "software", 45, "Fraud-scoring vendor licence"),
    ("PAY", 20000, "services", 12, "PCI assessor"),
    ("ERP", 18000, "labor", 15, "Analyst contractors"),
    ("ERP", 4000, "software", 20, "Reporting licences"),
    ("DWH", 76000, "labor", 150, "Migration team"),
]

# (deliverable key, author email, text)
COMMENTS = [
    ("PAY-2", "dan.dev@acme.example", "Blocked on the risk team's rule definitions; chasing them today."),
    ("PAY-2", "alice.pm@acme.example", "Escalated to the risk lead. Let's review on Thursday."),
    ("WEB-2", "erin.dev@acme.example", "Buttons, inputs and cards are done; tables and dialogs next."),
]


class Api:
    """Minimal JSON client for the tracker API."""

    def __init__(self, base_url: str) -> None:
        self.base = base_url.rstrip("/") + "/api/v1"
        self.token: str | None = None

    def request(self, method: str, path: str, body: dict | None = None, query: str = "") -> tuple[int, dict | None]:
        """Send a request; return (status, parsed body)."""
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path + query, data=data, method=method)  # noqa: S310
        req.add_header("Content-Type", "application/json")
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")
        try:
            with urllib.request.urlopen(req, timeout=60) as res:  # noqa: S310 - URL is the operator's API
                raw = res.read()
                return res.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as err:
            raw = err.read()
            return err.code, json.loads(raw) if raw else None

    def login(self, email: str, password: str) -> None:
        """Authenticate as admin."""
        status, body = self.request("POST", "/auth/login", {"email": email, "password": password})
        if status != 200:
            sys.exit(f"Login failed ({status}): {body}")
        self.token = body["access_token"]

    def find(self, path: str, q: str, key: str, value: str) -> dict | None:
        """Find an item in a list endpoint by exact field value."""
        _, body = self.request("GET", path, query=f"?q={urllib.parse.quote(q)}&limit=200")
        return next((item for item in (body or {}).get("data", []) if item[key] == value), None)

    def ensure(self, path: str, body: dict, key: str) -> dict:
        """Create unless an item with the same ``key`` exists."""
        status, created = self.request("POST", path, body)
        if status == 201:
            return created
        if status == 409:
            existing = self.find(path, body[key], key, body[key].upper() if key in ("code", "key") else body[key])
            if existing:
                return existing
        sys.exit(f"POST {path} failed ({status}): {created}")


def seed_capacity(api: Api, departments: dict, users: dict) -> None:
    """Teams, memberships and leave. Workload needs no seeding: it comes from the deliverables' estimates."""
    for name, dept, lead, members in TEAMS:
        body = {"name": name, "department_id": departments[dept]["id"]}
        if lead:
            body["lead_id"] = users[lead]["id"]
        team = api.ensure("/teams", body, "name")
        for email in members:
            api.request("PUT", f"/users/{users[email]['id']}", {"team_id": team["id"]})
    for email, kind, start, end, note in LEAVES:
        api.request("POST", "/leaves", {"user_id": users[email]["id"], "type": kind, "start_date": _days(start),
                                        "end_date": _days(end), "note": note})
    print(f"Teams: {len(TEAMS)}  Leave: {len(LEAVES)}")


def seed_collaboration(api: Api) -> None:
    """Add acceptance criteria, links and comments where missing (safe to re-run)."""
    for code, items in DELIVERABLES.items():
        for number, item in enumerate(items, start=1):
            criteria = CRITERIA.get(item[0])
            if not criteria:
                continue
            _, current = api.request("GET", f"/deliverables/{code}-{number}")
            if current and not current.get("acceptance_criteria"):
                api.request("PUT", f"/deliverables/{code}-{number}", {"acceptance_criteria": criteria})
    for source, kind, target in LINKS:
        api.request("POST", f"/deliverables/{source}/links", {"type": kind, "target": target})  # 409 = already there
    admin_token = api.token
    added = 0
    empty = {}
    for key, _, _ in COMMENTS:
        if key not in empty:
            _, existing = api.request("GET", f"/deliverables/{key}/comments")
            empty[key] = bool(existing) and existing["total"] == 0
    for key, author, text in COMMENTS:
        if empty[key]:
            api.login(author, DEMO_PASSWORD)
            api.request("POST", f"/deliverables/{key}/comments", {"body": text})
            added += 1
    api.token = admin_token
    print(f"Collaboration: {len(LINKS)} links, {added} new comments")


def seed_budget(api: Api) -> None:
    """Record demo expenses on projects that have none yet (safe to re-run)."""
    added = 0
    for code in dict.fromkeys(e[0] for e in EXPENSES):
        _, project = api.request("GET", f"/projects/{code}")
        _, existing = api.request("GET", "/expenses", query=f"?project_id={project['id']}&limit=1")
        if existing["total"]:
            continue
        for _, amount, category, ago, description in (e for e in EXPENSES if e[0] == code):
            status, body = api.request("POST", "/expenses", {
                "project_id": project["id"], "amount": amount, "category": category, "spent_on": _days(-ago),
                "description": description})
            if status != 201:
                sys.exit(f"Expense for {code} failed ({status}): {body}")
            added += 1
    print(f"Budget: {added} new expenses")


def main() -> None:
    """Seed departments, users, projects and deliverables."""
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default=os.getenv("SEED_BASE_URL", "http://localhost:3001"))
    parser.add_argument("--email", default=os.getenv("SEED_ADMIN_EMAIL", "admin@acme.example"))
    parser.add_argument("--password", default=os.getenv("SEED_ADMIN_PASSWORD"))
    args = parser.parse_args()
    if not args.password:
        sys.exit("Admin password required: --password or SEED_ADMIN_PASSWORD")

    api = Api(args.base_url)
    api.login(args.email, args.password)

    departments = {d["code"]: api.ensure("/departments", d, "code") for d in DEPARTMENTS}
    users = {u["email"]: api.ensure("/users", {**u, "password": DEMO_PASSWORD}, "email") for u in USERS}
    print(f"Departments: {len(departments)}  Users: {len(users)}")

    for code, name, dept, manager, status, priority, start, end, budget, visibility in PROJECTS:
        project = api.ensure("/projects", {
            "key": code, "name": name, "department_id": departments[dept]["id"],
            "manager_id": users[manager]["id"], "priority": priority,
            "start_date": _days(start), "end_date": _days(end), "planned_budget": budget, "visibility": visibility,
        }, "key")
        if project.get("deliverables_total"):
            print(f"  {code}: exists with deliverables, skipped")
            continue
        for d_name, owner, d_status, d_priority, due, hours, progress in DELIVERABLES[code]:
            body = {"project_id": project["id"], "name": d_name, "status": d_status, "priority": d_priority,
                    "due_date": _days(due), "estimated_hours": hours, "progress_pct": progress,
                    "owner_id": users[owner]["id"] if owner else None,
                    "description": f"{d_name} for {name}.", "acceptance_criteria": CRITERIA.get(d_name)}
            result, created = api.request("POST", "/deliverables", body)
            if result != 201:
                sys.exit(f"Deliverable {d_name} failed ({result}): {created}")
        # Set the final status last, so completing a project does not happen before its work exists.
        api.request("PUT", f"/projects/{project['id']}", {"status": status})
        print(f"  {code}: {len(DELIVERABLES[code])} deliverables")

    seed_collaboration(api)
    seed_capacity(api, departments, users)
    seed_budget(api)

    print(f"\nDemo users (password: {DEMO_PASSWORD}):")
    for user in USERS:
        print(f"  {user['role']:<16} {user['email']}")


if __name__ == "__main__":
    main()
