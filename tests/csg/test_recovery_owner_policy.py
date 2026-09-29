import unittest
from recovery_owner_policy import *


NOW = "2026-09-16T08:30:00Z"
EXPIRED = {"principal_id": "OLD", "owner_generation": 7, "scope": "CSG", "lease_until": "2026-09-16T08:00:00Z"}
LIVE = {"principal_id": "OLD", "owner_generation": 7, "scope": "CSG", "lease_until": "2026-09-16T09:00:00Z"}
BASE = dict(
    provider_now=NOW,
    current_attempt_epoch=3,
    current_project_id="P1",
    current_provider="factory",
    current_attempt_id="A3",
    stop_requested=False,
    mission_match=True,
    policy_match=True,
    controller_match=True,
)


def observation(state="IN_PROGRESS", **overrides):
    result = {
        "observation_id": "OBS-1",
        "project_id": "P1",
        "provider": "factory",
        "provider_job_id": "JOB-1",
        "attempt_id": "A3",
        "attempt_epoch": 3,
        "owner_generation": 7,
        "observed_at": "2026-09-16T08:29:30Z",
        "source": "authorized-provider-readback",
        "state": state,
    }
    result.update(overrides)
    return result


def empty_observation(**overrides):
    return observation(
        state="NONE",
        provider_job_id=None,
        **overrides,
    )


class T(unittest.TestCase):
    def test_unknown_live_status_does_not_claim_or_dispatch(self):
        mode = resume_mode(owner=EXPIRED, unresolved_effects=[], live_job=None, **BASE)
        self.assertEqual(mode["mode"], "LIVE_OBSERVATION_REQUIRED")
        self.assertFalse(mode["ordinary_writer"])
        self.assertFalse(mode["redispatch"])
        self.assertEqual(authorize_action(mode["mode"], "READBACK"), "ALLOW")
        self.assertEqual(authorize_action(mode["mode"], "DISPATCH"), "DENY_NON_WRITER_MODE")

    def test_fresh_exact_empty_observation_allows_a_claim(self):
        mode = resume_mode(
            owner=EXPIRED,
            unresolved_effects=[],
            live_job=None,
            live_job_observation="OBSERVED_EMPTY",
            live_job_observation_record=empty_observation(),
            **BASE,
        )
        self.assertEqual(mode["mode"], "CLAIM_ORDINARY_OWNER")
        self.assertEqual(mode["next_owner_generation"], 8)
        self.assertTrue(mode["redispatch"])
        self.assertNotIn("transport_id", mode)

    def test_empty_observation_without_exact_identity_is_readback_only(self):
        mode = resume_mode(
            owner=EXPIRED,
            unresolved_effects=[],
            live_job=None,
            live_job_observation="OBSERVED_EMPTY",
            **BASE,
        )
        self.assertEqual(mode["mode"], "LIVE_OBSERVATION_REQUIRED")
        self.assertFalse(mode["ordinary_writer"])

    def test_job_observation_requires_matching_value(self):
        with self.assertRaisesRegex(OwnerPolicyError, "LIVE_JOB_OBSERVATION_MISMATCH"):
            resume_mode(owner=EXPIRED, unresolved_effects=[], live_job=None, live_job_observation="OBSERVED_JOB", **BASE)
        with self.assertRaisesRegex(OwnerPolicyError, "LIVE_JOB_OBSERVATION_MISMATCH"):
            resume_mode(owner=EXPIRED, unresolved_effects=[], live_job=observation(), live_job_observation="OBSERVED_EMPTY", **BASE)

    def test_stale_attempt_identity_requires_readback_reconciliation(self):
        job = observation(attempt_epoch=2)
        mode = resume_mode(owner=EXPIRED, unresolved_effects=[], live_job=job, live_job_observation="OBSERVED_JOB", **BASE)
        self.assertEqual(mode["mode"], RECONCILIATION_MODE)
        self.assertFalse(mode["ordinary_writer"])
        self.assertFalse(mode["redispatch"])
        self.assertEqual(authorize_action(mode["mode"], "DISPATCH"), "DENY_NON_WRITER_MODE")

    def test_project_provider_attempt_and_owner_identity_mismatches_fail_closed(self):
        for field, value in (("project_id", "OTHER"), ("provider", "other"), ("attempt_id", "A2"), ("owner_generation", 6)):
            with self.subTest(field=field):
                mode = resume_mode(
                    owner=EXPIRED,
                    unresolved_effects=[],
                    live_job=observation(**{field: value}),
                    live_job_observation="OBSERVED_JOB",
                    **BASE,
                )
                self.assertEqual(mode["mode"], RECONCILIATION_MODE)
                self.assertFalse(mode["ordinary_writer"])

    def test_separate_observation_record_must_match_exact_provider_job_identity(self):
        job = observation()
        record = dict(job, provider_job_id="JOB-OTHER")
        mode = resume_mode(
            owner=EXPIRED,
            unresolved_effects=[],
            live_job=job,
            live_job_observation="OBSERVED_JOB",
            live_job_observation_record=record,
            **BASE,
        )
        self.assertEqual(mode["mode"], RECONCILIATION_MODE)
        self.assertFalse(mode["ordinary_writer"])
        self.assertEqual(authorize_action(mode["mode"], "DISPATCH"), "DENY_NON_WRITER_MODE")

    def test_unrecognized_terminal_failure_or_orphan_job_state_fails_closed(self):
        for state in ("FAILED", "CANCELLED", "TIMED_OUT", "ORPHANED", "UNKNOWN", "OTHER"):
            with self.subTest(state=state):
                mode = resume_mode(
                    owner=EXPIRED,
                    unresolved_effects=[],
                    live_job=observation(state=state),
                    live_job_observation="OBSERVED_JOB",
                    **BASE,
                )
                self.assertEqual(mode["mode"], RECONCILIATION_MODE)
                self.assertFalse(mode["ordinary_writer"])
                self.assertFalse(mode["redispatch"])

    def test_stale_or_incomplete_observation_is_not_a_claim(self):
        stale = empty_observation(observed_at="2026-09-16T08:20:00Z")
        missing = empty_observation()
        del missing["source"]
        for record in (stale, missing):
            mode = resume_mode(
                owner=EXPIRED,
                unresolved_effects=[],
                live_job=None,
                live_job_observation="OBSERVED_EMPTY",
                live_job_observation_record=record,
                **BASE,
            )
            self.assertEqual(mode["mode"], "LIVE_OBSERVATION_REQUIRED")
            self.assertFalse(mode["ordinary_writer"])

    def test_action_matrix_is_specific_and_live_job_blocks_same_scope_dispatch(self):
        empty_claim = resume_mode(
            owner=EXPIRED,
            unresolved_effects=[],
            live_job=None,
            live_job_observation="OBSERVED_EMPTY",
            live_job_observation_record=empty_observation(),
            **BASE,
        )
        adopted = resume_mode(
            owner=EXPIRED,
            unresolved_effects=[],
            live_job=observation(),
            live_job_observation="OBSERVED_JOB",
            **BASE,
        )
        current = resume_mode(
            owner=LIVE,
            unresolved_effects=[],
            live_job=observation(),
            live_job_observation="OBSERVED_JOB",
            **BASE,
        )
        matrix = {
            empty_claim["mode"]: ("ALLOW", "ALLOW", "DENY_SEMANTIC_ACCEPTANCE_GATE", "ALLOW"),
            adopted["mode"]: ("DENY_LIVE_JOB_PRESENT", "DENY_LIVE_JOB_PRESENT", "DENY_SEMANTIC_ACCEPTANCE_GATE", "ALLOW"),
            current["mode"]: ("DENY_LIVE_JOB_PRESENT", "DENY_LIVE_JOB_PRESENT", "DENY_SEMANTIC_ACCEPTANCE_GATE", "ALLOW"),
            "LIVE_OBSERVATION_REQUIRED": ("DENY_NON_WRITER_MODE", "DENY_NON_WRITER_MODE", "DENY_SEMANTIC_ACCEPTANCE_GATE", "ALLOW"),
            RECONCILIATION_MODE: ("DENY_NON_WRITER_MODE", "DENY_NON_WRITER_MODE", "DENY_SEMANTIC_ACCEPTANCE_GATE", "ALLOW"),
            "ADOPT_COMPLETED_RESULT_READBACK": ("DENY_NON_WRITER_MODE", "DENY_NON_WRITER_MODE", "DENY_SEMANTIC_ACCEPTANCE_GATE", "ALLOW"),
            "RECOVERY_ONLY": ("DENY_RECOVERY_ONLY", "DENY_RECOVERY_ONLY", "DENY_RECOVERY_ONLY", "ALLOW"),
            "OBSERVER_STOPPED": ("DENY_NON_WRITER_MODE", "DENY_NON_WRITER_MODE", "DENY_SEMANTIC_ACCEPTANCE_GATE", "ALLOW"),
            "REBASE_REQUIRED": ("DENY_NON_WRITER_MODE", "DENY_NON_WRITER_MODE", "DENY_SEMANTIC_ACCEPTANCE_GATE", "ALLOW"),
        }
        actions = ("DISPATCH", "NEW_ATOMIC_UNIT", "CANONICAL_ACCEPT", "READBACK")
        for mode, expected in matrix.items():
            for action, want in zip(actions, expected):
                with self.subTest(mode=mode, action=action):
                    self.assertEqual(authorize_action(mode, action), want)
        self.assertFalse(adopted["redispatch"])
        self.assertNotIn("DISPATCH", adopted["allowed_actions"])

    def test_two_sessions_generation_is_monotonic(self):
        kwargs = dict(owner=EXPIRED, unresolved_effects=[], live_job=None, live_job_observation="OBSERVED_EMPTY", live_job_observation_record=empty_observation(), **BASE)
        first = resume_mode(**kwargs)
        second = resume_mode(**kwargs)
        self.assertEqual(first["next_owner_generation"], 8)
        self.assertEqual(second["next_owner_generation"], 8)

    def test_receipt_identity_quarantine(self):
        common = dict(receipt_attempt_epoch=3, current_attempt_epoch=3, receipt_mission_revision="M", current_mission_revision="M")
        self.assertEqual(classify_receipt(receipt_owner_generation=7, current_owner_generation=8, **common), "QUARANTINE_STALE_OWNER")
        self.assertEqual(classify_receipt(receipt_owner_generation=8, current_owner_generation=8, receipt_attempt_epoch=2, current_attempt_epoch=3, receipt_mission_revision="M", current_mission_revision="M"), "QUARANTINE_STALE_ATTEMPT")
        self.assertEqual(classify_receipt(receipt_owner_generation=8, current_owner_generation=8, receipt_attempt_epoch=3, current_attempt_epoch=3, receipt_mission_revision="OLD", current_mission_revision="M"), "QUARANTINE_STALE_MISSION")

    def test_pending_expired_owner_is_recovery_only(self):
        mode = resume_mode(owner=EXPIRED, unresolved_effects=["op1"], live_job=None, **BASE)
        self.assertEqual(mode["mode"], "RECOVERY_ONLY")
        self.assertEqual(mode["next_owner_generation"], 8)
        self.assertTrue(mode["preserve_pending"])
        self.assertEqual(authorize_action(mode["mode"], "READBACK"), "ALLOW")
        self.assertEqual(authorize_action(mode["mode"], "DISPATCH"), "DENY_RECOVERY_ONLY")

    def test_completed_live_job_is_readback_only(self):
        mode = resume_mode(
            owner=EXPIRED,
            unresolved_effects=[],
            live_job=observation(state="COMPLETED"),
            live_job_observation="OBSERVED_JOB",
            **BASE,
        )
        self.assertEqual(mode["mode"], "ADOPT_COMPLETED_RESULT_READBACK")
        self.assertEqual(authorize_action(mode["mode"], "DISPATCH"), "DENY_NON_WRITER_MODE")

    def test_client_clock_cannot_override_provider_time(self):
        self.assertFalse(owner_expired(LIVE, NOW))
        self.assertTrue(owner_expired(EXPIRED, NOW))

    def test_stop_and_rebase_block_writers(self):
        stopped = dict(BASE, stop_requested=True)
        mode = resume_mode(owner=EXPIRED, unresolved_effects=[], live_job=None, **stopped)
        self.assertEqual(mode["mode"], "OBSERVER_STOPPED")
        self.assertFalse(mode["ordinary_writer"])
        rebase = dict(BASE, mission_match=False)
        mode = resume_mode(owner=EXPIRED, unresolved_effects=[], live_job=None, **rebase)
        self.assertEqual(mode["mode"], "REBASE_REQUIRED")

    def test_transport_identity_is_not_owner_identity(self):
        claim = claim_tuple(principal_id="P", owner_generation=8, attempt_id="A", attempt_epoch=3, transport_id="T")
        self.assertNotEqual(claim["principal_id"], claim["transport_id"])
        self.assertEqual(claim["owner_generation"], 8)


if __name__ == "__main__":
    unittest.main(verbosity=2)
