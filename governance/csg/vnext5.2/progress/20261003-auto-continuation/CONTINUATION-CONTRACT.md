# VNEXT5.2 持續施工修正契約

採用日期：2026-10-03。沿用完整59 operations、64 acceptance、PF30/PRG28與原Human契約；本契約修正協調流程，沒有宣告產品上線。

## Human最新角色修正（最高優先）

root只負責獨立稽核、制定計劃、分派、回收、要求返工與接受/拒絕仲裁，不直接施工產品原始碼。三個施工代理為Codex Luna Max、Antigravity、OpenCode。施工結果由root自動取得；不要求Human在三者間搬運。root先前對intake的三個檔案變更屬待施工代理接手的候選，不能由root自行宣告獨立驗收PASS。
施工路線缺失/平台credits錯誤應如實park該route並安排其他可用施工代理；缺席品牌不可冒名宣稱已開工。沒有費用/身份授權不得自行付費或消耗帳號reset。

## 施工責任

Human已授權自動發包、回收、返工與續工；不再要求Human人工貼prompt或搬patch。root是唯一整合者。子片可完成並回報，root必須消費結果、重算READY並續派。Goal API實際ACTIVE是continuation工具，不能作canonical/Host授權。

使用既有Codex send_message_to_thread/wait_threads、既有subagent接口、OpenCode原生CLI及可資格確認的Antigravity原生路線。沿用SDK/Git/作業系統；不新增mailbox bus、agent database、第二dispatcher、審批AI或泛用gateway。每個worker有專用worktree與write-set；Git隔離不宣稱OS sandbox。

## 每次協調循環

1. fresh Directory→canonical pointer→checkpoint/Mission/Policy/run→unresolved effects→provider refs；分別報construction、canonical、installed。
2. 讀持久dispatch與worker實際狀態。在途task不重派；不以UI/thread消失推定完成。unknown effect先同來源readback。
3. 驗證結果write-set、base/tree/patch digest、local tests、exact structural與independent semantic各自範圍。
4. 有findings即派exact finding返工，保留完成的無關工作；不重新餵全部history。
5. 重算全59且檢查RUNNING、RETRY_BOUNDED、recovery工作；只缺一個route不能全域停止。
6. 容量允許即派最高優先且不衝突的READY，持久記錄task/thread/worktree/binding；有限結果回收或native wait，而非要求Human再貼指令。
7. source穩定才由整合者從fresh exactbase重建一commit。只push最終head一次、protected structural一次、獨立semantic綁exacthead；PASS後不得改source自綁。

## 最新狀態定位

固定非canonical ref：`codex/vnext5.2-construction-latest`。
固定檔：`governance/csg/vnext5.2/progress/CURRENT.json`。
locator引用immutable progress commit/path/byte digest；progress不引用自身commit。架構凍結包、來源候選、進度locator各分離。由root單寫者fresh-prestate CAS更新；衝突readback，不強行覆蓋。新consumer冷啟動讀locator→exactprogress bytes→digest→freshness→重算。舊snapshot保留historical，過期facts不能作dispatch依據。

Directory/installed reader尚未整合locator時明確標示，不能宣稱所有Session已同步。MCP reader修復後factory_status在Host probe故障時仍應提供獨立construction/canonical readback，維持4publictools與fixed-purpose read-only。

## 持續執行與停止

root Goal初次實際create/readback ACTIVE；目前狀態必須fresh get_goal，已出現usageLimited，不能將歷史ACTIVE當成現在。App原生heartbeat `vnext5-2` 每30分鐘回到本thread補充中斷恢復；不建立重複dispatch。App需運行與本機開機，並非Supervisor24x7已驗收。
局部source/test/PR/worker completion不完成Mission。完整fresh catalog沒有READY時仍檢查RUNNING/RETRY/recoverable讀取；只park精確lane。保留Production、成本擴張、identity/OAuth/MFA、重大不可逆trust與未知效果readback等真Human gate。

## 此輪驗收優先序

P0：修PR385六個語意缺陷、PR386六個語意缺陷；冷consumer最新progress定位；原生route/cancel/receipt資格與自動回收。
下一輪：source最終候選→exactreview→可授權Host/MCP live read/install與廣告日期scope讀取→F01隔離→Supervisor實際survival→其餘完整產品功能。每項依自身phase，不把未來install gate倒灌source/read-only。
local/structural PASS不等semantic/live/system/Ads/Production PASS。不可承諾零事故或全部測試完成。

## 生產級最小膠水原則

使用成熟native CLI/SDK及原有journal/ledger，不自行複製成熟調度器。任何新adapter限工具差異、身份/receipt正規化與write-set校驗；先量測再替換。Restate/DBOS仍依原bounded spike契約選型；不能為追求架構名稱重做已可用source。剩餘工程以業務可讀時間、false-block、重複派工、返工、netcustomLOC、恢復成功率衡量。

官方App排程運行條件：https://learn.chatgpt.com/docs/automations?surface=app
