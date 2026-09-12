# VNEXT-42-CONSTRUCTION-PLAN v4.2
## Secure-MCP-Tunnel + Chat-First Transitional Control + VM-Hard-Boundary + Reuse-First ExecutionPort + Delete-First Harness Fusion

```text
DOCUMENT_STATUS=
HUMAN_DIRECTED_CONSTRUCTION_PLAN

SYSTEM_ARCHITECTURE=
VNEXT_4_2

PLAN_VERSION=
4.2

PLAN_DATE=
2026-09-08

BASELINE_PLAN=
VNEXT-42-CONSTRUCTION-PLAN-v4.1

MISSION_CHANGE_REQUIRED=
NO

CURRENT_B0_RESTART_REQUIRED=
NO

CURRENT_B0_HARNESS_CHANGE_ALLOWED=
NO

CURRENT_PRIMARY_BRAIN=
CHATGPT_CHAT_SOL

TRANSITIONAL_PRIMARY_TRANSPORT=
REMOTE_DESKTOP_COMMANDER_EXACT_DEVICE

FINAL_NORMAL_TRANSPORT=
OPENAI_SECURE_MCP_TUNNEL

FINAL_PUBLIC_INBOUND_MCP_PORT=
0

WORKER_VM_REQUIRED=
TRUE

HARD_ISOLATION_BOUNDARY=
HYPERV_UBUNTU_VM

SECONDARY_RUNTIME_BOUNDARY=
UNPRIVILEGED_WORKER_CONTAINER

AI_CODING_ON_PHYSICAL_WIN11_HOST=
FORBIDDEN_AS_NORMAL_PATH

B0_ACCEPTANCE_HARNESS=
PINNED_CODEX_APP_SERVER

B0_HARNESS_REPLACED_BY_MUSE_OR_OPENCODE=
FALSE

POST_B0_PREFERRED_EXECUTION_RUNTIME=
TRIMMED_AGENTDOCK_PROVISIONAL

POST_B0_CODING_AGENT_PROTOCOL=
OPENCODE_NATIVE_ACP

AGENTDOCK_DELETE_GATE=
REQUIRED_POST_B0

OPENCODE_V2_EMBEDDED_BASELINE=
NOT_YET_STABLE_BETA_CHALLENGER_ONLY

CANONICAL_RUNTIME_STATE=
SUPERVISOR_SQLITE_ONLY

NORMAL_HUMAN_PROMPT_RELAY_TARGET=
0

NORMAL_RDC_CALL_TARGET_AFTER_FINAL_GATE=
0

SECOND_AGENT_HARNESS_BASELINE=
FORBIDDEN

RSI_AUTHORITY=
PROPOSAL_AND_EVAL_ONLY_NO_SELF_PROMOTION
```

---

# 0. 文件定位

本文件是 **VNext-4.2 LEAN 全自動化軟體工廠施工計畫 v4.2**。

它不是重新設計 Mission，也不是推翻 v4.1。它以 v4.1 為唯一架構基線，結合：

1. 2026-09-08 canonical Project／Mission／Policy／L0／Writer Authority 現況；
2. 已驗證的 Remote Desktop Commander 直接 Win11 控制路徑；
3. OpenAI Secure MCP Tunnel 官方客戶端；
4. `joseanu/codex-from-chatgpt` 的精簡 MCP/job bridge；
5. `uvwt/agentdock` 的 ACP／長工作／互動機制；
6. OpenCode ACP 與 V2 Embedded SDK；
7. Pi、NOOA、DeepSeek Harness、Pydantic AI Harness 的低 Context／程式即動作模式；
8. Superpowers、OpenSpec、Spec Kit、GSD 的施工與收斂方法；
9. Hermes Self-Evolution、AHE／Meta-Harness／HarnessEvolve 類自我改善研究；
10. 既有 VNext-4.2 correctness core。

本版的唯一架構哲學是：

```text
REUSE_FIRST
DELETE_FIRST
OFFICIAL_TRANSPORT_FIRST
ONE_CANONICAL_STATE
ONE_ACTIVE_WORKER_UNTIL_SCALE_GATE
MINIMAL_MODEL_FACING_SURFACE
MECHANISM_CAN_BE_OSS
AUTHORITY_CANNOT_BE_OUTSOURCED
```

本文件不是 Mission。任何快照與 canonical provider state 不一致：

```text
CANONICAL_WINS
```

---

# 1. v4.2 產生時的 canonical 基準

```text
PROJECT=
CHATGPT_GLOBAL_SKILL_GOVERNANCE

MISSION_REVISION=
20260831T103813+0800

MISSION_HASH=
sha256:5f8a3eb11cc639417b70a3859198ecc2bef6bc806ee57e75b9a7619496550c20

CURRENT_PHASE=
VNEXT_4_2_B0_CONSTRUCTION

NEXT_HARD_GATE=
B0_SWITCH_ACCEPTANCE

CURRENT_CONFIRMED_POLICY=
20260908T110133+0800-EP47

CURRENT_CONFIRMED_POLICY_HASH=
sha256:bedc67dd968b75ab20631638e95ee01d09b9b4542b4aeca3a0367d8541ea0e55

CURRENT_CONTROLLER=
CHAT_CODEX_EXECUTION_CONTRACT_V8_1_14_CANDIDATE

CURRENT_L0_LAST_UPDATE=
2026-09-08T11:22:57+08:00

CURRENT_L0_STATE_HASH=
sha256:879ea42ab756f1ea80b77558a2acaee5be7a2835449a91377e1e7f2c955a5dcd

ACTIVE_MODULE=
vnext_4_2_b0_construction

ACTIVE_ATOMIC_UNIT=
ep48_wp00_github_read_scope_rebase

CONFIRMED_RDC_TARGET=
DESKTOP-1B6PD2P

CONFIRMED_RDC_DEVICE_ID=
2b8d674b-4166-4efc-9c64-0667fecba29e

CONFIRMED_RDC_PING=
PASS

STAGE_D_VERIFY_EXECUTED=
FALSE

STAGE_D_VERIFY_EXECUTION_ALLOWED=
FALSE

V8_1_15_CANDIDATE=
VALIDATED_NOT_INSTALLED

V8_1_15_PACKAGE_SIZE=
108210

V8_1_15_PACKAGE_SHA256=
a15fb470329650e8c3d79cb018b44885e5117b28cacdfceb0915cfe95a4c330a
```

v4.1 中「RDC 尚未上線／配對」已被最新 canonical 事實取代；v4.2 不再把 RDC 配對當 blocker。

---

# 2. 目前安全停點：EP48 pending + G66 expired

最新 durable L0 記錄：

```text
PENDING_SIDE_EFFECT=
OP-GOV-20260908-EP48-GITHUB-READ-SCOPE-PUBLISH-001

PENDING_KIND=
GOOGLE_SHEETS_CURRENT_EXECUTION_POLICY_WRITE

EXPECTED_POLICY_REVISION=
20260908T112052+0800-EP48

EXPECTED_POLICY_HASH=
sha256:530396599a7bddd04170d2b3d007a779eff31a125199adac6f4882ab993c2963

DISPATCH_COUNT=
1

DISPATCH_STATUS=
SEALED_FOR_SINGLE_DISPATCH

SIDE_EFFECT_CLASSIFICATION=
SIDE_EFFECT_REQUESTED
```

本版產生時對原目標 Current Execution Policy 再讀回，仍為：

```text
EP47
```

canonical Writer Authority 再讀回仍為：

```text
GENERATION=66
FENCING_TOKEN=66
EXPIRES_AT=2026-09-08T11:34:58+08:00
STATUS=HELD_BUT_EXPIRED_BY_TIME
```

因此 v4.2 的**恢復第一原則**不是直接送 EP48，而是：

```text
READBACK_FIRST
→ fresh-read exact pending target
→ fresh-read canonical Writer Authority
→ classify prior EP48 side effect
→ legal pending-readback recovery N→N+1 using actual current generation/revision
→ first post-takeover action = L0 convergence only
→ L0 readback + actual-provider state_hash CLEAN
→ only then re-evaluate and publish EP48 through a fresh legal transaction if still required
```

硬規則：

```text
DO_NOT_REUSE_G66=
TRUE

DO_NOT_HARDCODE_G67=
TRUE

DO_NOT_REUSE_OLD_EP48_DISPATCH_SEAL_FROM_ANOTHER_SESSION=
TRUE

DO_NOT_READ_GITHUB_BEFORE_POLICY_SCOPE_IS_CLEAN=
TRUE

DO_NOT_RUN_H03_MUTATION_WHILE_PENDING_RECOVERY=
TRUE
```

若恢復時原目標仍是 EP47，應依當時實際控制器契約把前一 EP48 operation 收斂為「未套用」類別；先清理 durable pending，再重新建立新的 EP48 publish transaction。不得把舊封條當作跨 Session 可重送券。

---

# 3. Mission 與 B0 凍結項目

以下全部不因本版研究改變：

```text
MISSION=
UNCHANGED

CURRENT_PHASE=
VNEXT_4_2_B0_CONSTRUCTION

NEXT_HARD_GATE=
B0_SWITCH_ACCEPTANCE

B0_RESTART=
NO

B0_ACCEPTANCE_HARNESS=
PINNED_CODEX_APP_SERVER

B0_HARNESS_REPLACEMENT=
FORBIDDEN

MULTI_WORKER_BEFORE_SCALE_GATE=
FORBIDDEN

BUSINESS_PROJECT_INGRESS=
FORBIDDEN

PRODUCTION=
FORBIDDEN
```

v4.2 只改「怎麼少寫程式、少維護 runtime、少人類 relay」，不改「什麼算 B0 完成」。

---

# 4. 過渡期最高執行原則：ChatGPT Sol 必須先自己做完

固定：

```text
CHATGPT_CHAT_SOL=
PRIMARY_STRATEGIC_BRAIN_AND_FIRST_EXECUTOR

CHAT_CAN_DO=
CHAT_MUST_DO

DIRECT_NATIVE_CONNECTOR_OR_RDC_AVAILABLE=
NO_WORK_NO_HUMAN_RELAY_NO_CODEX_HANDOFF

CODEX=
PROVEN_CAPABILITY_GAP_FALLBACK_AND_PINNED_B0_ACCEPTANCE_HARNESS

HUMAN_AS_AI_RELAY=
FORBIDDEN_AS_NORMAL_PATH
```

正常優先序：

```text
1. ChatGPT Sol + native connector
2. ChatGPT Sol + exact-device RDC
3. H03 PASS 後：ChatGPT Sol → RDC/secure route → VM → OpenCode → Muse
4. 只有具體能力缺口：ChatGPT Sol → Codex last-mile
5. Human Reserved Gate
```

不得因「Codex 比較方便」「Work 可以代做」「Human 貼一下比較快」改路。

只有下列情況可進 Codex：

- 目前 Chat/RDC 確實沒有必要的執行能力；
- 需要現有 Codex App Server 的固定 B0 驗收；
- VM／OpenCode／Muse 發生已證明不可替代的相容性缺口；
- 特定 Windows 工具只能由 Codex 取得且不違反 Host 安全邊界。

即使需要 Codex：

```text
CHATGPT_OWNS=
request
scope
acceptance
readback
repair decision
final evidence
```

Human 不再搬 Prompt、ZIP、diff、log 或結果。

---

# 5. 實體 Win11 Host 仍不是 AI 工人的正常工作區

v4.2 保留 v4.1 的硬隔離：

```text
WORKER_VM=
PTYSD-WORKER-01

HARD_ISOLATION_BOUNDARY=
HYPERV_VM

SECONDARY_RUNTIME_BOUNDARY=
UNPRIVILEGED_WORKER_CONTAINER

AGENTDOCK_IS_OS_SANDBOX=
FALSE

OPENCODE_IS_OS_SANDBOX=
FALSE

MUSE_IS_OS_SANDBOX=
FALSE
```

Physical Win11 Host 只允許：

- Hyper-V lifecycle；
- Host health；
- VM recovery；
- HostGuard/JEA exact functions；
- Secure MCP Tunnel bootstrap／runtime prerequisite；
- 過渡期 RDC；
- Human Reserved 的 UAC／BIOS／實體操作。

正常禁止：

```text
bare_host_autonomous_coding_agent
bare_host_agentdock_coding_runtime
bare_host_opencode_coding_runtime
bare_host_muse_coding_runtime
worker_provider_write_credentials
arbitrary_admin_shell_as_model_tool
```

Codex 若暫時在 Win11 上運作，只能做明確 Host last-mile／read-only diagnosis／準備工作，或控制 VM 內工作；不得把實體 Win11 變成永久 unrestricted coding workspace。

---

# 6. H03 現況與主線解耦

H03 已不再是早期「Hyper-V 沒裝」問題。

已確認：

- Hyper-V 功能與服務先前已完成重要驗證；
- Worker VM 相關 VHDX/VMCX/VMRS/VMGS 實體檔案存在；
- VMCX ACL／`vmms` 基本狀態已取得；
- Stage-C cleanup recovery 已確認；
- 目前非管理員 RDC surface 對 Hyper-V registered object 的解析／更深 VMMS Admin log 能力仍不足；
- 沒有提權、重新註冊、Start/Stop VM 或 Stage-D Verify。

因此：

```text
H03_STATUS=
SAFE_PAUSED_DIAGNOSTIC_BOUNDARY

H03_BLOCKS_ALL_B0=
FALSE

WP00_WP01_WP03_NON_VM_PREPARATION_CAN_PROGRESS=
TRUE_WHEN_POLICY_SCOPE_ALLOWS

TRANSITIONAL_MUSE_BUILDER_CAN_START=
FALSE_UNTIL_H03_PASS
```

H03 必須保留為獨立 side-branch／gate，不得讓它永久鎖死 WP-00／WP-01／WP-03 中不依賴 VM 的工作。

---

# 7. v4.2 施工時間軸

## T0-A｜立即恢復控制面

```text
EP48 pending readback recovery
→ fresh Writer Authority
→ legal N+1 recovery if eligible
→ L0 CLEAN
→ revalidate EP48 candidate
→ publish EP48 via fresh transaction if still needed
→ Policy / Registry / L0 convergence
```

## T0-B｜WP-00 / WP-01 / WP-03 非 VM 工作

```text
exact governance repo prestate read
→ WP-00 repo/bootstrap skeleton
→ WP-01 minimal Supervisor + SQLite + missionctl skeleton
→ WP-03 STOP / interrupt_epoch / Worker Lease
→ deterministic local tests
→ pinned Codex App Server B0 acceptance remains frozen
```

## T0-C｜H03 安全 side-lane

```text
read-only diagnostic only
→ exact blocker evidence
→ Human-reserved elevation only when strictly required and separately authorized
→ Stage-D Verify remains forbidden until exact future release
→ H03 PASS
```

## T1｜H03 PASS 後、B0-SWITCH 前

```text
T-MUSE-01
→ OpenCode exact pin
→ Muse exact model/provider pin
→ VM disposable worktree
→ Muse becomes preferred bulk coding worker
→ Codex remains fallback and B0 acceptance harness
```

## T2｜B0-SWITCH 10/10 後

```text
Factory Control MCP
→ OpenAI Secure MCP Tunnel
→ trimmed execution runtime
→ OpenCode ACP + Muse
→ HostGuard/JEA
→ full no-relay E2E
→ RDC retirement gates
```

## T3｜穩定運行後

```text
AgentDock delete gate
→ OpenCode V2 embedded challenger when stable
→ controlled self-improvement outer loop
→ Scale Gate
→ only then consider multi-worker / dependency graph
```

---

# 8. 終局 transport：只用 OpenAI Secure MCP Tunnel，不自造 cloud relay

v4.2 將終局 transport 從「概念上的 Secure MCP Tunnel」提升為**明確官方元件**：

```text
openai/tunnel-client
```

終局：

```text
ChatGPT Chat Sol
      ↓
OpenAI control plane
      ↓
OpenAI Secure MCP Tunnel
      ↓ outbound HTTPS only
customer-run tunnel-client
      ↓
private Factory Control MCP
```

硬規則：

```text
PUBLIC_INBOUND_MCP_PORT=0
CUSTOM_CLOUD_COMMAND_RELAY=0
PUBLIC_AGENTDOCK_MCP=0
PUBLIC_OPENCODE_SERVER=0
```

優先本機連接形式：

```text
Factory MCP
→ Unix-domain socket if practical
→ otherwise loopback-only Streamable HTTP
```

`tunnel-client` runtime credential：

```text
CONTROL_PLANE_API_KEY=
RESTRICTED_TUNNELS_READ_AND_USE_ONLY

OPENAI_ADMIN_KEY=
NOT_PRESENT_IN_LONG_LIVED_RUNTIME
```

其他要求：

- exact tunnel-client version／container digest／binary SHA 在 WP-R01 freeze；
- runtime secret 以 env/file secret reference，禁止進 repo／argv；
- `doctor`／health／ready／metrics 進 deterministic validation；
- 若組織能力允許，可選 mTLS；
- tunnel-client 不是 authority owner，只是 transport。

---

# 9. Factory Control MCP：從現成 MIT donor 移植，不從零寫

優先 donor：

```text
joseanu/codex-from-chatgpt
LICENSE=MIT
```

直接移植：

- MCP Streamable HTTP bootstrap；
- loopback/private bind；
- health/readiness；
- compact job API；
- start/get/continue/interrupt/approval semantics；
- revision polling；
- compact/standard/debug result shape；
- exact approval request id；
- workspace-root validation；
- Codex app-server protocol pin/generation patterns。

刪掉 donor 中不適合作為終局 authority 的部分：

```text
Codex-specific-only job backend
separate persistent state
independent canonical task database
independent policy authority
```

改成單一：

```text
SupervisorJobBackend
```

ChatGPT 固定只看到高階工具：

```text
factory_start
factory_get
factory_stop
factory_approve
factory_get_evidence
factory_get_replan
factory_resume
factory_health
```

可選新增但仍維持高階：

```text
factory_status
factory_capabilities
```

絕不直接暴露：

```text
raw_shell
raw_filesystem
raw_git
raw_hyperv
raw_agentdock
raw_opencode
provider_credentials
```

---

# 10. `ptysd-supervisor` 仍是一個小型單體服務，不拆微服務

第一版保持 TypeScript 單 service/process 優先：

```text
Factory Control MCP
SQLite WAL
Deterministic FSM
Task Envelope validator
STOP / interrupt_epoch
Worker Lease
ExecutionPort
Job abstraction
Evidence
Failure Router
G3/G4 coordinator
ProviderGuard
Notification
```

禁止為了「架構漂亮」拆成：

```text
scheduler service
queue service
memory service
policy service
approval service
provider service
worker broker
```

第一版目標是：

> 用最少永久自研 LOC 維持不可外包 correctness core。

---

# 11. 新增 ExecutionPort：讓 runtime 可以替換，但同時只能啟用一個

v4.2 新增一個非常薄的內部抽象：

```text
ExecutionPort
```

最低介面語意：

```text
start(task)
get(job_id)
continue(job_id, input)
interrupt(job_id)
respond_permission(request_id, decision)
collect_evidence(job_id)
close(job_id)
```

它不是第二個 workflow engine，不保存 canonical state。

用途只有：

> 讓 Supervisor 不被 AgentDock／OpenCode／Codex 某一個 runtime 綁死，也讓我們能用相同 B0/Post-B0 Gate 做「整層刪除比較」。

同時硬鎖：

```text
ACTIVE_EXECUTION_ADAPTER_COUNT=1
```

Scale Gate 前不得做自動模型／Harness swarm routing。

---

# 12. ExecutionPort Adapter 路由

## A. B0 Acceptance Adapter

```text
PINNED_CODEX_APP_SERVER
```

完全凍結，不因 v4.2 更換。

## B. Transitional Builder Adapter

H03 PASS 後：

```text
OPENCODE_CLI_OR_ACP
→ MUSE
```

跑在 Ubuntu VM／受限 container／isolated worktree。

## C. Post-B0 Baseline Adapter

目前暫定：

```text
TRIMMED_AGENTDOCK
→ OPENCODE_ACP
→ MUSE
```

這是**暫定 mechanism baseline**，不是不可刪權威。

## D. Post-B0 Challenger

```text
OPENCODE_V2_EMBEDDED
```

只有 V2 SDK stable、ACP/event/permission/session 能力達標才可進 Gate。

## E. Optional Research Challenger

```text
OPENAI_SANDBOX_AGENT
```

目前 Sandbox Agent 屬 beta，因此只做刪碼研究／特定 OpenAI-native 任務 challenger，不作 Muse 主線替代。

---

# 13. AgentDock v4.2 定位：保留，但從硬依賴降成「必須證明值得留下」

AgentDock 可以直接幫我們省掉：

- ACP client；
- session／prompt／permission interaction；
- long-running job observe/input/cancel；
- process/PTY plumbing；
- 部分工具與執行追蹤。

但 AgentDock 本身**不是 OS sandbox**；其 ACP working directory 的真正安全界線來自 OS user／container mount 等邊界。

所以：

```text
AGENTDOCK=
INTERNAL_EXECUTION_MECHANISM_ONLY
```

只允許：

```text
ACP session/prompt/interaction
bounded job observation
bounded terminate/cancel
required process plumbing
```

baseline 關閉／不採權威：

```text
task_manage canonical state
Recall canonical memory
Nexus canonical memory
Evolution authority
workflow template authority
Browser
dynamic MCP sprawl
public MCP endpoint
ChatGPT direct raw AgentDock tools
```

所有工作目錄只能由 VM/container mount 形成真正邊界。

---

# 14. AgentDock Delete Gate

Post-B0 必跑：

```text
AD-DELETE-GATE
```

比較：

```text
A:
Supervisor
→ AgentDock
→ OpenCode ACP
→ Muse

B:
Supervisor
→ OpenCode V2 embedded/direct stable interface
→ Muse
```

只有 B 同時滿足：

```text
session_create_resume=PASS
long_job_observe=PASS
interrupt_cancel=PASS
permission_interaction=PASS
event_stream=PASS
crash_recovery=PASS
workspace_boundary_under_vm_container=PASS
evidence_capture=PASS
fresh_session=PASS
custom_loc <= A
process_count <= A
operational_failure_surface <= A
```

才：

```text
DELETE_AGENTDOCK=TRUE
```

否則：

```text
KEEP_AGENTDOCK_TRIMMED=TRUE
```

截至 v4.2 產生時 OpenCode V2 Embedded SDK 仍是 beta，所以：

```text
DELETE_AGENTDOCK_NOW=
NO
```

---

# 15. OpenCode：現在直接用 ACP；V2 Embedded 只做未來刪層 challenger

Current stable-style path：

```text
opencode acp
→ JSON-RPC over stdio
```

這允許 v4.2 繼續做到：

```text
CUSTOM_OPENCODE_SESSION_PROTOCOL=0
```

OpenCode V2 Embedded SDK 的重要方向：

```text
no HTTP listener
no network hop
in-process sessions/events/plugins
```

但目前：

```text
V2_SDK_STATUS=BETA
```

所以禁止把它提前升格為 B0／Production baseline。

---

# 16. 模型面工具表面必須縮小：吸收 Pi + OpenAI deferred tool loading 思路

永遠可見的工具只保留 Factory Control MCP 高階工具。

```text
PERMANENT_MODEL_FACING_TOOL_SURFACE=
MINIMAL
```

低階 capability 由 Task Envelope 決定後才載入：

```text
Git tools
CI tools
browser tools
DB tools
artifact tools
provider-read tools
host tools
```

禁止：

> 為了「什麼都能做」把數十個／數百個 schema 永久塞進模型 context。

未來若使用 OpenAI Agents SDK/MCP 工具搜尋：

```text
deferLoading/tool search
```

只作工具延遲載入機制，不取得 ProviderGuard authority。

---

# 17. Reference-First I/O：吸收 NOOA pass-by-reference

大型工具結果不得預設回灌完整 context。

改成：

```yaml
artifact_ref:
  artifact_id: ...
  type: ...
  sha256: ...
  size_bytes: ...
  bounded_preview: ...
  query_capability: ...
  source_operation_id: ...
```

適用：

- build logs；
- test logs；
- diff；
- dependency trees；
- large search results；
- browser traces；
- code index；
- CI artifacts；
- long command output。

模型只拿：

```text
metadata + bounded preview + reference
```

需要時再查指定 slice。

目標：

```text
LESS_CONTEXT
LESS_TOKEN
LESS_ROUNDTRIP
BETTER_RECOVERY
```

---

# 18. Bounded Code-as-Action：吸收 NOOA / DeepSeek / Pydantic 的共同優點

允許模型在 Worker sandbox 內生成**短、受限、可中斷**的程式，一次組合多個低階操作：

```text
read N files
→ parse
→ filter
→ compare
→ compute
→ return bounded result
```

而不是：

```text
model → tool → model → tool → model → tool × N
```

但硬規則：

```text
CODE_AS_ACTION_CANNOT_BYPASS=
Task Envelope
allowed_paths
network policy
timeout
output limit
ProviderGuard
approval
STOP
Worker Lease
```

禁止程式即動作直接呼叫 provider-write credential。

---

# 19. 統一 Job abstraction：吸收 omp² 類系統軟體思維

所有長工作收斂成相同生命週期：

```text
JOB
├─ stdin/input
├─ stdout/stderr/event
├─ status
├─ exit/result
├─ signal/cancel
├─ timeout
└─ evidence refs
```

包括：

- coding agent session；
- test/build；
- dev server；
- read-only diagnostic；
- long shell task；
- CI poll；
- remote bounded function。

不要為每一類工作各寫一套 spawn/poll/kill/resume。

真正 kill boundary 必須在：

```text
process/container/VM
```

不能只靠模型 cooperative cancellation。

---

# 20. Task Envelope v3.2

```yaml
schema: FACTORY_TASK_V3_2

project:
  project_id: ...
  mission_revision: ...
  mission_hash: ...
  plan_revision: ...
  plan_hash: ...

task:
  task_id: ...
  operation_id: ...
  goal: ...
  why: ...
  non_goals: []
  base_revision: ...
  acceptance: []
  protected_invariants: []

change_bundle:
  required: risk_based
  proposal: ...
  behavioral_delta: []
  design_required: false
  tasks: []

workspace:
  isolation_boundary: hyperv_vm
  runtime_boundary: unprivileged_container
  worktree: ...
  allowed_paths: []
  read_only_paths: []
  forbidden_paths: []

executor:
  execution_port: ...
  runtime: ...
  protocol: ...
  agent: ...
  model_role: builder

permissions:
  shell: bounded
  network: bounded
  browser: forbidden_by_default
  docker_socket: forbidden
  provider_write_credentials: forbidden
  production: forbidden

context:
  reference_first_io: true
  max_inline_tool_output_bytes: bounded
  optional_capabilities: []

budget:
  max_builder_attempts: 2
  max_diagnostic_attempts: 1
  timeout_seconds: bounded
  max_output_bytes: bounded

replan_triggers:
  - acceptance_conflict
  - protected_invariant_change
  - architecture_change
  - schema_change
  - security_boundary_change
  - repeated_same_failure
  - tool_capability_gap
  - provider_runtime_failure
```

---

# 21. Change Bundle：只吸收 OpenSpec 的最小耐久資訊，不裝第二套 workflow engine

對中高風險修改，Task Envelope 可帶極小 Change Bundle：

```text
why
what changes
what does not change
observable acceptance
protected invariants
design only if needed
small tasks
```

低風險修改：

```text
NO_EXTRA_MARKDOWN_CEREMONY
```

跨架構／安全／schema／migration 才提高嚴謹度。

OpenSpec 可當格式 donor，但不建立第二套 canonical state。

---

# 22. Converge Gate：吸收 Spec Kit 的「實作後回頭對規格」

G3 增加：

```text
CONVERGE_CHECK
```

將實際 code/worktree 與 Task Envelope／Change Bundle 比對，至少分類：

```text
MISSING
PARTIAL
CONTRADICTS
UNREQUESTED
CONVERGED
```

若有 `UNREQUESTED`，即使 tests PASS，也不能自動完成。

---

# 23. Superpowers：只取成熟 Skills，不導入第二 governance runtime

優先移植／改寫成我們自己的 project-local Skills：

```text
TDD
systematic debugging
verification before completion
spec compliance review
code quality review
fresh implementer/reviewer discipline
Skill regression testing
```

重要原則：

```text
SKILL_CHANGE_WITHOUT_REGRESSION=
NOT_PROMOTABLE
```

這與現有治理技能 regression／blackbox 文化直接相容。

---

# 24. GSD：只吸收 fresh-context，不提前多 Worker

大量 coding／診斷需要 fresh context 時：

```text
fresh builder
fresh read-only diagnostic/reviewer
```

不要把主 Controller session 的歷史垃圾全部塞給 Worker。

但：

```text
ACTIVE_WORKER=1
```

仍維持到 Scale Gate。

---

# 25. ProviderGuard 完全不外包

永遠：

```text
authorization
→ exact operation
→ operation_id
→ PRE
→ resource precondition/CAS
→ durable pending
→ dispatch once
→ same-source readback
→ CONFIRMED / NOT_APPLIED / AMBIGUOUS
```

Worker 永遠：

```text
GITHUB_WRITE_TOKEN=ABSENT
GOOGLE_WRITE_CREDENTIAL=ABSENT
CLOUDFLARE_PROVIDER_WRITE=ABSENT
PRODUCTION_CREDENTIAL=ABSENT
OPENAI_ADMIN_KEY=ABSENT
```

ProviderGuard 只存在 Supervisor/control plane 側。

---

# 26. HostGuard v4.2：ChatGPT 不直接看到 raw Host tools

實體 Win11 上：

```text
ptysd-hostguard
→ JEA
→ exact functions
```

例如：

```text
Get-PTYSDHostHealth
Get-PTYSDWorkerVMState
Start-PTYSDWorkerVM
Stop-PTYSDWorkerVM
Get-PTYSDHyperVInventory
Restart-PTYSDWorkerVMIfPolicyAllows
```

建議終局拓樸：

```text
ChatGPT
→ Factory Control MCP only
→ Supervisor
→ internal HostControlPort
→ HostGuard/JEA
```

不要把 HostGuard 作為 ChatGPT 第二個 raw MCP 工具面，避免模型同時握兩條主控路徑。

---

# 27. G3 / G4 v4.2

## G3 deterministic

至少：

```text
build
typecheck
lint
unit
integration
contract
schema
allowed-path diff
secret scan
hash
Task Envelope validation
Converge check
forbidden-capability scan
provider-credential absence
```

## G4

R0/R1：

```text
G3 + required CI
```

R2：

```text
fresh read-only reviewer
```

R3：

```text
Sol/Human exact Gate
```

不強迫所有 R0/R1 都多燒一個 LLM reviewer。

---

# 28. Failure Router v4.2

```text
Attempt 1
preferred builder
  ↓ fail
Attempt 2
bounded minimum repair
  ↓ same/related fail
Fresh high-effort diagnostic
READ-ONLY
  ↓
minimum repair
  ↓ fail
REPLAN_REQUIRED
```

如果是：

```text
provider outage
model SKU unavailable
runtime crash
transport failure
```

分類：

```text
PROVIDER_OR_RUNTIME_FAILURE
```

不得算成 coding failure。

Codex fallback 只有證明目前 preferred path 有 capability/runtime blocker 後才使用。

---

# 29. B0-SWITCH 10/10 完全不變

1. Task Envelope ingest。
2. persist-before-dispatch。
3. exactly one Worker。
4. interrupt。
5. STOP increments epoch。
6. lease expiry blocks。
7. evidence-based completion。
8. crash/restart recovery。
9. provider write disabled from Worker。
10. Worker secret scan clean。

v4.2 的新技術只能幫這 10 項少寫 code，不能改 acceptance。

---

# 30. Post-B0 Work Packages v4.2

```text
WP-R01  Dependency BOM/license/version/digest freeze
WP-R02  Factory Control MCP transplant from codex-from-chatgpt
WP-R03  ExecutionPort minimal interface
WP-R04  Artifact/reference-first I/O
WP-R05  Unified cancellable Job abstraction

WP-TUN01 OpenAI tunnel-client private transport
WP-TUN02 restricted runtime key + secret boundary
WP-TUN03 Unix-socket/loopback Factory MCP binding + doctor/health

WP-AD01 AgentDock trimmed internal runtime
WP-AD02 AgentDock -> opencode acp
WP-AD03 AgentDock unauthorized capability conformance

WP-OC01 OpenCode exact stable pin
WP-MUSE01 Muse builder/diagnostic exact roles/pins

WP-HG01 JEA HostGuard
WP-SEC01 VM/container isolation verification
WP-E2E01 full Human-relay=0 autonomous task
WP-E2E02 crash/recovery/STOP/provider uncertainty drills

WP-RETIRE01 RDC normal-path retirement
WP-RETIRE02 revoke/disable transitional broad RDC privilege after stability window

WP-DEL01 AgentDock Delete Gate
WP-DEL02 OpenCode V2 embedded challenger only after stable

WP-EVOL01 controlled self-improvement outer-loop MVP
```

---

# 31. Post-B0 acceptance M01-M26

1. Runtime dependencies exact pins/licenses/digests。
2. Factory MCP only exposes high-level `factory_*` tools。
3. Secure MCP Tunnel uses official `openai/tunnel-client`。
4. Public inbound MCP port = 0。
5. Runtime API key is restricted; admin key absent from daemon。
6. Tunnel health/ready/doctor PASS。
7. VM hard boundary verified。
8. Unprivileged worker runtime verified。
9. Physical Win11 normal autonomous coding = 0。
10. ExecutionPort has exactly one active adapter。
11. AgentDock pinned and internal only if retained。
12. AgentDock is non-canonical and non-sandbox authority。
13. OpenCode exact pin。
14. OpenCode ACP PASS。
15. Muse builder/diagnostic role freeze。
16. reference-first artifact path PASS。
17. bounded code-as-action cannot escape Task Envelope。
18. unified Job cancel/timeout/kill PASS。
19. bounded repair loop PASS。
20. runtime crash recovery PASS。
21. STOP/lease/stale result PASS。
22. ProviderGuard exactly-once/readback PASS。
23. JEA HostGuard exact function boundary PASS。
24. Worker provider write credentials absent。
25. complete normal task with Human relay=0 and RDC normal calls=0。
26. AgentDock Delete Gate recorded with KEEP/DELETE evidence; no architecture-by-opinion。

---

# 32. RDC 退場 Gate

只有全部成立：

```text
Secure MCP Tunnel stable E2E >= 3/3
Factory MCP restart recovery >= 3/3
HostGuard exact Host/VM operations PASS
normal task human relay = 0
normal task RDC calls = 0
STOP/lease/provider uncertainty drills PASS
no public inbound MCP port
provider write creds absent from Worker
```

才：

```text
RDC_NORMAL_PATH=DISABLED
```

先降為：

```text
BREAK_GLASS_ONLY
```

經穩定窗口後再：

```text
REVOKE_OR_DISABLE_BROAD_RDC_PRIVILEGE
```

若未完成 MCP final gates，不得為了「終局純潔」提前拔掉目前唯一可靠過渡控制能力。

---

# 33. 受控自我改善：只要 RSI 複利，不讓它取得主權

不要新增常駐「Evolution master daemon」。

用既有：

```text
SQLite Evidence/Incident refs
Git
GitHub Actions
Skills
regression fixtures
```

做低頻外迴圈：

```text
production-like evidence
→ repeated failure clustering
→ hypothesis
→ minimal candidate diff
→ regression
→ held-out regression
→ token/cost/time/custom-LOC gate
→ PR
→ shadow/canary
→ promotion gate
```

可自動提出 candidate 的範圍：

```text
Skill
prompt fragment
tool description
context strategy
review checklist
deterministic lint/test candidate
```

永遠禁止自行修改或自行 promotion：

```text
Mission
ProviderGuard
permission expansion
production credentials
STOP semantics
Writer Authority rules
promotion rules themselves
Project isolation
Human-reserved gates
```

Hermes／AHE／Meta-Harness／HarnessEvolve 只作方法 donor。

---

# 34. 三層改善升級規則

## L1｜知識／Skill 層

重複但非硬安全錯誤：

```text
candidate Skill/prompt/tool-description diff
→ regression
→ PR
```

## L2｜Deterministic Guard 層

同類錯誤再次發生：

```text
不要再加 Prompt
→ test/lint/schema/validator/fence
```

## L3｜Authority／Security 層

任何涉及：

```text
Mission
ProviderGuard
permissions
Writer Authority
production
security boundary
```

只能：

```text
PROPOSAL_ONLY
```

不得自動 promotion。

---

# 35. 直接重用／借機制／延後／拒絕矩陣

| 元件 | v4.2 裁決 | 用途 |
|---|---|---|
| Hyper-V Ubuntu VM | **必留** | 第一硬隔離 |
| RDC | **過渡期直接用；終局退場** | Chat 直接控制 Win11 |
| OpenAI `tunnel-client` | **直接用** | 終局私有 MCP transport |
| `codex-from-chatgpt` | **fork/transplant** | Factory MCP/job API donor |
| Codex App Server | **B0 固定保留** | B0 acceptance harness |
| Codex | **fallback** | proven capability-gap last-mile |
| OpenCode ACP | **直接用** | Muse coding agent protocol |
| OpenCode V2 Embedded | **challenger** | 未來刪 AgentDock/bridge |
| Muse Spark 1.3 | **H03 後 preferred builder** | 大量 coding |
| AgentDock | **Post-B0 暫留＋Delete Gate** | ACP/job/process plumbing |
| Pi | **只借概念** | minimal tool surface |
| NVIDIA NOOA | **只借概念** | pass-by-reference / code-as-action |
| DeepSeek Harness | **只借概念** | plugin composition / code mode |
| Pydantic AI Harness | **只借概念** | code mode / compaction / guard ideas |
| OpenAI Agents SDK Sandbox | **beta challenger** | workspace/snapshot/runtime 刪碼研究 |
| Superpowers | **移植 Skills** | TDD/debug/verify/review |
| OpenSpec | **借最小 Change Bundle** | 低 ceremony 規格 |
| Spec Kit | **借 Converge** | spec↔code 最終收斂 |
| GSD | **借 fresh-context** | fresh builder/reviewer |
| Hermes self-evolution | **借外迴圈** | Skill candidate evolution |
| AHE/Meta-Harness/HarnessEvolve | **借評測方法** | held-out/gated harness evolution |
| Gas City | **借機制** | desired-state reconciliation |
| AttractorBench | **借測試** | fake/deterministic runtime |
| SpecDD | **借機制** | path authority |
| SpecGuard | **借機制** | pre-dispatch validation |
| Spec Workflow MCP | **借機制** | exact durable approval |
| Microsoft Agent Governance Toolkit | **借機制** | security/conformance |
| StrongDM Leash | **Post-B0 可選** | 額外 hardening |
| Beads | **延後** | dependency graph only if proven |
| Agent Orchestrator | **延後** | multi-worker only after Scale Gate |
| ContextForge/CXDB | **延後** | context DB only if proven |
| BMAD/Ruflo/full GSD runtime | **不進 core** | 避免治理/agent framework 疊床架屋 |

---

# 36. 明確刪除／不再自研

```text
custom OpenCode stdio bridge
custom OpenCode ACP protocol
custom generic coding-agent session protocol
custom general file/Git execution layer
custom cloud command relay
custom multi-device relay
custom public MCP gateway
second task DB
second workflow engine
second policy engine
second canonical memory
second approval authority
early DAG engine
early multi-worker orchestrator
always-on giant tool schema surface
prompt-only fixes for recurrent deterministic failures
```

若 AgentDock Delete Gate PASS，再刪：

```text
AgentDock runtime layer
AgentDock client integration
```

---

# 37. 八個不可外包 correctness core

1. Human Mission Authority。
2. legal deterministic state transition。
3. canonical durable operational state。
4. bounded Task Envelope。
5. STOP / authority revocation。
6. Worker Lease / stale-result rejection。
7. Provider side-effect exactly-once/readback。
8. Project isolation / evidence integrity。

任何 OSS／Harness 只能提供 mechanism。

---

# 38. Scale Gate 不變，並新增「刪層優先」

在增加：

- Beads；
- DAG；
- multi-worker；
- Agent Orchestrator；
- ContextForge；
- CXDB；
- model/router swarm；

之前：

```text
bounded_real_tasks >= 20
unattended_task_success_rate >= 90%
human_prompt_relay_per_normal_task = 0
manual_context_restore_per_normal_task = 0
ordinary_CI_human_repair = 0
crash_recovery_drill >= 3/3
duplicate_provider_side_effect = 0
stale_worker_result_accepted = 0
scope_escape = 0
```

而且先問：

```text
CAN_WE_DELETE_A_LAYER_INSTEAD_OF_ADDING_ONE?
```

未證明：

```text
ACTIVE_WORKER=1
```

---

# 39. 24/7 Recovery v4.2

## Supervisor crash

```text
restart
→ SQLite WAL
→ restore canonical task
→ reconcile active ExecutionPort job
→ stale lease check
→ evidence readback
```

## AgentDock/OpenCode crash

```text
fence old lease
→ inspect job/worktree/artifact refs
→ fresh session
→ bounded resume/repair
```

## tunnel-client down

```text
health/ready fail
→ no public fallback
→ restart bounded runtime
→ doctor
→ reconnect private MCP
```

## VM down

```text
ChatGPT
→ Secure MCP
→ Supervisor
→ HostGuard/JEA
→ exact VM state
→ exact recovery
```

## CI fail

```text
bounded repair
```

## Provider uncertainty

```text
READBACK_FIRST
```

## Human STOP

```text
epoch++
no new dispatch
stale result reject
pending provider operation readback only
```

---

# 40. Human Notification

只通知：

```text
DONE
PROVEN_HUMAN_REQUIRED
REPLAN_REQUIRED
TRUE_AMBIGUOUS_SIDE_EFFECT
SECURITY_OR_COST_GATE_REQUIRES_HUMAN
```

不通知：

```text
ordinary retry
CI bounded repair
worker restart
context compaction
artifact paging
normal reviewer
```

---

# 41. Main Controller 恢復演算法 v4.2

```text
START
  ↓
load currently installed governance skills
  ↓
exact canonical Project shard
  ↓
Current Mission
  ↓
Current Execution Policy
  ↓
Latest durable L0
  ↓
Mission/Policy/Controller triple identity
  ↓
pending side effect?
  ├─ YES
  │    ↓
  │  original target READBACK FIRST
  │    ↓
  │  fresh canonical Writer Authority
  │    ↓
  │  legal pending-readback N→N+1 recovery if eligible
  │    ↓
  │  L0 convergence only
  │    ↓
  │  readback + actual-provider state_hash CLEAN
  │
  └─ NO → continue
       ↓
if EP48 still needed:
rebuild minimal candidate from actual EP47
→ validate under installed controller
→ fresh exact transaction
→ Policy readback
→ Registry dual-write/readback
→ L0 rebase/hash CLEAN
       ↓
exact governance GitHub sandbox prestate
       ↓
WP-00 → WP-01 → WP-03 where nonblocked
       ↓
in parallel: H03 read-only safe-lane
       ↓
H03 PASS?
  ├─ NO → keep VM-dependent builder lane blocked; continue permitted non-VM B0 work
  └─ YES
       ↓
T-MUSE-01
       ↓
OpenCode + Muse preferred builder
       ↓
pinned Codex App Server B0 acceptance
       ↓
B0-SWITCH 10/10
       ↓
Factory MCP + tunnel-client + ExecutionPort
       ↓
trimmed AgentDock → OpenCode ACP → Muse
       ↓
HostGuard/JEA + E2E no-relay
       ↓
RDC retirement
       ↓
AgentDock Delete Gate
       ↓
controlled self-improvement outer loop
```

---

# 42. v4.2 相對 v4.1 的正式差異

| 項目 | v4.1 | v4.2 |
|---|---|---|
| RDC 現況 | 尚未配對 blocker | **已配對＋exact ping PASS；只剩過渡 transport** |
| 目前主線 | H03 優先 | **H03 safe-lane 與 WP-00/01/03 解耦** |
| EP 狀態 | EP45 | **EP47 confirmed；EP48 pending recovery** |
| Writer | G62 history | **fresh readback G66 expired；不得硬碼下一代** |
| AgentDock | Post-B0 固定 runtime | **暫定 runtime＋強制 Delete Gate** |
| OpenCode | ACP / transitional | **ACP baseline；V2 Embedded stable 後 challenger** |
| MCP transport | Secure MCP Tunnel | **正式鎖 `openai/tunnel-client`，outbound-only，0 public inbound** |
| Factory MCP | donor | **明確 fork/transplant `codex-from-chatgpt` job surface** |
| Tool surface | 高階 factory tools | **再加入 minimal always-on + lazy capabilities** |
| Context | 未特別定義 | **reference-first artifact I/O** |
| 多工具操作 | 一般 agent loop | **bounded code-as-action** |
| 長工作 | runtime-specific | **統一 cancellable Job abstraction** |
| Spec | Task Envelope | **Task Envelope v3.2 + minimal Change Bundle** |
| 完成驗收 | G3/G4 | **增加 Converge classification** |
| Self-improvement | 尚未正式 | **PR/eval/held-out/canary 外迴圈；無自我升權** |
| Human relay | 0 | **維持 0，且 Chat-first route hardening** |
| RDC 終局 | break-glass | **通過 final gates 後 disable/revoke broad privilege** |

---

# 43. 最終推薦架構

```text
Human
  ↓ one sentence
ChatGPT Chat Sol
  │
  │  strategy / planning / direct connectors / approval boundary
  ↓
OpenAI Secure MCP Tunnel
  │ outbound HTTPS; no public inbound MCP
  ↓
┌──────────────────────────────────────────────┐
│ PTYSD Supervisor / Factory Control MCP       │
│ one TypeScript service                       │
│                                              │
│ SQLite WAL = only canonical runtime state    │
│ deterministic FSM                            │
│ Task Envelope v3.2                           │
│ STOP / interrupt_epoch                       │
│ Worker Lease                                 │
│ ExecutionPort                                │
│ Job lifecycle                                │
│ Artifact/reference-first I/O                 │
│ Evidence / Failure Router                    │
│ G3/G4 + Converge                             │
│ ProviderGuard                                │
│ Notification                                 │
└───────────────┬──────────────────────────────┘
                │
        ┌───────┴────────┐
        │                │
        │ internal       │ internal HostControlPort
        ▼                ▼
Hyper-V Ubuntu VM      Win11 HostGuard
PTYSD-WORKER-01        JEA exact functions
        │
        ▼
unprivileged worker boundary
        │
        ▼
[Post-B0 baseline]
trimmed AgentDock
        │ ACP
        ▼
OpenCode
        │
        ▼
Muse builder / read-only diagnostic
        │
        ▼
isolated worktree
        │
        ▼
G3 → GitHub Actions → G4 → ProviderGuard
```

未來若 `AD-DELETE-GATE` PASS：

```text
trimmed AgentDock
=
DELETE

Supervisor
→ stable OpenCode embedded/direct interface
→ Muse
```

---

# 44. 最終一句話

```text
v4.2 不重開 B0、不換 Codex 固定驗收 Harness、不刪 Hyper-V VM；
現在先依法收斂 EP48 pending + expired G66，再由 ChatGPT Sol 直接把能做的 WP-00/01/03 做完；
H03 獨立安全收斂後啟用 OpenCode + Muse 當主要 coding worker；
B0 10/10 後用官方 openai/tunnel-client 把 ChatGPT 接到私有 Factory MCP，公開入站埠為 0；
AgentDock 只暫時替我們省 ACP/job plumbing，之後必跑 Delete Gate；
所有新 Harness 只拿來刪 code、縮 Context、改善驗收與自我改善，不再堆第二套權威或第二套 runtime。
```
