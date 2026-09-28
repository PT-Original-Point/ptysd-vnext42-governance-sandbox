# VNEXT5.0 R4 全自動軟體工廠：自主施工停滯、自鎖與循環失敗深度稽核報告

日期：2026-09-28
Project：CHATGPT_GLOBAL_SKILL_GOVERNANCE／全自動軟體工廠
稽核基準：Project Directory revision 5、canonical control CP192、accepted-source 7784663cca65dc7b0aa96c599db3224ad8317817。

## 0. 核心裁決

目前 host_powershell 的主要阻塞確實是 PTYSD Factory MCP 自己加入的治理限制，而不是 Windows 本身必須如此。

accepted-source 的 tools/csg/factory-mcp/src/index.mjs 在真正呼叫 HostGuard 前先執行 authorizeSystemExecution；current-execution-fence.mjs 又要求 current checkpoint 的 Mission/hash/AuthorizationEnvelope/capability generation 與目前已載入的 system-capability 完全一致。hostguard-broker.ps1 又重做一次相同檢查。這使「舊 runtime 必須先符合新 Mission，才能執行把自己升級到新 Mission 的腳本」形成 circular bootstrap deadlock。

Remote Desktop Commander 過去沒有這一層自我引用 Mission/fence/generation gate，所以不會因治理版本前進而把本機 PowerShell 通道本身鎖死。

修正不應是把所有安全機制歸零，而是把責任放回正確層：
- Host/MCP transport：固定 Host、SYSTEM executor、輸入格式、timeout、容量、receipt、輸出界線、crash/orphan recovery。
- Project controller：Mission、Production、費用、business Project、共享 mutation 是否可做。
- Provider：same-source readback。
- unknown side effect：readback-first、禁止 blind retry。
- Production final、新費用、法律/簽署、OAuth/MFA、重大不可逆擴權仍為 Human-reserved。
正常 pre-Production 可逆施工，不得再因「等待另一個 AI」或 OpenAI Watch 沒醒而停工。

## 1. 現況基線

- Project Directory：governance/project-directory，directory_revision=5，active_run_ref 已發布。
- canonical control：v45/factory-control @ a5ebfd86d440b61ecc4e4dc3ba7b8291836769c7。
- checkpoint：192。
- Current Mission：20260926T220900+0800。
- Current Execution Policy：20260926T220900+0800-EP72。
- Factory MCP：四工具；Host DESKTOP-1B6PD2P；PTYSD-WORKER-01 Running；tunnel live/ready。
- Host exec lane：IDLE_WITH_ORPHANS，orphan_count=5。
- harmless host_powershell canary 在執行腳本前回 SYSTEM_FENCE_CURRENT_FENCE_MISSING，證明 live self-lock 仍存在。

## 2. 重大缺陷

### F01｜P0｜host_powershell 自我授權循環
Node server -> current execution fence -> loaded system capability -> canonical checkpoint 形成環狀依賴。當 Mission 前進而 Host runtime 尚未升級，新的合法施工反而無法執行升級。

### F02｜P0｜Execution Policy 與程式實作矛盾
EP72 已宣告 host_powershell_normal_route=AUTHORIZED_SYSTEM_ARBITRARY；但 accepted-source 實作仍要求一支 script 必須與 current fence 完全一致。政策與 runtime contract 不一致。

### F03｜P0｜同一 authorization gate 被複製三層
src/index.mjs、src/invoke-hostguard.ps1、broker/hostguard-broker.ps1 都攜帶 execution-fence metadata。這不是單純 defence-in-depth，而是三份會 drift 的 mutable authority。

### F04｜P0｜system-capability 被硬綁舊 Mission
server/broker startup validator 把 20260919 Mission/hash/auth/generation=4 寫死。Current Mission 已是 20260926，造成 bootstrap deadlock。

### F05｜P0｜OpenAI Scheduled Watch 被誤當 continuation engine
Issue #310 已明確降級 Watch/Tasks 為 ADVISORY_ONLY；實際 UI 仍反覆每小時只輸出 Continue / Read goal-objective，沒有 evidence delta。排程訊息不是 durable executor。

### F06｜P0｜WAITING lane 霸佔整個執行槽
多輪把 WAITING_PROVIDER / WAITING_EXTERNAL_RECEIPT 當整體 Goal 的停點；即使還有可做的 preparation/readback，也不往下跑。

### F07｜P0｜外部 AI semantic review 被放進 liveness critical path
PR308/309、PR312/313/314 顯示 reviewer transport 變成施工時鐘。Semantic review 可以是品質證據，但不應阻塞可逆 pre-Production 準備工作。

### F08｜P0｜provider 已套用但 canonical 未 reconciliation
P0-02 Directory active_run_ref 已在 provider merge，CP191 卻仍列未發布；直到 PR315 才 reconcile 為 CP192。若只讀 checkpoint，會重做已完成 side effect。

### F09｜P0｜trusted self-hosted workflow 存在 candidate-code execution trust gap
main:.github/workflows/factory-bounded.yml 的 workflow_dispatch 接受 control_sha，checkout 後會在 PTYSD-V45-CONTROL-01 執行該 SHA 的 tests/*.mjs。這讓 privileged self-hosted runner 有執行 candidate code 的風險。必須改成 immutable trusted-source-only。

### F10｜P0｜trusted PR verifier 沒封鎖整個 .github/workflows/
governance/csg/trust-root/csg-trusted-pr-verifier.mjs 只封鎖特定 workflow 檔名，不是整個 .github/workflows/。新增另一個 workflow 可能穿過 path-set gate。應改為 default-deny 整個 workflows 與 trust-root。

### F11｜P1｜mirror PR 造成狀態爆炸
PR309、PR314 只是 exact-blob verifier transport。功能沒增加，卻增加 branch/PR/head/tree/review 身分與 stale 風險。

### F12｜P1｜local-only artifact 造成 INSUFFICIENT_SURFACE 迴圈
bootstrap package 曾只給 local digest，Governance 無法讀 exact bytes，先回 INSUFFICIENT_SURFACE，再補 provider publication。跨 agent 產物應從一開始就 provider-addressable。

### F13｜P1｜receipt/effect durability 不完整
PR276/277/286 等事故顯示 provider/receipt 已 terminal，但 operation identity、stdout/result classification 沒在同一閉環保存，導致額外 readback chain。

### F14｜P1｜recovery 過度碎片化
PowerShell syntax、timeout、fixture residue、receipt parser 等小修各自推 checkpoint，治理本身成為高故障率工作負載。只有 evidence classification 或正式 Gate 變化才應升 canonical。

### F15｜P1｜人工 digest/canonicalization 造成自製故障
曾發生 checkpoint digest 少字元、LF/CRLF script digest 不一致。所有 hash/OID/manifest 應由單一 deterministic 工具生成。

### F16｜P1｜無 evidence delta 仍產生重複 full graph/report
V35/V39/V40 多次 READY=0、BACKGROUND_CONTINUATION_VERIFIED=false。這是 reporting loop，不是 execution loop。

### F17｜P1｜SILENT_NOOP 沒先計算 READY frontier
controller-mailbox.json 的 no_delta_action=SILENT_NOOP 若先於 READY 計算，Goal ACTIVE 也會睡死。

### F18｜P1｜transport 層 run/task allowlist 阻礙 multi-project
Factory MCP 長期要支援多 Project，但 system capability 把 run/task namespace固定在治理 Project。Business admission 應由 controller 決定，而不是 Host transport。

### F19｜P1｜Codex UI/session 被誤當 durable runtime
durable continuity 應來自 canonical provider state + Host supervisor。UI session、compaction、Watch 只能是 client。

### F20｜P1｜缺 anti-loop fingerprint
沒有機械規則阻止相同 control head + mailbox state + Factory fingerprint 被重複處理，所以每小時可以重複同一 Continue、review、snapshot。

## 3. 最近數十輪的四個架構根因

1. Authority duplication：Mission/Policy/control/fence/capability 被複製到太多層。
2. Liveness inversion：review/watch/UI 被放在 executor 前面，等待狀態反客為主。
3. Evidence fragmentation：dispatch identity、provider result、receipt、canonical transition未一次閉環。
4. Trust-plane mixing：candidate CI、trusted verifier、Host maintenance 共用 self-hosted runner，但隔離契約不足。

## 4. R4 修正原則

- 把 host_powershell 改成穩定、非自我引用 Mission 的 SYSTEM transport；不得再要求「先符合下一版 Mission 才能升級到下一版」。
- 四工具表面不增加。
- 保留 input validation、timeout、bounded output、concurrency、receipts、orphan recovery。
- Mission/Production/business/cost 決策只在 controller/canonical layer。
- waiting lane yield executor；存在任何 READY 非人類工作就必須繼續。
- OpenAI Watch 永遠不是必要 liveness。
- 每輪算 durable fingerprint；同一 fingerprint 不重複 request/snapshot/non-idempotent dispatch。
- candidate functional CI 只跑 ephemeral hosted runner；trusted self-hosted runner只跑 immutable trusted verifier/固定 maintenance executor。
- trusted verifier default-deny 整個 .github/workflows/ 與 trust-root。
- canonical transition 只在真正 evidence/Gate 變化時產生。
- provider mutation固定 fresh prestate -> exact dispatch once -> same-source readback。
- 正常 Mission 內 pre-Production code/test/readback/repair/rollback 自動往下，不逐步問人。

## 5. 結論

R4 的目的不是把安全關掉，而是刪掉造成自鎖、重複權威與假自動化的錯誤安全層，留下可證明、可恢復、可 readback 的安全邊界。

第一優先是解除 Factory MCP 的 circular Mission/fence bootstrap；第二優先是建立 Host/GitHub-owned autonomous supervisor，使 Codex UI、ChatGPT session、OpenAI Watch 全部退出必要 liveness 路徑。
