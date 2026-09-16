from __future__ import annotations

import copy
import re
import unicodedata

CAPABILITY_SCHEMA = "CSG_ADMISSION_CAPABILITY_V1"
REQUIRED_ANCHOR_FIELDS = {
    "mission_ref", "mission_revision", "mission_hash",
    "policy_ref", "policy_revision", "policy_hash",
    "canonical_control_ref", "runtime_type", "controller_contract_version",
}

class AdmissionError(ValueError):
    pass


def normalize_name(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).strip().casefold()
    return re.sub(r"\s+", " ", value)


def _require_capability(capability: dict, operation: str, project_id: str) -> None:
    if capability.get("schema") != CAPABILITY_SCHEMA:
        raise AdmissionError("CAPABILITY_SCHEMA_INVALID")
    if capability.get("authorization_gate") != "HUMAN_PROJECT_ADMISSION_EXACT_SCOPE":
        raise AdmissionError("HUMAN_ADMISSION_GATE_REQUIRED")
    if operation not in capability.get("operations", []):
        raise AdmissionError("OPERATION_NOT_AUTHORIZED")
    if project_id not in capability.get("project_ids", []):
        raise AdmissionError("PROJECT_SCOPE_NOT_AUTHORIZED")


def new_state() -> dict:
    return {"projects": {}, "aliases": {}}


def reserve(state: dict, record: dict, capability: dict) -> dict:
    project_id = record["project_id"]
    _require_capability(capability, "reserve", project_id)
    if record.get("expected_prestate") != "NOT_FOUND":
        raise AdmissionError("EXPECTED_PRESTATE_NOT_FOUND_REQUIRED")
    if record.get("project_status") != "RESERVED":
        raise AdmissionError("RESERVED_ONLY")
    normalized = normalize_name(record["project_name"])
    existing_project = state["projects"].get(project_id)
    existing_alias = state["aliases"].get(normalized)
    if existing_project is not None:
        if existing_project["binding_status"] == "RESERVED" and existing_project["normalized_name"] == normalized:
            return {"status": "RESERVED_IDEMPOTENT", "project_id": project_id, "directory_revision": existing_project["directory_revision"]}
        return {"status": "CAS_CONFLICT", "reason": "PROJECT_ID_ALREADY_EXISTS"}
    if existing_alias is not None:
        if existing_alias == project_id:
            return {"status": "RESERVED_IDEMPOTENT", "project_id": project_id, "directory_revision": 1}
        return {"status": "CAS_CONFLICT", "reason": "NORMALIZED_NAME_ALREADY_BOUND"}
    state["projects"][project_id] = {
        "project_id": project_id,
        "project_name": record["project_name"],
        "project_status": "RESERVED",
        "binding_status": "RESERVED",
        "normalized_name": normalized,
        "directory_revision": 1,
        "anchor": None,
    }
    state["aliases"][normalized] = project_id
    return {"status": "RESERVED", "project_id": project_id, "directory_revision": 1}


def _validate_anchor(anchor: dict) -> None:
    missing = sorted(REQUIRED_ANCHOR_FIELDS - set(anchor))
    if missing:
        raise AdmissionError("ANCHOR_MISSING_FIELDS:" + ",".join(missing))
    if not str(anchor["canonical_control_ref"]).startswith("github://"):
        raise AdmissionError("PROVIDER_QUALIFIED_CANONICAL_CONTROL_REQUIRED")
    if not anchor["mission_hash"].startswith("sha256:") or not anchor["policy_hash"].startswith("sha256:"):
        raise AdmissionError("ANCHOR_HASH_INVALID")


def bind(state: dict, project_id: str, anchor: dict, expected_directory_revision: int, capability: dict) -> dict:
    _require_capability(capability, "bind", project_id)
    _validate_anchor(anchor)
    project = state["projects"].get(project_id)
    if project is None:
        return {"status": "NOT_FOUND", "project_id": project_id}
    if project["directory_revision"] != expected_directory_revision:
        return {"status": "CAS_CONFLICT", "reason": "DIRECTORY_REVISION_MISMATCH", "observed_revision": project["directory_revision"]}
    if project["binding_status"] == "BOUND":
        if project["anchor"] == anchor:
            return {"status": "BOUND_IDEMPOTENT", "project_id": project_id, "directory_revision": project["directory_revision"]}
        return {"status": "CAS_CONFLICT", "reason": "BOUND_ANCHOR_MISMATCH"}
    if project["binding_status"] != "RESERVED":
        return {"status": "CAS_CONFLICT", "reason": "BINDING_STATUS_MISMATCH"}
    project["binding_status"] = "BOUND"
    project["anchor"] = copy.deepcopy(anchor)
    project["directory_revision"] += 1
    return {"status": "BOUND", "project_id": project_id, "directory_revision": project["directory_revision"]}


def permit_ordinary_unit(state: dict, project_id: str) -> dict:
    project = state["projects"].get(project_id)
    if project is None:
        return {"status": "DENIED", "reason": "PROJECT_NOT_FOUND"}
    if project["binding_status"] != "BOUND" or not project["anchor"]:
        return {"status": "DENIED", "reason": "PROJECT_NOT_BOUND"}
    return {"status": "PERMITTED", "project_id": project_id, "directory_revision": project["directory_revision"]}


def retire(state: dict, project_id: str, expected_directory_revision: int, capability: dict) -> dict:
    _require_capability(capability, "retire", project_id)
    project = state["projects"].get(project_id)
    if project is None:
        return {"status": "NOT_FOUND", "project_id": project_id}
    if project["directory_revision"] != expected_directory_revision:
        return {"status": "CAS_CONFLICT", "reason": "DIRECTORY_REVISION_MISMATCH", "observed_revision": project["directory_revision"]}
    project["binding_status"] = "RETIRED"
    project["directory_revision"] += 1
    return {"status": "RETIRED", "project_id": project_id, "directory_revision": project["directory_revision"]}


def get_exact_project(state: dict, project_id: str) -> dict:
    project = state["projects"].get(project_id)
    if project is None:
        return {"status": "NOT_FOUND", "project_id": project_id}
    return {"status": "FOUND", "project": copy.deepcopy(project)}
