# VNEXT5.1-R2 Root-Cause Closure Construction Plan

**Project:** `CHATGPT_GLOBAL_SKILL_GOVERNANCE` / 全自動軟體工廠  
**日期:** 2026-10-02  
**文件角色:** `EXECUTION_CLOSURE_PLAN`  
**版本政策:** **不建立 VNEXT5.1-R3；不取代 Human Current Spec `VNEXT5.1-R2`。**  
**目的:** 將最近多日由 ChatGPT Web + Codex 造成的治理自鎖、phase cycle、owner drift、SHA churn、能力回退、review gate、trusted-caller 漏洞與 cross-session 續接問題，收斂成一次可執行、可驗收、可停止重複補 Prompt 的施工閉環。

---

## 0. Authority / Usage Contract

本檔案不是新的 Mission、不是新的 Spec family、不是新的 canonical store，也不是要求 Human 再授權一次。

權威順序固定：

```text
Human latest explicit Mission/Spec
> Current VNEXT5.1-R2 Mission / Spec
> Current Policy clauses consistent with Human Spec
> canonical control
> verified provider/runtime facts
> this execution closure plan
> historical chat / handoff / Memory
```

本檔案的工作是把既有 `VNEXT5.1-R2` **做完**，不是再創造治理層。

Codex 收到本檔後，不得要求 Human 反覆貼補充 Prompt。除非發生：

- Human 明確修改 Mission / Current Spec；
- Production 最終授權；
- 新增費用；
- 法律／契約／簽署／身分；
- OAuth／MFA；
- 重大不可逆 authority expansion；
- same-source reconciliation 後仍無法釐清的外部副作用；
- 真正缺少且無法自行取得的重要現實資訊。

其餘 reversible pre-Production 工作直接依本檔、Current Spec、canonical state 繼續。

---

## 1. Frozen Fresh Prestate at Plan Publication

```text
PROJECT_ID = CHATGPT_GLOBAL_SKILL_GOVERNANCE
CANONICAL_CONTROL_REF = refs/heads/v45/factory-control
CANONICAL_CONTROL_HEAD = d39486601d851e31256852a24e9c1393b9046fe5
CURRENT_CHECKPOINT = 200
CURRENT_CHECKPOINT_PATH = governance/csg/checkpoints/000200.json
CURRENT_MISSION = 20260930T104733+0800
CURRENT_POLICY = 20260930T104733+0800-EP80
CURRENT_SPEC = VNEXT5.1-R2
CURRENT_ACTIVE_UNIT = V51-R2-02-STALE-OWNER-LIVENESS-RECONCILIATION
CURRENT_OWNER_GENERATION = 5
CURRENT_OWNER_LEASE = EXPIRED
CANONICAL_UNRESOLVED_EFFECTS = []
```

Fresh live Factory observation at plan creation:

```text
HOST = DESKTOP-1B6PD2P
RUN_AS = NT AUTHORITY\SYSTEM
VM = PTYSD-WORKER-01 / Running
SSH22 = reachable
HOST_EXEC_LANE = IDLE_WITH_ORPHANS
active_count = 0
effective_active_count = 0
live_job_count = 0
pending_receipt_count = 0
orphan_count = 5
stale_count = 0
capacity = 4
tunnel.live = true
tunnel.ready = true
control_plane_status = ok
```

Frozen source candidates:

```text
PR381 = af50480a00f8a307058ef171468d553a0ef61101
  role = R2-03 Factory MCP source-only candidate

PR377 = 070555ab3753f35fa250f651f5175adb9bd5cd25
  role = R2-02 runtime / cross-source recovery candidate

PR383 = 8892148630d84b691f46411990249a91430b7066
  role = draft CP201 policy/DAG normalization candidate
  disposition = CHANGES_REQUIRED_BEFORE_ANY_PROMOTION
```

**所有後續執行都必須先 fresh-read；以上只作本檔發布時的 exact baseline，不可把它當永久 current truth。**

---

## 2. Root-Cause Findings That Must Be Closed

### RC-01 `POLICY_OVERCONSTRAINT`
Derived Policy 曾增加 Human Spec 沒要求的 acceptance prerequisite，造成合法工作被自己封鎖。

```text
POLICY_CLAUSE_MUST_HAVE_HUMAN_SPEC_BASIS
UNAPPROVED_STRICTER_CLAUSE = NON_BLOCKING_QUARANTINED
```

### RC-02 `PHASE_DEPENDENCY_CYCLE`
R2-02 / R2-03 / R2-04 / R2-05 / R2-06 曾互相成為前置，形成 circular bootstrap。

```text
PHASE_DAG_ACYCLIC = TRUE
FUTURE_PHASE_NOT_CURRENT_ACCEPTANCE_PREREQUISITE = TRUE
```

### RC-03 `RUNTIME_GATE_OVERREACH`
Mission/checkpoint/run/task/attempt/generation/Session rollover 被錯當 Host transport permission。

```text
MISSION_CHECKPOINT_RUN_TASK_SESSION_METADATA != TRANSPORT_AUTHORIZATION
```

真正保留的 transport/safety gate：exact project/host、STOP、unique trusted caller、真 concurrent owner conflict、unknown effect、provider/backend CAS、timeout、bounded output、concurrency、durable receipt、same-source readback、rollback、Human-reserved Production gates。

### RC-04 `AUTHORIZED_CAPABILITY_REGRESSION`
Factory MCP upgrade 曾移除/降級仍授權能力。

```text
SOURCE_TEST_PASS != LIVE_CAPABILITY_PARITY_PASS
AUTHORIZED_CAPABILITY_REGRESSION => INSTALL_FORBIDDEN
```

### RC-05 `TRUSTED_CALLER_BOUNDARY_GAP`
PR381 installer 仍讓 `NT AUTHORITY\NETWORK SERVICE` 對 broker queue 具 Modify；SYSTEM broker 消費 queue JSON。Shared SID 不能證明唯一 Factory MCP caller。

```text
GENERIC_NETWORK_SERVICE_PROCESS_CANNOT_INJECT_SYSTEM_POWERSHELL
```

必須採 dedicated service SID / dedicated service account / 等價 OS-enforced unique principal，並以 ACL + negative injection test 證明。

### RC-06 `DERIVED_STATUS_AUTHORITY_DRIFT`

```text
MISSION_LIFECYCLE
TASK_STATE
OWNER_LIVENESS
PROVIDER_JOB_STATE
```

四者正交，不得互相推論。

### RC-07 `CANDIDATE_OWNER_IDENTITY_LEAK`

```text
CANONICAL_OWNER_NOT_ALLOCATED_BEFORE_PROMOTION = TRUE
```

candidate 可以有 build/test executor identity，但 canonical owner 只能在 fresh promotion/dispatch CAS 配置。

### RC-08 `SELF_RESETTING_CHURN_FUSE`

```text
LOGICAL_WORK_FINGERPRINT_EXCLUDES_CANDIDATE_OUTPUT_SHA
SELF_GENERATED_HEAD_CHANGE_DOES_NOT_RESET_FUSE
```

只有 Human Spec/Mission、acceptance contract、真正 upstream input、canonical prestate 被其他合法 transition 改變、或新 concrete source defect，才算 exogenous material delta。

### RC-09 `INVENTED_REVIEW_GATE`

```text
REVIEW_REQUIRED_ONLY_IF_HUMAN_SPEC_OR_ACCEPTANCE_CONTRACT_REQUIRES_IT
REVIEW_PROVIDER_UNAVAILABLE = LANE_BLOCKED_ONLY
```

### RC-10 `BLOCKER_SCOPE_ESCALATION`

```text
PROJECT_BLOCKED_ONLY_IF_ALL_LEGAL_READY_LANES_EXHAUSTED
```

### RC-11 `HUMAN_PROGRESS_RELAY_DEPENDENCY`

```text
NO_HUMAN_PROGRESS_RELAY
```

### RC-12 `STALE_WAKE_AUTHORITY`

```text
SCHEDULED_WAKE_PAYLOAD = LOCATOR_ONLY
STALE_WAKE_PAYLOAD = IGNORE
```

### RC-13 `EVIDENCE_LEVEL_COLLAPSE`

```text
LOCAL_TEST_PASS
STRUCTURAL_VERIFIER_PASS
SEMANTIC_REVIEW_PASS
LIVE_ACCEPTANCE_PASS
SYSTEM_ACCEPTANCE_PASS
```

各自 exact-target 綁定，不可升格互代。

---

## 3. Immediate Disposition of PR383

**PR383 不得依目前 exact head `8892148630d84b691f46411990249a91430b7066` promotion 成 CP201。**

允許且只允許一次針對已知 concrete defects 的最小修正；這是 `NEW_CONCRETE_SOURCE_DEFECT`，不是無證據 churn。

必修：

1. **Revision path identity**
   - mission / policy filename 與 declared revision identity 必須一致；或全面採 content-addressed identity，不可雙軌。
2. **Owner coherence**
   - checkpoint/run ownerless 時，Policy 不得殘留 active Codex execution owner。
3. **Remove invented semantic-review hard gate from R2-03**
   - review status 可紀錄，但 pending reviewer/Copilot quota 不得阻止符合 Human Spec 的 R2-03 source qualification。
4. **Remove R2-02B <- R2-03 artificial dependency**
   - owner expiry control transition 與 R2-03 source qualification分離。
5. **Deduplicate state arrays**
   - parked_lanes / blockers / evidence refs deterministic set normalization。
6. **Remove stale PR382 authority/reference**
   - PR382 已 closed/superseded，不得作 current packet authority。
7. **Reuse existing Human trust authorization when scope unchanged**
   - checkpoint/Session/revision rollover 不得重生 Human Gate。

修正後只做：

```text
one exact-head deterministic regression
+ exact provider readback
+ freeze covered bytes
```

沒有新 concrete source defect，不得再 rebuild 第三次。

---

## 4. Construction DAG — Closure Units C0 to C11

### C0 — Control-plane normalization

修 PR383 七項問題並加入 deterministic Governance Linter：

```text
POLICY_NOT_STRONGER_THAN_HUMAN_SPEC
PHASE_DAG_ACYCLIC
NO_FUTURE_PHASE_AS_CURRENT_PREREQUISITE
NO_STALE_PHASE_NAMES
NO_INVENTED_HUMAN_GATE
NO_INVENTED_REVIEW_GATE
NO_CANDIDATE_CANONICAL_OWNER
NO_PATH_REVISION_ID_MISMATCH
NO_STALE_PR_OR_SHA_AUTHORITY
NO_DUPLICATE_BLOCKED_LANE
NO_METADATA_TRANSPORT_DENIAL
NO_CAPABILITY_REGRESSION
NO_SELF_RESETTING_CHURN_FINGERPRINT
```

PASS = linter regression PASS + PR383 修正版 exact-head clean；**尚不等於 canonical promotion**。

### C1 — Stale owner control-only cleanup

fresh-read 確認：

```text
owner generation 5 lease expired
live_job_count = 0
pending_receipt_count = 0
unresolved_effect_refs = []
```

若仍成立：

```text
fresh prestate
-> CAS close/revoke expired owner authority only
-> NO new owner allocation
-> NO dispatch
-> NO Host mutation
-> same-source readback
-> recompute READY
```

### C2 — R2-03 fixed read-only source qualification

凍結：

```text
PR381 = af50480a00f8a307058ef171468d553a0ef61101
PR377 = 070555ab3753f35fa250f651f5175adb9bd5cd25
```

只驗 Human Spec 的 fixed-purpose observation：exactly 4 public tools、factory_status read-only、runtime/hash projection、per-orphan identity/receipt refs contract、service/process/task identity、supervisor/fleet/trusted-caller status projection、read-only path 無 arbitrary PowerShell、無 Host mutation、mutation fence NOT_REQUIRED、capability non-regression candidate evidence。

Review status 可記錄，但 pending reviewer 不得成 R2-03 hard gate。

### C3 — R2-04 Unique trusted caller

採 dedicated service SID/account/等價 OS-enforced identity。

必測：

```text
authorized caller -> accepted
generic NETWORK SERVICE process -> denied
wrong file owner -> denied
reparse/symlink -> denied
wrong project/host -> denied
Production scope -> denied
```

### C4 — R2-05 Non-circular repair lane

broken Factory MCP 不得依賴自己修自己。固定用途 repair lane 只接受 qualified manifest、target allowlist、expected SHA/blob、prestate hash/ACL、operation-owned backup、exact apply、restart exact component、same-source readback、bounded canary、rollback、receipt。禁止 arbitrary shell；R2-06 PASS 後 DELETE_GATE。

### C5 — R2-06 Live Factory MCP acceptance

完成 C3/C4 後才 install，必驗：

```text
run_as = NT AUTHORITY\SYSTEM
public_tools = exactly 4
host_powershell retained for authorized reversible pre-Production scope
SYSTEM_CAPABILITY_RUN_DENY absent for authorized scope
SYSTEM_CAPABILITY_TASK_DENY absent for authorized scope
SYSTEM_FENCE_CURRENT_FENCE_MISSING absent when no genuine mutation fence is required
Mission/checkpoint/run/task/session rollover alone does not disable transport
read-only diagnostics PASS
timeout PASS
bounded output PASS
concurrency PASS
durable receipt PASS
rollback PASS
Production remains denied
```

### C6 — R2-12 orphan reconciliation

目前 orphan_count=5。逐筆 exact identity / receipt / provider-or-Host readback，分類：

```text
HISTORICAL_TERMINAL_RESIDUE
COMPLETED_BUT_UNCOLLECTED
TRUE_UNRESOLVED_EFFECT
NOT_APPLIED
PARTIAL_OR_AMBIGUOUS
UNKNOWN
```

identity/readback 前禁止 delete/retry/redispatch/process-kill/receipt mutation。

### C7 — R2-07 24x7 Host-owned Supervisor

驗收 Windows reboot auto-start、Supervisor crash restart、Codex UI closed、GPT Web gone、fresh canonical read、READY recompute、stale-owner recovery、evidence/checkpoint persistence。

### C8 — R2-08 Anti-loop / stale wake / churn fuse

Durable fingerprint：

```text
project
+ Human Spec/Mission revision
+ logical unit
+ acceptance contract
+ true upstream authority/input anchor
```

不得用 self-generated candidate SHA 重置。Scheduled wake 只能攜 project_id/locator，不得帶 phase/task/next action/舊 Spec prompt。

### C9 — Multi-Agent Fleet recovery

```text
Host-owned Supervisor = durable orchestrator
OpenCode + Muse = preferred Builder when healthy/eligible/quota allowed
Antigravity + Codex = qualified secondary lanes
normal product coding = Hyper-V Ubuntu isolated worktree/container/cell
one owner per mutable slice
one integration lane per Project
independent READY slices may execute asynchronously
```

Codex 在 Win11 做 control-plane/Host repair 時直接用 native PowerShell/filesystem/git/node/service/task/logs；缺 Web Factory MCP/RDC 不得宣稱 local capability blocked。

### C10 — Evidence model normalization

每個 verdict 綁 provider/resource、ref/SHA/revision、run/job/check、covered paths/bytes、acceptance contract。

```text
candidate
local_test_pass
structural_verifier_pass
semantic_review_pass
live_acceptance_pass
system_acceptance_pass
canonicalized
production
```

不得混用。

### C11 — Any-State final regression

至少黑箱驗 clean idle、Builder running、Reviewer running、lease expired、Agent UI closed、GPT Web gone、Supervisor restart、Windows reboot、VM reboot、WAITING_EXTERNAL、quota/429、Muse 403、unknown side effect、orphan、stale wake、Mission/Policy rollover、deterministic PASS reuse、provider readback unavailable、integration conflict。

每一案必須只靠：

```text
Project Directory
-> current pointer
-> Current Spec/Mission/Policy
-> run/task/attempt/owner/effects
-> fresh provider/runtime observation
-> reconcile
-> continue safe READY work
```

Human 不得作 progress relay。

---

## 5. Executor Rules for Codex

1. 先 fresh-read，不准拿本檔 baseline 當 current state。
2. Windows local work優先 native route。
3. 缺 Factory MCP/RDC 只影響真正需要該 bridge 的 lane。
4. 一 lane blocked 後立即 recompute READY，不得停 Goal。
5. 進度只認 commit/ref、test/verifier、provider readback、runtime observation、receipt/checkpoint、exact blocker+re-entry。
6. 自產新 SHA 不構成新 logical work。
7. same bytes/contract/provider state 無 delta 時不得重測、重送 review、重建 packet、重發報告。
8. Source/runtime/promotion 分離；promotion packet 綁 immutable content manifests，不形成 SHA 自引用。
9. noncanonical candidate 不配置 canonical owner generation/lease。
10. unknown shared mutation effect same-source readback first。
11. 只在真正 Human-reserved Gate 停下找 Human。
12. **不得建立 VNEXT5.1-R3，除非 Human 明確改變 Mission/Spec。**

---

## 6. No-Supplemental-Prompt Mode

本檔發布後正常續接：

```text
Project Directory
-> canonical current
-> Current VNEXT5.1-R2 Spec/Mission/Policy
-> this closure plan immutable ref
-> current run/task/attempt/owner/effects
-> fresh live/provider observations
-> recompute READY
-> execute highest-priority legal unit
```

ChatGPT Web / Human 不再用「補充 Prompt #1/#2/#3」驅動施工。

local Codex Goal/UI 消失時：

```text
DO NOT ASK HUMAN TO REINJECT THE PLAN
recover from provider-addressable artifact + canonical state
```

只有 Human Mission/Spec 真變更才產生新的 authoritative revision。

---

## 7. Final Acceptance

只有下列全部有 provider/runtime-confirmed evidence 才算 closure：

```text
C0_CONTROL_PLANE_NORMALIZATION = PASS
C1_STALE_OWNER_CONTROL_CLEANUP = PASS
C2_R2_03_FIXED_READONLY_SOURCE = PASS
C3_UNIQUE_TRUSTED_CALLER = PASS
C4_NONCIRCULAR_REPAIR_LANE = PASS
C5_LIVE_FACTORY_MCP_ACCEPTANCE = PASS
C6_ORPHAN_5_OF_5_RECONCILED = PASS
C7_HOST_SUPERVISOR_24X7 = PASS
C8_ANTI_LOOP_STALE_WAKE = PASS
C9_MULTI_AGENT_FLEET = PASS
C10_EXACT_TARGET_EVIDENCE_MODEL = PASS
C11_ANY_STATE_REGRESSION = PASS
PRODUCTION = false
PAID_FALLBACK = false
WORKER_PROVIDER_WRITE_CREDENTIALS = 0
SECOND_CANONICAL_STORE = false
HUMAN_PROGRESS_RELAY_DEPENDENCY = false
```

任何單一 local test、commit、PR merge、semantic review、structural verifier、canary 都不能單獨升格為整體完成。

---

## 8. Next Single Action

```text
NEXT_SINGLE_ACTION = REPAIR_PR383_ONCE_AGAINST_RC_FINDINGS_AND_ADD_GOVERNANCE_LINTER
```

限制：

```text
DO NOT PROMOTE CURRENT PR383 HEAD
DO NOT CREATE VNEXT5.1-R3
DO NOT CREATE NEW HUMAN GATE
DO NOT MODIFY PR381/PR377 FROZEN SOURCE HEADS WITHOUT A NEW CONCRETE SOURCE DEFECT
DO NOT DISPATCH HOST MUTATION AS PART OF C0
DO NOT ALLOCATE A CANONICAL OWNER TO THE NONCANONICAL C0 CANDIDATE
```

完成 C0 exact-head verification 後 fresh-read canonical，再執行 C1；**不要等待 ChatGPT Web 再補下一段 Prompt。**
