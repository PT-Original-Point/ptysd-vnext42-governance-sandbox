# VNEXT5.2 限額控制與優先復工施工契約

## Human 恢復與權威

Human 本輪已明確恢復施工，覆蓋先前暫停。原暫停receipt保留歷史。沿用完整V52-UNION59／59 operations／64 acceptance／PF30／PRG28，不縮減Mission。Construction=V5.2、Canonical=CP200/V5.1-R2、Installed=UNKNOWN分開。新施工規格不等於canonical升級。

Root/Sol只獨立稽核、計劃、派工、回收、返工與接受/拒絕，不寫產品source。日常source優先AG Gemini3.8FlashHigh及OpenCode MuseSpark1.3Free；Codex Luna GPT6/max只承接確需它的特定片，不作日常fallback。既有帳號、模型鎖定，不買credits、不使用reset、不換模型。

Goal真實API仍paused，API沒有resume/ACTIVE且不能建立第二未完成Goal。Human恢复已有效：保存WORK-RESUME，不偽造ACTIVE、不完成舊Goal；平台UI狀態不能停全部合法Mission工作。

## 優先施工DAG

| 優先 | 工作與實證 | 作者→審查 |
|---|---|---|
| P0-A | MCP shared context匿名403／route-local failure，cold-reader三欄、digest、freshness、最新progress | AG→OC fresh獨立review |
| P0-B | 回收AG已交OpenCode adapter attempt2，以實際2.0.22 schema檢查假429、outcome、fork、模型/身份與隔離自鎖 | OC review→外包返工→root仲裁 |
| P0-C | 最新規格、日誌、派工、immutable progress與CAS locator公開；真正新consumer讀回 | 原生Git/既有reader；外包cold-review |
| P0-D | MCP四工具／caller／Host／SYSTEM／Web consumer剩餘live路線，按owning phase資格；準備與live分開 | 不以未來install卡source；保留真正Human gate |
| P1 | intake→研究多選項→Human選擇→分片DAG→並行施工→跨作者review→合併測試返工→通知 | AG/OC交叉分工 |
| P2 | 真隔離/cancel/capacity、crash/reboot/UIclosed/24x7、全產品功能與安全故障矩陣 | 實際環境證據，不能拿local替代 |

MCP是Web到Host受控入口；本機source不需要先有MCP/SYSTEM/新owner/Goal/session或未來安裝。保持exact4publictools、factory_status只讀。保留STOP、exactProject/Host、timeout/output/concurrency、未知效果readback、CAS、same-source readback、Production/成本/身份/OAuth/MFA/重大不可逆trust Human gates及workerproviderwritecredentials=0。

## 限額與高效模式

- 本輪共享usage baseline：五小時19%、七日34%。不得將raw token直接換限額百分點。日常source100%優先AG/OC，Luna一般派工目標0。
- taskcard目標≤2k token，只帶outcome、exactbase/tree、write-set、完整finding矩陣、許可命令、副作用、receipt與下一項；history只給固定檔案引用。2–4不衝突unit一批。
- 原始events/log/bytes由原生CLI/SDK/Git保存；root只收摘要≤2k token、failure locator、digest與外部review。工具輸出目標1–3k字元，禁止把原始大payload穿LLM多輪搬運。
- 原30分鐘heartbeat改每4小時有界補償回收；在途nativejobs自行完成，不逐步陪跑。無material delta不重讀全context/unchangedsource、不重測、不探quota、不通知。
- 共享used≥70%削減Sol深度仲裁及日常Luna派工；≥85%只保存必要身份/未知效果/真gate，普通仲裁等reset，AG/OC合法工作繼續。這是分配throttle，不是Mission完成/global exhausted/停所有worker。
- root soft目標≤3批次仲裁/5小時，每批input≤12k/output≤2k。現有長history不能靠prompt立刻達成；以native telemetry量測，不宣稱平台硬限或已節省固定百分比。Human模型/effort不改。
- 第3次同類返工前補完整schema/invariant矩陣。相同輸入2次transient失敗先readback、park該lane、換READY；禁止無限樣例修補。

## OpenCode有效路線

Desktop正連線的既有官方服務；fresh server.info／Project catalog／active；專用新session或空白seed fork；明確opencode/muse-spark-1.3-contributor-free#xhigh；官方CLI封装現有認證。不另開serve、不導出密碼、provider直連、偽造header、--auto。

讀回info.model.id/providerID/variant、outcome=succeeded、fork.sessionID、cost0與exacttask/result。429只structurederror；bodyF429/line429不能cooldown。舊fledge真429不外推Muse。未知結果先讀回不盲重送。reviewer不可繼承被審builder施工context；session/worktree分離不是OSsandbox。

未接受的新adapter不作當前派工必要前置；已驗證官方CLI可先做有界外包，避免循環自鎖。source/local/structural/semantic/live/system逐層分開。

## 狀態恢復與續工

新Session讀provider locator→immutable CURRENT+manifest→hash→fresh Directory/current/Mission/Policy/checkpoint/run→nativeworkers→完整59 READY。facts過期不能派送；unchangedhistoricalsource verdict可沿用。provider進度只由root以fresh-prestate CAS發布；source SHA與promotion/self-binding分離。

每個material delta保存log、intent/result、exactbytes/tree/test/reviewscope與unknown effects。存在RUNNING/RETRY/recoverable不能宣告全域耗盡。只在全部Mission acceptance實證或Human終止才完成。

## 已啟動第一批

routes/resume-batch-20261004/oc.intent.json：Muse獨立回收AG OpenCode adapter，source只讀。ag.intent.json：AG新worktree修MCP shared-context transport及coldreader測試。write-set不衝突，原staged保留；派送不是完成，native實際模型與結果待回收。

官方參考：[pricing](https://learn.chatgpt.com/docs/pricing)、[scheduled tasks](https://learn.chatgpt.com/docs/automations?surface=app)。App排程不證明Supervisor關App/重開機存活。


## 實測後追加約束

最小接續入口為 routes/resume-batch-20261004/NEXT-ACTIONS.md 與 COMPACT-SUMMARY.json。SOL 每次最多2個紧凑回收/派工包，不循環讀history/source、不輪詢等worker；共享API19%→45%不是per-session帳單。native fork必須實際sessionID+export+fork.sessionID，parent舊verdict不可攜帶；SUCCESS/exit0+denials/空result不算完成。worker省略目錄/Git/hash shell前置，原生拒絕精確停放且不代理重讀。MCP新增依賴必須同步installer payload/repair manifest與測試；不讀被拒絕publisher。live mirrors/Host/caller/Web保持owning phase，不能反拉成只讀source循环gate，也不能稱mock已恢復live。ROOT不寫產品source，仍以指定AG/Muse施工，Luna日常0；原完整59/64/PF30/PRG28與Human gates保留。
