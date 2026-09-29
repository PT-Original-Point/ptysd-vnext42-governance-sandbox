# VNEXT5.1-R2｜全自動軟體工廠控制面解鎖、跨 Session 續接與多 Agent 工廠閉環施工規格

**版本：** VNEXT5.1-R2  
**日期：** 2026-09-29  
**Project：** `CHATGPT_GLOBAL_SKILL_GOVERNANCE` / 全自動軟體工廠  
**狀態：** Human-directed construction candidate  
**Production：** 未授權  
**說明：** 使用者口述「V5.0 R2」，但現行 canonical family 已是 `VNEXT5.1-R1`，因此本版依版本血緣命名為 `VNEXT5.1-R2`；禁止倒退成 V5.0-R2 以免 stale state resurrection。

---

## 0. R2 最終目標

R2 不是再疊一層治理，而是把 V4.2 → V4.9 → V5.0/R4 → V5.1-R1 已經踩過的坑收斂成一個真正可 24/7 自主施工、跨 Session 可恢復、可多 Agent 非同步分工、可獨立稽核、可在 Host/Agent/Chat Session 掛掉後繼續運作的成熟軟體工廠。

**R2 的兩個最高優先 P0：**

1. **解除 Factory MCP 自製的重複授權／自我鎖死。** 任何已由 Human 永久授權的可逆 pre-Production scope，不得再因 Mission、checkpoint、run/task pattern、generation、Session rollover 等治理 metadata 而失去 Host transport。固定唯讀診斷不得要求 Host mutation fence。
2. **任何新 Session／新 AI／重啟後都能從 canonical + live observation 自動同步最新狀態安全續接。** 不靠 Memory、聊天摘要、最近檔案、舊 scheduled wake、舊 Goal 或人工 relay。

R2 同時恢復 V4.2～V4.9 的成熟工廠主架構：

- GPT Web = 臨時稽核員／Mission Control／Human interface；不是長時間 orchestrator。
- 24/7 Host-owned Supervisor = 持久 orchestrator / reconciler。
- Factory execution = Multi-Agent Fleet。
- OpenCode + Muse Spark 1.3 = preferred Builder route（健康、合規、quota 允許時）。
- Antigravity + Gemini 與 Codex = qualified secondary lanes，可作 Builder / Reviewer / Repair / shadow / fallback / specialist。
- 正常產品 coding = Hyper-V Ubuntu Worker VM + isolated worktree/container/cell；Win11 bare host 只做 Host-maintenance/control-plane 類工作。
- Task Graph → Builder → Fresh Reviewer → deterministic verifier → Repair / re-review → Integrator → product verifier / E2E → ProviderGuard → same-source readback → canonical checkpoint → notification。

---

# 1. 2026-09-29 fresh baseline

## 1.1 Canonical control

Fresh canonical readback：

```text
Project                    = CHATGPT_GLOBAL_SKILL_GOVERNANCE
Current checkpoint         = 194
Canonical control branch   = v45/factory-control
Canonical branch HEAD      = 6d33958484bbe1dfbb611127f37d49d00439fc2f
Current spec               = VNEXT5.1-R1
Mission                    = 20260929T115735+0800
Policy                     = 20260929T115735+0800-EP74
Phase                      = VNEXT5_1_R1_CONTROL_PLANE_RECOVERY
Active unit                = V51-R1-03-FACTORY-READONLY-BOOTSTRAP-SURFACE
Attempt                    = V51-R1-03-ATTEMPT-001 / epoch 1
Run                        = V51-R1-001
Run state                  = RUNNING
Atomic state               = PREPARED_NOT_DISPATCHED
execution_fence            = null
unresolved effects         = []
STOP                       = false
```

## 1.2 現行 owner/liveness 矛盾

CP194 記錄：

```text
execution_owner = CODEX_THREAD_01a0cb52-6d41-7b33-b92c-099639fa07e7
owner_generation = 2
lease_until = 2026-09-29T08:12:07Z
```

以本規格產生時間 2026-09-29 20:34 +08 判斷，該 lease 已過期約 4 小時以上，但 canonical run 仍為 `RUNNING`。

Fresh `factory_status` 同時回報：

```text
host                    = DESKTOP-1B6PD2P
run_as                  = NT AUTHORITY\SYSTEM
VM                      = Running
SSH                     = reachable
host_exec_lane          = IDLE_WITH_ORPHANS
active_count            = 0
effective_active_count  = 0
live_job_count          = 0
orphan_count            = 5
pending_receipt_count   = 0
stale_count             = 0
capacity                = 4
tunnel.live             = true
tunnel.ready            = true
control_plane_status    = ok
```

因此目前存在直接的 **LIVENESS SPLIT-BRAIN**：

```text
canonical run = RUNNING
owner lease   = expired
host jobs     = 0
Codex UI      = 實際已停住 / waiting review
```

R2 必須把「UI thread 還存在」與「真 executor 還活著」完全拆開。

## 1.3 R1-03 / PR #342 現況

```text
PR #342 = open / draft / noncanonical
head    = 068f423fa8315eceaf9885c87b1caf7906e69d7a
changed files = 6
```

Issue #310 已保存 exact-head verifier PASS 證據；但 fresh PR review readback 仍是：

```text
reviews = 0
```

所以它是**已資格化的 candidate evidence**，不是 semantic acceptance、canonical publication 或 live acceptance。

## 1.4 Factory MCP live self-lock

實測 `host_powershell` 目前仍可能在 dispatch 前被：

```text
SYSTEM_CAPABILITY_RUN_DENY
SYSTEM_FENCE_CURRENT_FENCE_MISSING
```

擋住。

這代表 live runtime 還保留舊 self-referential gates，source candidate 與 current Mission/Policy 並未完成 live convergence。

---

# 2. V4.2 → V5.1-R1 必須永久保留的架構血緣

R2 禁止再以「新版本」名義重寫工廠。

## 2.1 V4.2 保留

- Hyper-V Ubuntu VM 為正常 AI coding hard isolation boundary。
- Win11 physical Host 不作正常產品 coding workspace。
- OpenCode + Muse 是 preferred Builder 路線。
- Codex Harness / 固定驗收可作獨立驗證，不等於唯一 Builder。

## 2.2 V4.7 保留

- 多 Project。
- 非同步 Builder / Reviewer / Repair / Integrator。
- 每個 Task/Slice 同時間只能有一個 active owner。
- 每 Project 只有一條 Integration lane。
- ProviderGuard / STOP / recovery / AIMD / backpressure。
- 三 Project shadow 與通知／完工驗收。

## 2.3 V4.8 保留

- DELETE-FIRST。
- protocol-native。
- Lean Cell Kernel。
- single mutation lane。
- bounded evidence projection。
- OpenCode native route baseline。
- Codex / other agent 僅在 qualified lane 使用，不可偷換整個控制面。

## 2.4 V4.9 保留

- Authority / Orchestration / Execution / Evidence 四平面。
- 真實 Builder → Fresh Reviewer → Repair/Re-review → Integrator → Protected Verifier → ProviderGuard → same-source readback → Product Acceptance → Delivery / Notification。
- 第一個完整真實驗收是 N1 command-to-notification full chain。
- Scale order：N1 → N2 → N4/N8 measured → multi-project shadow → multi-host seam if triggered。
- worker provider-write credential = 0。
- new canonical store = forbidden。
- additive orchestration stack = forbidden。
- worklog = projection only。
- telemetry = observation only。

## 2.5 V5.0/R4、V5.1-R1 保留

- 移除 circular bootstrap。
- 修 Host transport self-lock。
- trust-plane default-deny。
- supervisor / scheduler / anti-loop。
- stale automation 不能復活歷史工作。
- canonical spec/Mission/Policy/run/checkpoint 單一同步。
- fixed-purpose read-only diagnostics。
- unique OS trusted caller。
- GPT Web 不進 24/7 liveness critical path。

---

# 3. R2 核心架構

```text
HUMAN
  |
  v
MISSION / Human Gates
  |
  v
PROJECT DIRECTORY
  |
  v
CANONICAL CONTROL POINTER
  |
  +--> Current Spec / Mission / Execution Policy
  +--> Run / Task Graph / Checkpoint / Attempt / Owner
  +--> Evidence refs / unresolved effects
  |
  v
24/7 HOST-OWNED SUPERVISOR / RECONCILER
  |
  +--> READY scheduler
  +--> stale-owner recovery
  +--> quota/provider-health governor
  +--> anti-loop/fingerprint dedupe
  +--> AuditVerdict consumer
  |
  v
MULTI-AGENT WORKER FABRIC
  |
  +--> OpenCode + Muse Spark 1.3        [preferred Builder]
  +--> Antigravity + Gemini             [secondary/shadow/review/repair]
  +--> Codex                            [secondary/shadow/review/repair/specialist]
  |
  v
Hyper-V Ubuntu Worker VM
+ isolated worktree/container/cell
  |
  v
Fresh Reviewer -> deterministic verifier
  | FAIL
  +--> Repair Slice -> qualified agent -> fresh re-review
  |
  v PASS
Integrator (single lane per Project)
  |
  v
clean rebuild / E2E / Protected Verifier
  |
  v
ProviderGuard
  |
  v
same-source readback
  |
  v
canonical checkpoint / delivery receipt / notification

GPT WEB (outside liveness path)
  |
  +--> cold-start canonical readback
  +--> short bounded audit/readback
  +--> AuditRequest/AuditVerdict
  +--> Human interface / exception analysis
  +--> never required for factory liveness
```

---

# 4. GPT Web 最終角色

GPT Web 不是 scheduler、daemon、worker supervisor 或長工。

## 4.1 允許

- Mission interpretation。
- Project exact lookup。
- canonical fresh readback。
- independent audit。
- short bounded provider/Host observation。
- Human interface。
- 重大 exception analysis。
- 產生 durable `AuditVerdict`。

## 4.2 禁止成為必要依賴

- 24/7 heartbeat。
- Task queue owner。
- 長時間 test/fix loop。
- 產品 coding 主體。
- Agent relay 中繼站。
- 每小時重新注入 task text。
- 只有 GPT Web 回覆後工廠才能繼續。

## 4.3 GPT Web 稽核返工契約

```text
AuditRequest {
  project_id
  run_id
  checkpoint
  exact_target_ref/SHA
  task_graph_ref
  evidence_refs
  host_observation_ref
  audit_reason
}
```

GPT Web 回：

```text
AuditVerdict {
  exact_target_ref/SHA
  verdict = PASS | REPAIR_REQUIRED | HUMAN_GATE
  findings[]
  rejected_slices[]
  repair_constraints[]
  required_tests[]
  evidence_refs[]
}
```

`REPAIR_REQUIRED` 由 Supervisor 自動轉為 repair slices，再交 Fleet 重派；GPT Web 不直接逐個跟 Agent 傳話。

---

# 5. Multi-Agent Fleet 路由

## 5.1 Preferred Builder

```text
OpenCode + Muse Spark 1.3
```

前提：

```text
provider_health = HEALTHY
route_compliant = true
quota_headroom = sufficient
OpenCode-native use = true
```

Muse Free 若遇官方 403 / free-tier 限制：

- lane-local WAIT / DEGRADED；
- 禁止 spoof header / TLS / session；
- 禁止自動 paid fallback；
- READY slices spillover 到 Antigravity / Codex qualified lane；
- 不得停整座工廠。

## 5.2 Secondary qualified lanes

```text
Antigravity + Gemini
Codex
```

可承接：

- secondary Builder；
- shadow/bakeoff；
- Fresh Reviewer；
- Repair；
- specialist；
- provider health fallback。

不能因 GPT Web 不做長工，就把 Codex 升成 universal primary Builder。

## 5.3 任務分包

Task Graph Compiler 將 Goal 拆成 dependency-aware slices。

排程輸入：

- task class；
- capability；
- provider health；
- quota/headroom；
- historical pass rate；
- expected cost；
- path collision；
- reviewer backlog；
- integration backlog；
- sandbox eligibility。

原則：

- one active owner per slice；
- independent READY slices 非同步多工；
- high-risk/security/core architecture slice 可多 candidate bakeoff；
- Reviewer 優先與 Builder 分離 agent/model；
- Integrator 單線序列化。

---

# 6. P0-A：Canonical / Cross-Session 統一

## R2-00｜發布 V5.1-R2 Authority Rebase

新 immutable spec / Mission / Policy 必須明確寫：

```text
CURRENT_SPEC = VNEXT5.1-R2
GPT_WEB_ROLE = EPHEMERAL_AUDITOR_CONTROL_INTERFACE
DURABLE_ORCHESTRATOR = HOST_OWNED_24X7_SUPERVISOR
FACTORY_EXECUTION_MODEL = MULTI_AGENT_FLEET
PREFERRED_BUILDER = OPENCODE_MUSE_SPARK_1_3
SECONDARY_LANES = ANTIGRAVITY,CODEX
NORMAL_PRODUCT_CODING = HYPERV_UBUNTU_VM
```

舊 EP74 的：

```text
CODEX_PRIMARY_FOR_SUBSTANTIAL_OR_LONG_RUNNING_WORK
```

不得再作 factory-wide routing authority；只能視為「GPT Web 不應扛長工」的歷史過渡語意。

## R2-01｜Cross-Session Cold-Start Contract

所有新 Session / Agent / 重啟固定：

```text
exact Project lookup
-> Project Directory
-> canonical control pointer
-> Current Spec
-> Mission
-> Execution Policy
-> Run / Checkpoint / Task / Attempt
-> execution owner
-> unresolved effects
-> fresh HostObservation/provider readback
-> reconcile
-> choose safe next action
```

禁止使用：

- Memory；
- 最近 chat；
- recent handoff；
- latest local file；
- scheduled wake payload；
- old Goal；
- previous AI summary；

作 current authority。

若 canonical 不可讀：

```text
CONTROL_STATE_UNAVAILABLE
```

只能 fail closed，不准猜。

## R2-02｜Liveness reconciliation / stale owner takeover

Owner 是否活著不能只靠 UI thread。

真實 liveness 來源：

- OS/process/container；
- provider agent session；
- supervisor heartbeat；
- active job / receipt；
- lease freshness。

若：

```text
run=RUNNING
lease expired
no live job
no unresolved effect
```

則 Supervisor 必須：

```text
STALE_OWNER_CONFIRMED
-> close/revoke stale owner generation
-> increment attempt/owner generation
-> recompute READY
-> dispatch next qualified owner
```

若有 unknown effect，先 readback-first，不得重派。

---

# 7. P0-B：解除 Factory MCP 自製鎖

## 7.1 必須刪除的 transport authorization gates

以下不得再作 Host transport deny 條件：

- Mission revision rollover；
- checkpoint rollover；
- run-id regex / allowlist rollover；
- task-id regex / allowlist rollover；
- attempt/generation 僅作 metadata 的值；
- AuthorizationEnvelope generation 僅因 Session/Mission 更新而失效；
- per-Session Human reauthorization；
- stale scheduled wake payload；
- Chat/Codex relay approval loop。

對已 Human 永久授權的可逆 pre-Production construction：

```text
Mission/checkpoint/run/task changes = AUDIT METADATA
not TRANSPORT PERMISSION
```

## 7.2 真正保留的安全條件

- exact Project target；
- exact Host target；
- STOP；
- unique OS trusted caller；
- genuine stale concurrent executor conflict；
- unresolved ambiguous effect；
- provider/backend CAS/revision conflict；
- timeout；
- bounded output；
- concurrency；
- durable receipt；
- same-source readback；
- operation-owned rollback；
- Production/Human gate。

## R2-03｜Fixed-purpose read-only observation

在現有四個 public tools 內擴充 `factory_status` projection，不增加第五 tool。

至少能唯讀取得：

- capability_status；
- installed runtime version/hash；
- per-orphan identity / receipt refs；
- service/process/scheduled-task identity；
- broker/receipt status；
- supervisor status；
- agent/fleet lane summary；
- trusted-caller identity；
- last failure / last successful operation；
- host boot identity。

硬規則：

```text
arbitrary PowerShell input = NO
Host mutation = NO
mutation fence = NOT REQUIRED
```

PR #342 可作 R2-03 候選基礎，但必須重新對齊 R2 Mission，保留其 architecture-neutral bytes，不把歷史 WAIT/review 當 liveness gate。

## R2-04｜Unique trusted caller

`NT AUTHORITY\NETWORK SERVICE` shared SID 不能單獨作 unique identity。

可接受：

- dedicated service account；
- service-specific SID；
- 唯一 ACL-protected IPC / named pipe / queue；
- 等價 OS-enforced unique principal。

負向測試：

```text
another generic NETWORK SERVICE process
-> cannot inject SYSTEM PowerShell request
```

## R2-05｜Non-circular bootstrap repair lane

Factory MCP 若把自己鎖死，修復不能依賴同一被鎖的 MCP。

建立**固定用途、一次性/可刪除的 Host Control Plane Repair Lane**：

- 只接受 exact qualified manifest；
- target path allowlist；
- exact expected SHA256/blob；
- prestate hash/ACL；
- operation-owned backup；
- apply；
- restart exact component；
- same-source readback；
- canary；
- rollback；
- durable receipt；
- 不接受 arbitrary shell；
- R2-06 live acceptance 後 DELETE_GATE 移除或收斂回 Supervisor primitive。

不得增加永久第二控制面。

## R2-06｜Live Factory MCP install / acceptance

接受標準：

```text
run_as = NT AUTHORITY\SYSTEM
public_tools = exactly 4
SYSTEM_CAPABILITY_RUN_DENY = absent for authorized pre-Production scope
SYSTEM_CAPABILITY_TASK_DENY = absent for authorized pre-Production scope
SYSTEM_FENCE_CURRENT_FENCE_MISSING = absent for authorized pre-Production scope
Mission rollover alone does not disable transport
checkpoint rollover alone does not disable transport
fixed read-only diagnostics PASS
timeout PASS
bounded output PASS
receipt durability PASS
orphan projection PASS
Production still denied
```

---

# 8. 24/7 Supervisor / Scheduler / Anti-loop

## R2-07｜Host-owned supervisor

Supervisor 必須：

- Windows reboot 後自動啟動；
- supervisor crash 自動重啟；
- Codex UI 關閉不影響 liveness；
- GPT Web 完全離線仍可施工；
- fresh-read Project Directory / canonical control；
- fingerprint current state；
- recompute READY Task Graph；
- dispatch Fleet；
- reclaim stale owner；
- persist checkpoint/evidence。

## R2-08｜Anti-loop / dedupe

相同 durable fingerprint：

```text
same exact source bytes
same acceptance contract
same provider state
same unresolved effects
```

則：

- deterministic PASS 可 reuse；
- 不重跑相同 test；
- 不重發 handoff；
- 不重產 no-delta report；
- 不重 dispatch same side effect。

Scheduled wake payload 只能包含 locator，例如：

```text
project_id
```

禁止包含 task / phase / next action / old R3/R4/V5.0 文本。

`WAITING_EXTERNAL` 只能 park 該 lane，不可停整廠。

---

# 9. Review / Repair / Integration 閉環

## R2-09｜Fresh review independent of GPT Web

Factory-native Fresh Reviewer 為正常 liveness path。

GPT Web independent audit 是額外驗證，不得讓 PR semantic review 等待變成整廠停機。

Review verdict：

```text
PASS
CHANGES_REQUIRED
INSUFFICIENT_EVIDENCE
HUMAN_GATE
```

`CHANGES_REQUIRED`：Supervisor 自動建立 Repair Slice，重新路由到 qualified lane。

## R2-10｜Single Integration Lane

同一 Project：

- accepted slices 排隊；
- 一次只一個 Integrator 修改 integration workspace；
- clean rebuild；
- full regression/E2E；
- protected verifier；
- ProviderGuard。

Candidate-owned tests 不得在 privileged self-hosted runner 上取得自證 authority。

---

# 10. Trust Plane / CI

## R2-11｜Privileged CI closure

必須：

- `.github/workflows/**` default-deny on protected privileged path；
- candidate code/tests 不直接在 privileged self-hosted runner 執行；
- immutable trusted verifier；
- exact expected blob/tree/path set；
- separately qualified bootstrap transition；
- runner-group workflow allowlist readback；
- branch/ruleset protection readback；
- no candidate self-authenticating expected-set。

PR #333 等歷史 candidate 只可作 donor/evidence；不得把 structural verifier PASS 升格為 live trust-root acceptance。

---

# 11. Unknown Effects / Orphans

## R2-12｜5 orphan reconciliation

目前 live count = 5。

每筆必須 same-source 分類：

```text
HISTORICAL_TERMINAL_RESIDUE
COMPLETED_BUT_UNCOLLECTED
TRUE_UNRESOLVED_EFFECT
NOT_APPLIED
PARTIAL_OR_AMBIGUOUS
UNKNOWN
```

在 identity/readback 前禁止：

- delete；
- retry；
- redispatch；
- process kill；
- receipt mutation。

`OP025=UNKNOWN` 保持未知直到 provider evidence 收斂。

---

# 12. Cross-project provider decoupling

## R2-13｜HANYAO read-only recovery

Factory MCP 修好後立即恢復 HANYAO Ads/LINE fresh read-only reconciliation。

但 Cloudflare D1 read-only 應優先拆出 least-privilege provider-native read lane：

```text
D1 SELECT-only observability
!= arbitrary SYSTEM PowerShell
```

Google Ads 若仍需要 Windows/gcloud impersonation 才走 privileged Host lane。

執行 2026-09-17 → current：

```text
LINE
-> business_conversion
-> outbox
-> provider attempt
-> Google SUCCESS
```

分類：

- 真沒有客人；
- attribution 漏失；
- outbox 漏失；
- provider failure；
- Google success/reporting mismatch。

---

# 13. Any-State Cross-Session 驗收矩陣

R2 必須對下列狀態逐一開「完全新 Session」驗收：

1. clean idle；
2. live Builder running；
3. Reviewer running；
4. owner lease expired；
5. Agent UI closed；
6. GPT Web gone；
7. Supervisor restart；
8. Windows reboot；
9. VM reboot；
10. `WAITING_EXTERNAL`；
11. provider 429/quota；
12. Muse 403；
13. unknown side effect；
14. orphan present；
15. scheduled stale wake fires；
16. Mission updated while worker old；
17. Policy updated while worker old；
18. same exact test already PASS；
19. provider readback unavailable；
20. integration conflict。

每個新 Session 都必須只靠：

```text
Project Directory
+ canonical state
+ provider observation
```

得出一致的：

```text
current spec
Mission
Policy
run/task/attempt
owner/liveness
completed gates
blockers
unresolved effects
next safe transition
```

---

# 14. Daily Monitoring / CURRENT BASELINE 契約

每日監控不可保存自己的 baseline。

每次現算：

```text
Fresh canonical
+ Fresh HostObservation
+ Fresh provider state
= report
```

報告頂端強制：

```text
CURRENT_SPEC
MISSION
POLICY
CHECKPOINT
RUN
TASK
ATTEMPT
OWNER
OWNER_LIVENESS
HOST_OBSERVED_AT
FACTORY_MCP
SUPERVISOR
FLEET
ORPHANS
UNRESOLVED_EFFECTS
DRIFT
```

若 report checkpoint/spec 舊於 current pointer：

```text
MONITOR_STALE_SOURCE_FAILURE
```

禁止繼續用舊版本做新聞／施工判定。

---

# 15. Evidence Truth Boundary

永遠不可混成同一個 PASS：

```text
source exists
local tests PASS
candidate tests PASS
exact-head structural verifier PASS
semantic review PASS
canonical publication PASS
live install PASS
live behavior PASS
product acceptance PASS
Production acceptance PASS
```

每層都需自己的 evidence refs。

---

# 16. Human Gate 最小化

Human 只保留：

- Mission / 重大策略改變；
- Production 最終授權；
- 新增付費；
- 法律／契約／簽署／身分；
- OAuth/MFA；
- 重大不可逆擴權；
- bounded reconciliation 後仍無法判定的外部副作用。

同一已授權可逆 pre-Production scope：

- 不因 Chat Session 換掉重問；
- 不因 Codex Session 換掉重問；
- 不因 checkpoint/Mission metadata rollover 重問；
- 不因 Agent lane 切換重問。

---

# 17. R2 施工順序

## P0 / 必須先完成

```text
R2-00 Publish VNEXT5.1-R2 authority rebase
R2-01 Cold-start / canonical continuity contract
R2-02 stale owner + liveness reconciliation
R2-03 bounded read-only Factory observation
R2-04 unique trusted caller
R2-05 non-circular host repair lane
R2-06 live Factory MCP install + canary
R2-07 24/7 Supervisor/reboot/crash acceptance
R2-08 scheduler anti-loop / stale automation eradication
R2-09 any-state cross-session regression
```

## P1 / 工廠主體收斂

```text
R2-10 Multi-Agent Fleet routing
R2-11 Task Graph async slicing / quota / AIMD
R2-12 Fresh Review / Repair / Re-review
R2-13 Integration lane / product verifier
R2-14 ProviderGuard / publication / notification
R2-15 HANYAO read-only recovery / provider-native decoupling
```

## P2 / 真實規模驗收

```text
R2-16 REAL N1 command-to-notification full chain
R2-17 N2
R2-18 measured N4/N8
R2-19 multi-project shadow / fairness
R2-20 DR restore / unknown-effect campaign
R2-21 bounded RSI candidate loop
```

普通產品功能工作在 R2-00～R2-09 未 PASS 前不得搶 P0。

---

# 18. R2 完成條件

只有全部成立才算 R2 完成：

```text
CURRENT_SPEC = VNEXT5.1-R2
CANONICAL_SINGLE_AUTHORITY = PASS
ANY_STATE_COLD_START = PASS
GPT_WEB_NOT_LIVENESS_CRITICAL = PASS
HOST_SUPERVISOR_24X7 = PASS
MULTI_AGENT_FLEET = PASS
OPENCODE_MUSE_PREFERRED_ROUTE = PASS_WHEN_HEALTHY
ANTIGRAVITY_CODEX_SECONDARY = PASS
HYPERV_NORMAL_CODING_BOUNDARY = PASS
MCP_READONLY_BOOTSTRAP = PASS
UNIQUE_TRUSTED_CALLER = PASS
MCP_SELF_LOCKS_REMOVED = PASS
SYSTEM_HOST_POWERSHELL_CANARY = PASS
STALE_AUTOMATION_RESURRECTION = FAIL_TO_REPRODUCE
STALE_OWNER_AUTORECOVERY = PASS
ORPHAN_RECONCILIATION = PASS
LIVE_REVIEW_REPAIR_INTEGRATION = PASS
PROTECTED_PRODUCT_VERIFIER = PASS
PROVIDER_PUBLICATION_READBACK = PASS
DELIVERY_NOTIFICATION = PASS
REAL_N1 = PASS
PRODUCTION = false
PAID_FALLBACK = false
WORKER_PROVIDER_WRITE_CREDENTIALS = 0
PUBLIC_FACTORY_MCP_TOOLS = 4
```

---

# 19. Codex 施工要求

Codex 在 R2 中不是整座工廠唯一 Builder；它目前的任務是作為**控制面恢復／Host-maintenance／qualified secondary agent**，先把工廠修回能自行派工給 Fleet 的狀態。

Codex 不得因 review pending、PR draft、GPT Web offline 或某 lane waiting 就停整體 Goal。

每次實質進度必須持久化為：

- provider-addressable commit/ref；或
- exact test/verifier result；或
- same-source readback；或
- canonical checkpoint；或
- exact blocker + durable re-entry condition。

只有報告文字不算進度。

---

# 20. 來源基線

本規格依據：

- canonical Project Directory / `v45/factory-control` current pointer；
- checkpoint 194；
- Mission `20260929T115735+0800`；
- Policy `EP74`；
- run `V51-R1-001/run-r1-03.json`；
- Issue #310 V5.1-R1 R1-03 / multi-agent routing hotfix / Goal override；
- PR #342 read-only diagnostics candidate；
- V4.2 construction plan；
- V4.8 Lean Protocol Native Optimization spec；
- V4.9 Factory Completion / Scale Closure spec；
- 2026-09-29 CURRENT BASELINE / ecosystem monitoring evidence；
- live Factory MCP `factory_status` 2026-09-29。

