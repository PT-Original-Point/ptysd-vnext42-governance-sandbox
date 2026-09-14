from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any

import psycopg
from psycopg.errors import UniqueViolation

VERSION = "2.0.0-v46"
ROOT = Path(r"C:\Users\x\governance-durable-prod-v1")
FIRST_MIGRATION_PROJECT = "CHATGPT_GLOBAL_SKILL_GOVERNANCE"
HG3_GATE = "V46-HG-001-AUTHORITY-RECOVERY/HG3_DIRECTORY_WRITE_SURFACE"

REQUIRED_PROJECT_COLUMNS = {
    "project_name": "TEXT",
    "current_phase": "TEXT",
    "next_hard_gate": "TEXT",
    "current_mission_state": "TEXT",
    "active_run_ref": "TEXT",
    "runtime_type": "TEXT",
    "evidence_ledger_ref": "TEXT",
    "learning_ledger_ref": "TEXT",
    "directory_revision": "BIGINT NOT NULL DEFAULT 0",
    "last_readback_at": "TIMESTAMPTZ",
    "notes": "TEXT",
}
REQUIRED_ALIAS_COLUMNS = {
    "binding_status": "TEXT",
    "binding_revision": "BIGINT",
}


def normalize_name(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).strip().casefold()
    return re.sub(r"\s+", " ", value)


def connect_db() -> psycopg.Connection:
    password = (ROOT / "secrets" / "dbos.pw").read_text().strip()
    return psycopg.connect(
        host="127.0.0.1", port=55432, dbname="chatgpt_governance",
        user="dbos_governance", password=password,
    )


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=True, sort_keys=True, default=str))


def resolve_exact(conn: psycopg.Connection, name: str) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT p.project_id, p.status, COALESCE(a.binding_status, p.status),
                   COALESCE(a.binding_revision, 0)
            FROM project_aliases a
            JOIN projects p ON p.project_id=a.project_id
            WHERE a.normalized_name=%s
            """,
            (normalize_name(name),),
        )
        rows = cur.fetchall()
    if not rows:
        return {"status": "NOT_FOUND", "query": name}
    if len(rows) != 1:
        return {"status": "INTEGRITY_ERROR", "reason": "MULTIPLE_EXACT_BINDINGS", "query": name}
    project_id, project_status, binding_status, binding_revision = rows[0]
    return {
        "status": "FOUND", "project_id": project_id,
        "project_status": project_status, "binding_status": binding_status,
        "binding_revision": binding_revision,
    }


def get_project(conn: psycopg.Connection, project_id: str) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM projects WHERE project_id=%s", (project_id,))
        row = cur.fetchone()
        columns = [desc.name for desc in cur.description] if cur.description else []
    if row is None:
        return {"status": "NOT_FOUND", "project_id": project_id}
    payload = dict(zip(columns, row))
    for key, value in list(payload.items()):
        if hasattr(value, "isoformat"):
            payload[key] = value.isoformat()
    return {"status": "FOUND", **payload}


def schema_status(conn: psycopg.Connection) -> dict[str, Any]:
    # Inspect the currently visible tables. TEMP tables therefore shadow public tables
    # during regression tests, while production calls inspect the real tables.
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM projects WHERE false")
        pcols = {desc.name for desc in (cur.description or [])}
        cur.execute("SELECT * FROM project_aliases WHERE false")
        acols = {desc.name for desc in (cur.description or [])}
    missing_projects = sorted(set(REQUIRED_PROJECT_COLUMNS) - pcols)
    missing_aliases = sorted(set(REQUIRED_ALIAS_COLUMNS) - acols)
    return {
        "status": "READY" if not missing_projects and not missing_aliases else "MIGRATION_REQUIRED",
        "adapter_version": VERSION,
        "missing_project_columns": missing_projects,
        "missing_alias_columns": missing_aliases,
    }


def migrate_schema(conn: psycopg.Connection, approval_token: str) -> dict[str, Any]:
    if approval_token != HG3_GATE:
        return {"status": "DENIED", "reason": "HG3_APPROVAL_TOKEN_REQUIRED"}
    before = schema_status(conn)
    with conn.transaction():
        with conn.cursor() as cur:
            for col, typ in REQUIRED_PROJECT_COLUMNS.items():
                cur.execute(f'ALTER TABLE projects ADD COLUMN IF NOT EXISTS "{col}" {typ}')
            for col, typ in REQUIRED_ALIAS_COLUMNS.items():
                cur.execute(f'ALTER TABLE project_aliases ADD COLUMN IF NOT EXISTS "{col}" {typ}')
    after = schema_status(conn)
    return {"status": "PASS" if after["status"] == "READY" else "FAIL", "before": before, "after": after}


def validate_record(record: dict[str, Any]) -> None:
    required = {
        "project_id", "project_name", "status", "current_mission_ref", "mission_revision_id",
        "mission_hash", "current_phase", "next_hard_gate", "current_execution_policy_ref",
        "execution_policy_revision", "execution_policy_hash", "active_run_id", "active_run_ref",
        "runtime_type", "controller_contract_version", "expected_prestate", "authorization_gate",
    }
    missing = sorted(required - set(record))
    if missing:
        raise ValueError("MISSING_FIELDS:" + ",".join(missing))
    if record["project_id"] != FIRST_MIGRATION_PROJECT:
        raise ValueError("FIRST_MIGRATION_PROJECT_SCOPE_VIOLATION")
    if record["status"] != "RESERVED":
        raise ValueError("RESERVED_ONLY")
    if record["expected_prestate"] != "NOT_FOUND":
        raise ValueError("EXPECTED_PRESTATE_NOT_FOUND_REQUIRED")
    if record["authorization_gate"] != HG3_GATE:
        raise ValueError("HG3_AUTHORIZATION_MISMATCH")
    if not str(record["active_run_ref"]).startswith("github://"):
        raise ValueError("PROVIDER_QUALIFIED_ACTIVE_RUN_REF_REQUIRED")
    if record["runtime_type"] != "GITHUB_ACTIONS_BOUNDED":
        raise ValueError("RUNTIME_TYPE_MISMATCH")


def reserve_record(conn: psycopg.Connection, record: dict[str, Any]) -> dict[str, Any]:
    validate_record(record)
    if schema_status(conn)["status"] != "READY":
        return {"status": "MIGRATION_REQUIRED"}
    normalized = normalize_name(record["project_name"])
    try:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("SELECT project_id FROM projects WHERE project_id=%s FOR UPDATE", (record["project_id"],))
                if cur.fetchone() is not None:
                    return {"status": "CAS_CONFLICT", "reason": "PROJECT_ID_ALREADY_EXISTS"}
                cur.execute("SELECT project_id FROM project_aliases WHERE normalized_name=%s FOR UPDATE", (normalized,))
                if cur.fetchone() is not None:
                    return {"status": "CAS_CONFLICT", "reason": "NORMALIZED_NAME_ALREADY_BOUND"}
                cur.execute(
                    """
                    INSERT INTO projects (
                      project_id,status,active_run_id,current_mission_ref,current_mission_revision,current_mission_hash,
                      current_execution_policy_ref,current_execution_policy_revision,current_execution_policy_hash,
                      controller_contract_version,project_name,current_phase,next_hard_gate,current_mission_state,
                      active_run_ref,runtime_type,evidence_ledger_ref,learning_ledger_ref,directory_revision,
                      last_readback_at,notes
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,1,now(),%s)
                    """,
                    (
                        record["project_id"], record["status"], record["active_run_id"], record["current_mission_ref"],
                        record["mission_revision_id"], record["mission_hash"], record["current_execution_policy_ref"],
                        record["execution_policy_revision"], record["execution_policy_hash"], record["controller_contract_version"],
                        record["project_name"], record["current_phase"], record["next_hard_gate"], "CURRENT",
                        record["active_run_ref"], record["runtime_type"], record.get("evidence_ledger_ref"),
                        record.get("learning_ledger_ref"), record.get("notes"),
                    ),
                )
                cur.execute(
                    "INSERT INTO project_aliases(normalized_name,display_name,project_id,binding_status,binding_revision) VALUES (%s,%s,%s,'RESERVED',1)",
                    (normalized, record["project_name"], record["project_id"]),
                )
    except UniqueViolation:
        conn.rollback()
        return {"status": "CAS_CONFLICT", "reason": "UNIQUE_CONSTRAINT"}
    return {"status": "RESERVED", "project_id": record["project_id"], "normalized_name": normalized, "directory_revision": 1}


def _create_temp_schema(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute("""
        CREATE TEMP TABLE projects(
          project_id TEXT PRIMARY KEY,status TEXT NOT NULL,active_run_id TEXT,current_mission_ref TEXT,
          current_mission_revision TEXT,current_mission_hash TEXT,current_execution_policy_ref TEXT,
          current_execution_policy_revision TEXT,current_execution_policy_hash TEXT,
          controller_contract_version TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          project_name TEXT,current_phase TEXT,next_hard_gate TEXT,current_mission_state TEXT,
          active_run_ref TEXT,runtime_type TEXT,evidence_ledger_ref TEXT,learning_ledger_ref TEXT,
          directory_revision BIGINT NOT NULL DEFAULT 0,last_readback_at TIMESTAMPTZ,notes TEXT
        ) ON COMMIT DROP;
        CREATE TEMP TABLE project_aliases(
          normalized_name TEXT PRIMARY KEY,display_name TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES projects(project_id),
          binding_status TEXT,binding_revision BIGINT
        ) ON COMMIT DROP;
        """)


def self_test() -> int:
    record = {
        "project_id": FIRST_MIGRATION_PROJECT, "project_name": "全自動軟體工廠", "status": "RESERVED",
        "current_mission_ref": "github://mission", "mission_revision_id": "M1", "mission_hash": "sha256:m",
        "current_phase": "P", "next_hard_gate": "G0", "current_execution_policy_ref": "github://policy",
        "execution_policy_revision": "EP1", "execution_policy_hash": "sha256:p", "active_run_id": "R1",
        "active_run_ref": "github://1352411536/runs/R1?control_ref=refs/heads/x", "runtime_type": "GITHUB_ACTIONS_BOUNDED",
        "controller_contract_version": "CHAT_EXECUTION_POLICY_CONTRACT_V9_1_CANDIDATE",
        "expected_prestate": "NOT_FOUND", "authorization_gate": HG3_GATE,
    }
    with connect_db() as conn:
        with conn.transaction():
            _create_temp_schema(conn)
            assert resolve_exact(conn, record["project_name"])["status"] == "NOT_FOUND"
            first = reserve_record(conn, record)
            assert first["status"] == "RESERVED", first
            assert resolve_exact(conn, record["project_name"])["project_id"] == FIRST_MIGRATION_PROJECT
            got = get_project(conn, FIRST_MIGRATION_PROJECT)
            assert got["status"] == "FOUND" and got["status"] == "FOUND"
            second = reserve_record(conn, record)
            assert second["status"] == "CAS_CONFLICT", second
            other = dict(record); other["project_id"] = "OTHER"
            try:
                reserve_record(conn, other)
                raise AssertionError("scope guard failed")
            except ValueError as e:
                assert "SCOPE" in str(e)
            conn.rollback()
    emit({"status": "PASS", "adapter_version": VERSION, "cases": 5, "persistent_mutations": 0})
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    if len(sys.argv) < 2:
        raise SystemExit("usage: production_project_directory.py resolve NAME|get PROJECT_ID|schema-status|migrate-schema TOKEN|reserve JSON_PATH|version")
    command = sys.argv[1]
    if command == "version":
        emit({"status": "PASS", "adapter_version": VERSION}); return 0
    with connect_db() as conn:
        if command == "resolve" and len(sys.argv) >= 3:
            emit(resolve_exact(conn, sys.argv[2])); return 0
        if command == "get" and len(sys.argv) >= 3:
            emit(get_project(conn, sys.argv[2])); return 0
        if command == "schema-status":
            emit(schema_status(conn)); return 0
        if command == "migrate-schema" and len(sys.argv) >= 3:
            emit(migrate_schema(conn, sys.argv[2])); return 0
        if command == "reserve" and len(sys.argv) >= 3:
            record = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
            emit(reserve_record(conn, record)); return 0
    raise SystemExit("unknown command")


if __name__ == "__main__":
    raise SystemExit(main())
