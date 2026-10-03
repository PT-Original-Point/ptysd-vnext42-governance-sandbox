# VNEXT5.2 兩片回收與續工稽核 — 20261003

## 結論

兩個 worker 回傳本地 source 後，尚未建立有效的整合接續。S-MCP 可以結束本片交付；S-RECOVERY 明確仍有 READY，不符合全域耗盡。兩片停止不等於 Mission 完成。

本輪已真正回收、匯入新隔離 worktree、修正整合缺陷、跑回歸、建立 provider source candidates 並讀回。沒有要求使用者重新設定 Git 作者，也沒有捏造 Goal ACTIVE。

## 實際候選

|來源|PR|exact head|base|狀態|
|---|---|---|---|---|
|MCP 0.2.4|385|da8e1a767d54e67ba7bb15d7d35e9ae535e50034|d39486601d851e31256852a24e9c1393b9046fe5|Draft、structural PASS、semantic PENDING|
|runtime + recovery|386|c2bfa038121782a3ae903591981a0b05f52a7b38|06da5fa224b65b9346e8b250dcea686d0ed458ee|Draft、structural PASS、semantic PENDING|

PR381、PR377 舊身份保留。新 source pair 互相 exact bind；promotion 沒有混入來源 PR。兩個 bounded-driver-acceptance 均 SKIPPED_NOT_PASS。

## 找到並修正的問題

1. **交付接續缺口**：未提交的 patch/tree 是合法輸入，缺 Git 作者不阻止 provider 建立 commit。整合者應回收、驗證並推進，不能等待 worker 自行擁有 provider 寫入憑證。
2. **planner 局部 UNKNOWN 造成全域停工**：改成停該 operation 與依賴它的 lane；共享 digest、canonical binding 或 freshness 失效才拒絕整份 facts。input completeness 與 READY availability 分別回報。
3. **DONE 的依賴漏洞**：原程式直接相信 raw DONE；現在遞迴檢查已接受的 completion dependencies，無收據的 DONE 也不能解鎖 downstream。
4. **59-count 假完整**：原程式只數單元。現在完整目錄判定驗證固定 union digest；任意 59 個 definitions 不得宣稱 GLOBAL_EXHAUSTED。
5. **Git 換行破壞已驗證雜湊**：worker 本機通過，但匯入後 manifest payload／parent contract 失配。source-local Git attributes 保留 exact qualified bytes，沒有修寬 hash verifier；node_modules 排除於候選。
6. **跨候選驗證過時**：舊 runtime 測試綁錯 producer，且缺目前必需的 Project scope test setup。已綁 PR385 head/tree/blob 並補正 fixture；真實 caller/Host scope 檢查維持。
7. **收據語意混用**：S-RECOVERY 的 unresolved_effects 列表實際是未滿足的驗收 lane；actual_side_effects=[] 也未反映本地輸出。保留原 bytes，在整合 CURRENT 中將局部寫入、外部 unknown effects、parked gates 分開記錄。

## 驗證

- MCP inspector PASS；source regression 48/48。
- Supervisor regression 123/123；runtime core 26/26。
- cross-candidate positive、signed-evidence fail-closed matrix、source authority checks PASS。
- PR385 structural verifier：run 37115710979 / job 111182016024。
- PR386 structural verifier：run 37116067356 / job 111183022230。
- native Git 固定 public repositories 讀回 CP200、Hanyao CP2、Directory、Mission/Policy/run 與共同施工資料；沒有重試已知 403 路線。
- 真實 provider read-only shadow 的 local journal 第 1 筆已讀回；59-unit plan 為 READY_AVAILABLE。execution PARKED；Host dispatch/mutation、canonical write、local dispatch 全 false。
- 舊 worker HEAD、index tree 與 status digest 匯入前後一致。原 D02/A00 施工資料保留。

以上沒有升格為 independent semantic、Web consumer、Ads business data、live installation、Hyper-V isolation、cancel/receipt、Windows reboot、UI closed 或 24x7 PASS。

## 尚未解決且必须接續

- 精確兩個新 source head 的 independent semantic review 尚未收到。
- 本輪只找到 native Codex executable 與 Antigravity/OpenCode application 登錄；後兩者沒有 PATH 命令，不代表不能工作。Get-VM 回 ACCESS_DENIED，僅限制 VM discovery／prepare，沒有阻止 native source/read。
- F01 真實隔離 task/start/cancel/durable receipt route 尚未證明。現有 source adapter 與 worktree 都不能替代 OS sandbox。
- installed Factory runtime、protected caller/Host scope、實際 Web tools/list／factory_status 均未觀測。MCP 安裝及廣告資料接受尚未完成；Factory 403 路線也沒有因 native reader 成功而被假稱已修好。
- 固定 owner-liveness producer 仍帶 gen5 observation target。它與現有 CP200 相符；未證明未來 canonical owner rollover 的 producer target provisioning，不得以 JS projection regression 宣稱整條 rollover 已驗收。
- frozen PR384 的 work index 是歷史 snapshot。最新 progress 已分開保存；Directory 與 installed reader 尚未正式接入此 progress locator。只有發佈這份報告，不能宣稱所有新 Session 已自動同步。
- S-ADS／Antigravity 仍待實際回傳，現有 Hanyao control read 不等於 Ads／D1 data read。

## 接手規則

1. 讀此資料夾 CURRENT.json、兩個 provider source PR、operation-facts.json、ready-queue.json 與原完整共享契約。
2. queue 是本輪 15 分鐘有效觀察，過期後 fresh-read 並重算；不得照抄成永久現況。
3. 整合者接收 worker exit 與 result，校驗 hash/write-set、匯入、測試、發佈 exact head；任何原始範圍仍 READY 就繼續。
4. API 缺 Goal resume 時不偽造狀態；不要以 paused/null Goal 停止已授權 native source/read。這不是跨 Session 自動喚醒服務的替代品。
5. semantic／live／caller gate 停相關 lane。不要安裝未 qualified 的 candidate；Production 與 unknown-effect readback-first 保留。
6. 執行、研究與產品 intake 等後續 source 依原完整契約續做；Mission ACTIVE，ALL_LEGAL_READY_LANES_EXHAUSTED=false。

本輪沒有宣告工廠完成，也沒有安裝背景 Supervisor；持續無人值守執行仍需實際 runtime cutover/survival 驗收。
