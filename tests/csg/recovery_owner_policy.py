from __future__ import annotations

from datetime import datetime, timedelta, timezone


class OwnerPolicyError(ValueError):
    pass


READ_ACTIONS = {"READBACK", "CLASSIFY_EFFECT", "WRITE_RECOVERY_RECEIPT"}
ORDINARY_ACTIONS = {"DISPATCH", "NEW_ATOMIC_UNIT", "CANONICAL_ACCEPT"}
SUPPORTED_JOB_STATES = {"QUEUED", "IN_PROGRESS", "COMPLETED"}
RECONCILIATION_MODE = "LIVE_JOB_RECONCILIATION_REQUIRED"
MAX_OBSERVATION_AGE_SECONDS = 300


def parse_utc(value: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise OwnerPolicyError("UTC_REQUIRED")
    try:
        return datetime.fromisoformat(value[:-1] + "+00:00").astimezone(timezone.utc)
    except ValueError as exc:
        raise OwnerPolicyError("INVALID_UTC") from exc


def owner_expired(owner: dict | None, provider_now: str) -> bool:
    if owner is None:
        return True
    return parse_utc(provider_now) >= parse_utc(owner["lease_until"])


def classify_receipt(
    *,
    receipt_owner_generation: int,
    current_owner_generation: int,
    receipt_attempt_epoch: int,
    current_attempt_epoch: int,
    receipt_mission_revision: str,
    current_mission_revision: str,
) -> str:
    if receipt_mission_revision != current_mission_revision:
        return "QUARANTINE_STALE_MISSION"
    if receipt_attempt_epoch != current_attempt_epoch:
        return "QUARANTINE_STALE_ATTEMPT"
    if receipt_owner_generation != current_owner_generation:
        return "QUARANTINE_STALE_OWNER"
    return "CURRENT_RECEIPT"


def _readback_only(mode: str, **fields) -> dict:
    return {
        "mode": mode,
        "ordinary_writer": False,
        "redispatch": False,
        "allowed_actions": ["READBACK"],
        **fields,
    }


def _validate_observation(
    observation: dict | None,
    *,
    provider_now: str,
    expected_project_id: str | None,
    expected_provider: str | None,
    expected_attempt_id: str | None,
    expected_attempt_epoch: int,
    expected_owner_generation: int | None,
    expected_state: str,
    allow_job_id: bool,
) -> bool:
    required = {
        "observation_id",
        "project_id",
        "provider",
        "provider_job_id",
        "attempt_id",
        "attempt_epoch",
        "owner_generation",
        "observed_at",
        "source",
        "state",
    }
    if not isinstance(observation, dict) or not required.issubset(observation):
        return False
    if not all(isinstance(observation.get(key), str) and observation[key] for key in ("observation_id", "project_id", "provider", "attempt_id", "observed_at", "source", "state")):
        return False
    if observation["project_id"] != expected_project_id or observation["provider"] != expected_provider:
        return False
    if observation["attempt_id"] != expected_attempt_id or observation["attempt_epoch"] != expected_attempt_epoch:
        return False
    if observation["owner_generation"] != expected_owner_generation:
        return False
    if observation["state"] != expected_state:
        return False
    job_id = observation["provider_job_id"]
    if allow_job_id and (not isinstance(job_id, str) or not job_id):
        return False
    if not allow_job_id and job_id is not None:
        return False
    try:
        observed_at = parse_utc(observation["observed_at"])
        now = parse_utc(provider_now)
    except OwnerPolicyError:
        return False
    age = (now - observed_at).total_seconds()
    return 0 <= age <= MAX_OBSERVATION_AGE_SECONDS



def _validate_local_liveness_observation(
    observation: dict | None,
    *,
    provider_now: str,
    expected_project_id: str | None,
    expected_provider: str | None,
    expected_attempt_id: str | None,
    expected_attempt_epoch: int,
    owner: dict | None,
    provider_observation_id: str,
) -> bool:
    if not isinstance(owner, dict):
        return False
    expected_owner_generation = owner.get("owner_generation")
    expected_owner_principal_id = owner.get("principal_id")
    expected_owner_scope = owner.get("scope")
    if type(expected_owner_generation) is not int or not isinstance(expected_owner_principal_id, str) or not expected_owner_principal_id:
        return False
    if not isinstance(expected_owner_scope, str) or not expected_owner_scope:
        return False

    required = {
        "observation_id",
        "provider_observation_id",
        "project_id",
        "provider",
        "attempt_id",
        "attempt_epoch",
        "owner_generation",
        "owner_principal_id",
        "owner_scope",
        "observed_at",
        "source",
        "components",
    }
    if not isinstance(observation, dict) or not required.issubset(observation):
        return False
    string_fields = (
        "observation_id",
        "provider_observation_id",
        "project_id",
        "provider",
        "attempt_id",
        "owner_principal_id",
        "owner_scope",
        "observed_at",
        "source",
    )
    if not all(isinstance(observation.get(key), str) and observation[key] for key in string_fields):
        return False
    if observation["provider_observation_id"] != provider_observation_id:
        return False
    if observation["project_id"] != expected_project_id or observation["provider"] != expected_provider:
        return False
    if observation["attempt_id"] != expected_attempt_id or observation["attempt_epoch"] != expected_attempt_epoch:
        return False
    if observation["owner_generation"] != expected_owner_generation:
        return False
    if observation["owner_principal_id"] != expected_owner_principal_id or observation["owner_scope"] != expected_owner_scope:
        return False

    expected_components = {
        "os_process": ("local-os-process-readback", {"ABSENT", "EXITED"}),
        "provider_agent_session": ("provider-agent-session-readback", {"ABSENT", "TERMINAL"}),
        "supervisor_heartbeat": ("host-supervisor-heartbeat-readback", {"ABSENT", "EXPIRED"}),
    }
    components = observation["components"]
    if not isinstance(components, dict) or set(components) != set(expected_components):
        return False
    observation_ids = [observation["observation_id"]]
    try:
        now = parse_utc(provider_now)
        observed_at = parse_utc(observation["observed_at"])
    except OwnerPolicyError:
        return False
    age = (now - observed_at).total_seconds()
    if not 0 <= age <= MAX_OBSERVATION_AGE_SECONDS:
        return False

    component_required = {
        "observation_id",
        "project_id",
        "provider",
        "attempt_id",
        "attempt_epoch",
        "owner_generation",
        "owner_principal_id",
        "owner_scope",
        "observed_at",
        "source",
        "state",
    }
    component_string_fields = (
        "observation_id",
        "project_id",
        "provider",
        "attempt_id",
        "owner_principal_id",
        "owner_scope",
        "observed_at",
        "source",
        "state",
    )
    for component_name, (expected_source, allowed_states) in expected_components.items():
        component = components[component_name]
        if not isinstance(component, dict) or not component_required.issubset(component):
            return False
        if not all(isinstance(component.get(key), str) and component[key] for key in component_string_fields):
            return False
        if component["source"] != expected_source or component["state"] not in allowed_states:
            return False
        if component["project_id"] != expected_project_id or component["provider"] != expected_provider:
            return False
        if component["attempt_id"] != expected_attempt_id or component["attempt_epoch"] != expected_attempt_epoch:
            return False
        if component["owner_generation"] != expected_owner_generation:
            return False
        if component["owner_principal_id"] != expected_owner_principal_id or component["owner_scope"] != expected_owner_scope:
            return False
        try:
            component_age = (now - parse_utc(component["observed_at"])).total_seconds()
        except OwnerPolicyError:
            return False
        if not 0 <= component_age <= MAX_OBSERVATION_AGE_SECONDS:
            return False
        observation_ids.append(component["observation_id"])

    return provider_observation_id not in observation_ids and len(set(observation_ids)) == len(observation_ids)


def resume_mode(
    *,
    owner: dict | None,
    provider_now: str,
    unresolved_effects: list,
    live_job: dict | None,
    current_attempt_epoch: int,
    stop_requested: bool,
    mission_match: bool,
    policy_match: bool,
    controller_match: bool,
    live_job_observation: str = "UNKNOWN",
    live_job_observation_record: dict | None = None,
    local_liveness_observation: dict | None = None,
    current_project_id: str | None = None,
    current_provider: str | None = None,
    current_attempt_id: str | None = None,
) -> dict:
    if live_job_observation not in {"UNKNOWN", "OBSERVED_EMPTY", "OBSERVED_JOB"}:
        raise OwnerPolicyError("INVALID_LIVE_JOB_OBSERVATION")
    if (live_job_observation == "OBSERVED_EMPTY" and live_job is not None) or (
        live_job_observation == "OBSERVED_JOB" and live_job is None
    ):
        raise OwnerPolicyError("LIVE_JOB_OBSERVATION_MISMATCH")
    if stop_requested:
        return _readback_only("OBSERVER_STOPPED")
    if not (mission_match and policy_match and controller_match):
        return _readback_only("REBASE_REQUIRED")
    expired = owner_expired(owner, provider_now)
    if unresolved_effects:
        return {
            "mode": "RECOVERY_ONLY",
            "ordinary_writer": False,
            "redispatch": False,
            "next_owner_generation": (owner or {}).get("owner_generation", 0) + 1,
            "preserve_pending": True,
            "allowed_actions": sorted(READ_ACTIONS),
        }
    if live_job_observation == "UNKNOWN":
        fields = {"owner_liveness_status": "STALE_EXECUTION_OWNER_CANDIDATE"} if expired else {}
        return _readback_only("LIVE_OBSERVATION_REQUIRED", live_job_observation="UNKNOWN", **fields)

    observation = live_job_observation_record
    if observation is None and live_job_observation == "OBSERVED_JOB":
        observation = live_job
    expected_owner_generation = (owner or {}).get("owner_generation")

    if live_job_observation == "OBSERVED_EMPTY":
        valid = _validate_observation(
            observation,
            provider_now=provider_now,
            expected_project_id=current_project_id,
            expected_provider=current_provider,
            expected_attempt_id=current_attempt_id,
            expected_attempt_epoch=current_attempt_epoch,
            expected_owner_generation=expected_owner_generation,
            expected_state="NONE",
            allow_job_id=False,
        )
        if not valid:
            fields = {"owner_liveness_status": "STALE_EXECUTION_OWNER_CANDIDATE"} if expired else {}
            return _readback_only("LIVE_OBSERVATION_REQUIRED", reason="EMPTY_OBSERVATION_IDENTITY_OR_FRESHNESS_REQUIRED", **fields)
        if expired:
            local_valid = _validate_local_liveness_observation(
                local_liveness_observation,
                provider_now=provider_now,
                expected_project_id=current_project_id,
                expected_provider=current_provider,
                expected_attempt_id=current_attempt_id,
                expected_attempt_epoch=current_attempt_epoch,
                owner=owner,
                provider_observation_id=observation["observation_id"],
            )
            if not local_valid:
                return _readback_only(
                    "LIVE_OBSERVATION_REQUIRED",
                    reason="LOCAL_OWNER_LIVENESS_NOT_PROVEN",
                    owner_liveness_status="STALE_EXECUTION_OWNER_CANDIDATE",
                    provider_observation_id=observation["observation_id"],
                )
            return {
                "mode": "CLAIM_ORDINARY_OWNER",
                "ordinary_writer": True,
                "redispatch": True,
                "next_owner_generation": owner["owner_generation"] + 1,
                "observation_id": observation["observation_id"],
                "provider_observation_id": observation["observation_id"],
                "local_liveness_observation_id": local_liveness_observation["observation_id"],
                "local_liveness_component_observation_ids": {
                    key: local_liveness_observation["components"][key]["observation_id"]
                    for key in ("os_process", "provider_agent_session", "supervisor_heartbeat")
                },
                "owner_liveness_status": "STALE_OWNER_CONFIRMED",
                "allowed_actions": ["DISPATCH", "NEW_ATOMIC_UNIT", "READBACK"],
            }
        return {
            "mode": "CURRENT_OWNER_CONTINUES",
            "ordinary_writer": True,
            "redispatch": True,
            "owner_generation": owner["owner_generation"],
            "observation_id": observation["observation_id"],
            "allowed_actions": ["DISPATCH", "NEW_ATOMIC_UNIT", "READBACK"],
        }

    if not isinstance(live_job, dict):
        return _readback_only(RECONCILIATION_MODE, reason="LIVE_JOB_IDENTITY_REQUIRED")
    state = live_job.get("state")
    if state not in SUPPORTED_JOB_STATES:
        return _readback_only(RECONCILIATION_MODE, reason="UNSUPPORTED_OR_TERMINAL_FAILURE_STATE")
    if not isinstance(observation, dict) or any(
        observation.get(field) != live_job.get(field)
        for field in (
            "project_id",
            "provider",
            "provider_job_id",
            "attempt_id",
            "attempt_epoch",
            "owner_generation",
            "observed_at",
            "source",
            "state",
        )
    ):
        return _readback_only(RECONCILIATION_MODE, reason="LIVE_JOB_OBSERVATION_RECORD_MISMATCH")
    valid = _validate_observation(
        observation,
        provider_now=provider_now,
        expected_project_id=current_project_id,
        expected_provider=current_provider,
        expected_attempt_id=current_attempt_id,
        expected_attempt_epoch=current_attempt_epoch,
        expected_owner_generation=expected_owner_generation,
        expected_state=state,
        allow_job_id=True,
    )
    if not valid:
        return _readback_only(RECONCILIATION_MODE, reason="LIVE_JOB_IDENTITY_OR_FRESHNESS_MISMATCH")
    if state in {"QUEUED", "IN_PROGRESS"}:
        if expired:
            return _readback_only(
                "ADOPT_LIVE_JOB",
                next_owner_generation=(owner or {}).get("owner_generation", 0) + 1,
                attempt_epoch=current_attempt_epoch,
                provider_job_id=live_job["provider_job_id"],
                observation_id=observation["observation_id"],
            )
        return {
            "mode": "CURRENT_OWNER_CONTINUES",
            "ordinary_writer": False,
            "redispatch": False,
            "owner_generation": owner["owner_generation"],
            "attempt_epoch": current_attempt_epoch,
            "provider_job_id": live_job["provider_job_id"],
            "observation_id": observation["observation_id"],
            "allowed_actions": ["READBACK"],
        }
    return _readback_only(
        "ADOPT_COMPLETED_RESULT_READBACK",
        attempt_epoch=current_attempt_epoch,
        provider_job_id=live_job["provider_job_id"],
        observation_id=observation["observation_id"],
    )


def authorize_action(mode: str, action: str) -> str:
    if action not in READ_ACTIONS | ORDINARY_ACTIONS:
        raise OwnerPolicyError("UNKNOWN_ACTION")
    capabilities = {
        "RECOVERY_ONLY": READ_ACTIONS,
        "OBSERVER_STOPPED": {"READBACK"},
        "REBASE_REQUIRED": {"READBACK"},
        "LIVE_OBSERVATION_REQUIRED": {"READBACK"},
        RECONCILIATION_MODE: {"READBACK"},
        "ADOPT_LIVE_JOB": {"READBACK"},
        "CURRENT_OWNER_CONTINUES": {"READBACK"},
        "ADOPT_COMPLETED_RESULT_READBACK": {"READBACK"},
        "CLAIM_ORDINARY_OWNER": {"READBACK", "DISPATCH", "NEW_ATOMIC_UNIT"},
    }
    if mode not in capabilities:
        raise OwnerPolicyError("UNKNOWN_MODE")
    if action in capabilities[mode]:
        return "ALLOW"
    if mode in {"ADOPT_LIVE_JOB", "CURRENT_OWNER_CONTINUES"} and action in {"DISPATCH", "NEW_ATOMIC_UNIT"}:
        return "DENY_LIVE_JOB_PRESENT"
    if mode == "RECOVERY_ONLY":
        return "DENY_RECOVERY_ONLY"
    if action == "CANONICAL_ACCEPT":
        return "DENY_SEMANTIC_ACCEPTANCE_GATE"
    return "DENY_NON_WRITER_MODE"


def claim_tuple(*, principal_id: str, owner_generation: int, attempt_id: str, attempt_epoch: int, transport_id: str) -> dict:
    return {
        "principal_id": principal_id,
        "owner_generation": owner_generation,
        "attempt_id": attempt_id,
        "attempt_epoch": attempt_epoch,
        "transport_id": transport_id,
    }
