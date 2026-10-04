# VNEXT5.2 持續施工修正契約

## 2026-10-04 最新 Human 恢復與限額優先契約

Human已明確要求重分派、接續施工，優先MCP功能、自造阻塞與任意新Session最新對齊。採用 `VNEXT5.2-限額控制與優先復工施工契約-20261004.md`、`WORK-RESUME-20261004.json`、`routes/resume-batch-20261004/*intent.json`。本節覆蓋以下歷史暫停，不改寫原pause receipt。root只稽核/計劃/派工/回收/仲裁，日常source由AG/OC。Goal仍paused且API不能resume，不能偽造ACTIVE或停全部合法施工。四小時有界回收取代30分鐘喚醒；模型鎖定、原Mission acceptance/Human gates保留。在途先讀回，禁止重派。

採用日期：2026-10-03。沿用完整59 operations、64 acceptance、PF30/PRG28與原Human契約；本契約修正協調流程，沒有宣告產品上線。

## 2026-10-04 Human 模型鎖定（覆蓋舊模型選擇）

全部產品施工只能交 Codex GPT-6 Luna / reasoning max（gpt-6-luna）、Antigravity Gemini 3.8 Flash High（gemini-3.8-flash-high）、OpenCode Muse Spark 1.3 Free（native model.list 已實讀 provider/model ID：opencode/muse-spark-1.3-contributor-free，active/enabled，catalog cost=0；這不是 quota恢復證明）。過去 fledge-alpha-free 僅為歷史證據，禁止續派。禁止偷偷替換模型、自動 fallback、改帳號或新付費路線；指定模型不可用只 park 該 route，保留其 source，其他指定模型的合法 lane 續做。每次派工/receipt 必須帶指定模型與實際模型讀回範圍；未能確認的欄位標 UNVERIFIED，不以文字意圖當實際鎖定成功。root/Sol 仍只做稽核、計劃、派工、回收與仲裁。

## Human最新角色修正（最高優先）

## 2026-10-04 最新 Human 暫停指令（優先於以下續工歷史）

本次 Human 另授權 OpenCode 呼叫診斷：兩次 Muse / xhigh 的官方 Desktop background-service session/fork 已成功，詳見 `VNEXT5.2-OpenCode桌面路線診斷與呼叫修正-20261004.md` 與 `routes/opencode-desktop-route-20261004.json`。舊 fledge session 的真 429 不代表 Muse 不可用。施工保持暫停；Human 恢復後按此精確 route/model/schema 讀回，禁止沿用舊 fledge runner、以正文429分類限流或自行猜測 fork/outcome 欄位。

Human 已要求暫停全部施工及工作排程，進行過去12小時限額稽核與外包重分派設計。root Goal已用真實API切成paused；本機Codex登記的唯一工作heartbeat vnext5-2已用automation_update切成PAUSED並讀回。不得因舊heartbeat文字、READY存在、額度重設或歷史ACTIVE自行恢復。待Human明確恢復。讀WORK-PAUSE-20261004.json；原source、patch、staged index和provider history全部保留，Mission未完成，CP200不變。Antigravity OpenCode adapter返工attempt2已結束但尚待独立回收；暫停期間只做本次Human要求的用量稽核與分工方案，不續派產品施工。

root只負責獨立稽核、制定計劃、分派、回收、要求返工與接受/拒絕仲裁，不直接施工產品原始碼。三個施工代理為Codex Luna Max、Antigravity、OpenCode。施工結果由root自動取得；不要求Human在三者間搬運。root先前對intake的三個檔案變更屬待施工代理接手的候選，不能由root自行宣告獨立驗收PASS。
施工路線缺失/平台credits錯誤應如實park該route並安排其他可用施工代理；缺席品牌不可冒名宣稱已開工。沒有費用/身份授權不得自行付費或消耗帳號reset。

## 施工責任

Human已授權自動發包、回收、返工與續工；不再要求Human人工貼prompt或搬patch。root是唯一整合者。子片可完成並回報，root必須消費結果、重算READY並續派。Goal API實際ACTIVE是continuation工具，不能作canonical/Host授權。

使用既有Codex send_message_to_thread/wait_threads、既有subagent接口、OpenCode原生CLI及可資格確認的Antigravity原生路線。沿用SDK/Git/作業系統；不新增mailbox bus、agent database、第二dispatcher、審批AI或泛用gateway。每個worker有專用worktree與write-set；Git隔離不宣稱OS sandbox。

## 每次協調循環

2026-10-04 最新回收與 route ownership：舊 S-ADS 六檔 raw tree `07692db0bb56b699792c55402072c8757bf901ca` 已完成 root exact-byte packaging；worker patch 的兩個 CRLF normalization finding 保留，root package 不修改 source 語意。獨立下一片 `SADS-INTEGRATION-01` 由 root 直接管理既有 Antigravity conversation，在 `VNEXT5.2-SADS-INTEGRATION-WORK-20261004` 只改 monitor／新 integration test／outputs。Luna 不再管理該 Antigravity native permission profile 或重派該片，繼續 MCP／runtime／F01 source queue。實際模型以 init receipt 為準；舊段落的 Luna AG-coordination 描述為歷史，不再是當前派工權。沒有 provider quota 恢復證據，不重試 OpenCode 429；Muse model catalog active/cost0 不等 quota PASS。

1. fresh Directory→canonical pointer→checkpoint/Mission/Policy/run→unresolved effects→provider refs；分別報construction、canonical、installed。
2. 讀持久dispatch與worker實際狀態。在途task不重派；不以UI/thread消失推定完成。unknown effect先同來源readback。
3. 驗證結果write-set、base/tree/patch digest、local tests、exact structural與independent semantic各自範圍。
4. 有findings即派exact finding返工，保留完成的無關工作；不重新餵全部history。
5. 重算全59且檢查RUNNING、RETRY_BOUNDED、recovery工作；只缺一個route不能全域停止。
6. 容量允許即派最高優先且不衝突的READY，持久記錄task/thread/worktree/binding；有限結果回收或native wait，而非要求Human再貼指令。
7. source穩定才由整合者從fresh exactbase重建一commit。只push最終head一次、protected structural一次、獨立semantic綁exacthead；PASS後不得改source自綁。

## 最新狀態定位

2026-10-04 compact-index 規則：最新 manifest 只列當前決策投影與當前 review/route receipt，預計20檔，publication preflight 不得超過 consumer40檔資源上限。舊 attempt prompt、已關閉 route、原始 patch等保留 immutable sequence8 progress head `5f0afa8db7b981234370024359c6061c202d4f72` 及更早歷史，不刪歷史bytes，不以擴大reader限制掩蓋index無限增長。已驗證immutable snapshot可作歷史source/evidence身份；新locator變化要求更新current/freshfacts，不要求重做已完成source或逐一重驗未變的歷史payload。installed consumer/live acceptance仍獨立，不以root冷讀索引PASS代稱MCP已上線。

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
## 2026-10-04 00:17Z material delta / native continuation

F02 exact two-file source overlay `443278f6fe6ec65ed75dc99ddeb3b7e0cebaf76c` independently accepted with 198 local tests and findings01-05 closed; live N2/cell/controller capacity acceptance remains NOT_ACCEPTED. Read `reviews/runtime/f02-source-collection.json`. Old20-payload D03 stage verdict is historical and not portable to this new dependency closure; new F01 modules must be packaged and independently qualified before installation.

Luna turn `01a1043a-f591-7d00-805b-6c791c94848f` completed without P52 changes because it interprets its original S-MCP Human write-set as not expandable through cross-thread delegation. Actual model/effort read back gpt-6-luna/max. Do not keep resending the same declined task or claim it started. Root reassigned P52.OPENCODE_SOURCE to the existing locked Antigravity native conversation c9c18097-ff7b-49d4-812b-38879d53465a, with a dedicated exact42-inherited-file worktree. Read `routes/p52-opencode-source-attempt1/attempt1.intent.json` before re-entry; native init confirms gemini-3.8-flash-high. This builder assignment does not invoke OpenCode live provider, which remains quota-parked; no account/model/cost fallback.

Root continues exact source collection -> independent review/rework -> dependency packaging -> full59 recomputation. All native read denials listed in preceding recovery remain unperformed; no proxy/rephrase. No Goal or Mission completion, CP200 unchanged, installed UNKNOWN, no dispatch/install/Production.

## 2026-10-04 00:00Z re-entry / source freeze

Latest provider locator sequence15 is `122ed33e5031a1342469d3358e41d4beb639b262`, immutable content `6f40a83f9732c1af7aa8b58ece03aa833565f026`, cold manifest40/40PASS. Fresh facts require renewal; unchanged exact source verdicts do not. Do not re-export/re-review frozen PR385 solely because progress locator changes. Source identity, coordination snapshot identity and live acceptance remain separate.

P52 Antigravity source exact two-file overlay tree `dadf1dad2408f4105a0c45502eabc3fb49d49fb0` is independently qualified: root175PASS, findings01-07 closed. F02 source is NOT accepted: review01 and05 residual capacity/dedup defects were delegated to same locked native conversation. Read `routes/f02-source-attempt5/attempt5.intent.json` and own native stream before any retry; do not redispatch a running/unknown attempt. Denied `Get-ChildItem -Path outputs\\F02-FLEET -Recurse` remains unperformed and must never be proxied/rephrased. Different authorized two-file source action proceeds without that diagnostic. Root only reads the allowed source files and its own native receipt stream.

Luna remains existing thread `01a0fd19-df99-7013-8a8b-eb952c647e3d`; queued root scope correction instructs it to preserve superseded PR381 drafts and proceed with P52.OPENCODE_SOURCE. Native thread activity alone is not proof this source task started. Root must consume its bounded receipt, check queued-message/current-turn state, and continue the assigned source work without Human copying. No duplicate task or model fallback. OpenCode live Muse quota remains parked independently of OpenCode adapter source.

Continue root fresh capture -> exact worker readback -> independent source review/rework -> full59 readiness -> next disjoint native dispatch. A heartbeat coordination return is not Goal/Mission completion; do not call update_goal complete or invent ACTIVE from usageLimited/paused. Installed/live/survival acceptance remains NOT_ACCEPTED and CP200 stays canonical.
# 13:18Z material re-entry update

Root role remains audit/plan/dispatch/collect/arbitrate only. Product source construction belongs to native workers. Source review is bound to raw bytes and actual Git tree separately; a claimed tree that cannot be resolved is unverified, never semantic PASS.

OpenCode MCP attempt3 ended with HTTP429 FreeUsageLimitError; fresh native Session readback shows failed/idle and no active jobs. Do not retry that provider or reset/buy credits. Preserve partial MCP bytes and pass remaining exact findings to the existing Luna thread, which has already received the queue. Queued source is READY, not falsely RUNNING.

Antigravity same-conversation attempt2 admitted exact command successfully and passed 17 tests with denied_actions=0. Its source copies/receipt still have exact-byte findings. Read reviews/ads/collection.json and the actual worker paths: VNEXT5.2-S-ADS-ANTIGRAVITY-WORK-20261003/outputs/S-ADS/attempt*/attempt*.intent.json. Luna coordinates minimal artifact rework without writing S-ADS product bytes. Do not redispatch while a native attempt is running or unknown.

Luna runtime 18 payloads and root 137 tests were collected, but installer dependency closure and resolvable Git tree need rework; reviews/runtime/repair-collection.json is not acceptance. After Antigravity rework admission, Luna should continue its disjoint runtime/MCP source queue while Antigravity works. Then F01 adapter source follows; source availability is independent of live MCP/SYSTEM/OS-cell qualification.

Antigravity may continue C1.PREPARE after its artifact is stable: only read protected procedure and produce a nonselecting ownerless proposal under outputs/C1-PREPARE/**. No canonical pointer, trust-root, owner, lease, Production or live provider mutation. Root collects and arbitrates before candidate promotion or source publication.

The latest locator is a noncanonical construction index. It must distinguish construction VNEXT5.2, canonical CP200 VNEXT5.1-R2 and installed UNKNOWN. No App heartbeat or CLI source task proves reboot/UI-closed Supervisor survival.

