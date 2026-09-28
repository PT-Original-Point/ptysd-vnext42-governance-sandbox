# VNEXT5.0-R4-SILKY-AUTONOMOUS-CONTINUATION｜優化修正施工規格

版本：R4 candidate
日期：2026-09-28
Mission：不改變 20260926T220900+0800 最終戰略目標；只修 Execution Architecture、liveness、Factory MCP 與 CI trust plane。

## 1. 終局流程

Human Mission
→ Project Directory / canonical control
→ work-conserving controller
→ Codex non-interactive bounded execution
→ Factory MCP SYSTEM transport
→ provider/Host same-source readback
→ evidence delta
→ next READY unit
→ 自動重複直到 genuine Human-reserved Gate 或 Mission acceptance。

正常施工不得依賴：
- OpenAI Scheduled Watch；
- 某個 ChatGPT/Codex UI session 持續開著；
- 人類複製貼上 handoff；
- 外部 AI review 即時回覆；
- 最近聊天/Memory；
- local-only snapshot。

## 2. Host transport 重新定義

host_powershell 應是已由人類授權的 DESKTOP-1B6PD2P SYSTEM transport primitive。

MCP transport 保留：
- exact Host/broker identity；
- 四工具 surface；
- input syntax；
- script/output size；
- timeout；
- concurrency；
- durable STARTED/terminal receipt；
- timeout/orphan classification；
- secret-output prohibition。

MCP transport 不得再用 current Mission revision/hash、current checkpoint、AuthorizationEnvelope generation equality作「能不能呼叫 transport 本身」的 boot prerequisite。

Project controller 才決定某支腳本是否符合 Current Mission、是否能做 shared mutation、是否屬 Production/business/cost/Human-reserved。

## 3. R4 施工序列

### R4-00｜凍結舊 reporting loop
- no evidence delta => no new full graph snapshot；
- no repeated same-head handoff；
- OpenAI Watch 保留 advisory，不得改 canonical state。

### R4-01｜修掉 Factory MCP circular bootstrap
目標檔案：
- tools/csg/factory-mcp/src/index.mjs
- tools/csg/factory-mcp/src/invoke-hostguard.ps1
- tools/csg/factory-mcp/broker/hostguard-broker.ps1
- 對應 protocol/regression tests。

Acceptance：
- stale Mission/capability generation 不再讓 host_powershell transport 自鎖；
- arbitrary harmless SYSTEM canary 可執行；
- public tool count仍是4；
- timeout/orphan/receipt/concurrency 全保留；
- Production/business/cost policy仍由 controller enforce。

### R4-02｜一次性 local bootstrap
使用者本輪已明確要求 Codex 在目前 pre-Production Mission 內自動施工，不再逐步索取「繼續」。

Codex 必須：
1. fresh-read Directory/CP192/R4 exact candidate。
2. 測試候選。
3. 讀 installed Factory MCP prestate。
4. operation-owned backup。
5. 只部署已驗證 R4 runtime delta。
6. restart broker/tunnel。
7. same-source readback。
8. harmless SYSTEM canary。
9. failure時只 rollback 自己改的檔案。

### R4-03｜關閉5筆 orphan
- read exact orphan identities；
- same-source classify CONFIRMED / NOT_APPLIED / PARTIAL_OR_AMBIGUOUS；
- OP025 UNKNOWN 不 blind redispatch；
- classification真正改變才更新 canonical。

### R4-04｜Host-owned autonomous supervisor
安裝 Windows Scheduled Task/service：PTYSD-Autonomy-Supervisor-V50。
Supervisor不是第二 canonical store，只保存：
- last durable fingerprint；
- last dispatched operation identity；
- last successful tick；
- process/runtime health。

每輪：
1. resolve Directory；
2. read control/checkpoint/run；
3. read mailbox actionable state；
4. read Factory fingerprint；
5. compute durable fingerprint；
6. fingerprint相同且無 READY => sleep；
7. 有 READY => 啟動/續接 Codex bounded execution；
8. completion後 fresh readback；
9. evidence delta => 自動下一個 READY；
10. genuine Human-reserved gate才通知人。

Codex runtime 優先用官方 codex exec 非互動模式；官方文件把 codex exec 定位為 automation/CI。Windows background invocation必須明確處理 non-TTY stdin，避免已知 pipe/EOF hang。Codex app-server daemon可作可替換 runtime，但目前官方仍標 experimental，因此不能成為唯一 continuity authority。

### R4-05｜work-conserving scheduler
狀態：
READY / RUNNING / WAITING_EXTERNAL / WAITING_HUMAN / DONE / FAILED_RETRYABLE / FAILED_TERMINAL。

規則：
- WAITING_EXTERNAL 必須 yield executor slot；
- shared mutation仍單 writer；
- read-only/preparation可在不衝突時前進；
- GOAL_STATUS=BLOCKED 只有所有 remaining lanes 都沒有合法 action時成立。

### R4-06｜anti-loop fingerprint
最少綁：
project_id + Directory head/revision + control head + checkpoint digest + run/attempt + accepted-source head + mailbox last actionable id/state + Factory host/tunnel/orphan fingerprint。

同 fingerprint：
- 不重送 handoff；
- 不新建 snapshot；
- 不重跑同一測試；
- 不重 dispatch non-idempotent operation；
- 沒 READY 就 sleep。

### R4-07｜review decriticalization
pre-Production reversible work：
- deterministic tests + trusted structural verifier + same-source readback 是 blocking evidence；
- external AI semantic review改為 asynchronous advisory/batch audit，不作 liveness依賴；
- Production final仍 Human-reserved。

### R4-08｜CI / trust-plane hardening
必修：
1. 移除/封死 factory-bounded.yml 任意 control_sha 在 privileged self-hosted runner執行 candidate tests 的路。
2. candidate functional CI只跑 GitHub-hosted ephemeral runner。
3. trusted self-hosted runner只執行 immutable trusted verifier或固定 maintenance executor。
4. verifier default-deny 整個 .github/workflows/ 與 trust-root。
5. trust-root change走獨立 Human-authorized lane。
6. candidate在 trusted runner只能被當 data，不得執行 hooks/tests/config。

### R4-09｜effect/receipt durability
external mutation：
intent persisted
→ stable operation/idempotency identity
→ dispatch once
→ terminal receipt/minimum classification
→ same-source provider readback
→ canonical transition。

### R4-10｜單一 digest 工具
統一產生 canonical JSON / SHA-256 / Git blob OID / manifest。
禁止人工貼 digest；CRLF/LF 直接 hash bytes。

### R4-11｜cross-session / disconnect fault campaign
必測：
- ChatGPT session loss；
- Codex session/process loss；
- Host reboot；
- tunnel restart；
- GitHub temporary failure；
- OpenAI Watch完全 disabled；
- provider成功但 canonical lag；
- timeout unknown effect；
- stale attempt；
- duplicate wake。

Acceptance：全部 finite recovery，不靠人叫醒。

### R4-12｜恢復 V5.0 R3 正常施工
continuity/liveness P0 全 PASS 後：
REAL_N1 → live review/repair → product E2E → N2 → multi-project shadow → scale → DR → unknown-effect campaign → worklog/telemetry → bounded RSI。

## 4. Codex 永續執行契約

Codex 每一輪不得把「報告狀態」當 terminal success。

每個 material completion 後：
fresh read → evidence delta → READY recompute → execute next legal action。

WAITING_EXTERNAL 不能終止整體 Goal。
PR建立、handoff貼出、verifier完成、report完成都不是工廠完成。

只有：
- genuine Human-reserved gate；
- Mission全部 acceptance PASS；
- 或所有 remaining lanes 確實都沒有任何合法 non-human action，
才可停止。

## 5. 仍保留的人類事項

只有：
- Mission/最終目標改變；
- Production final；
- 新費用/paid fallback；
- 法律、契約、簽署、身分；
- OAuth/MFA；
- 重大不可逆或高風險擴權。

目前 Mission 內的 code、test、Git、Host pre-Production、readback、repair、rollback、restart、scheduler/supervisor 安裝與 fault injection，不逐步要求人類說「繼續」。

## 6. R4 完成定義

文件完成不算完成。Live acceptance 必須證明：
- host_powershell 不再因 Mission/fence drift 自鎖；
- 5 orphan 全分類；
- OpenAI Watch disabled 仍能施工；
- reboot/process crash 自動恢復；
- duplicate wake 不重做副作用；
- provider/canonical drift 自動 reconcile；
- fresh Codex process 可從 Project Directory 恢復；
- 人類不再當傳聲筒或鬧鐘。
