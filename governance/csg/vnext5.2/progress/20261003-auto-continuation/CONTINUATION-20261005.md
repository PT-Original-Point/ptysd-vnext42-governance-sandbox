# VNEXT5.2 接續分工與回收補充契約

本檔是既有 59 operations／64 acceptance／15 REV2 regressions／PF30／PRG28 的施工補充，不改 canonical，也不縮減原驗收。

## 目前實際分工

- SOL：獨立稽核、綁定成果位元組、一次彙整全部 finding、派返工、接受或拒絕。不施工產品原始碼。
- Luna Max：已派新選案／分片模組的獨立本機測試資格檢查。模型要求固定 gpt-6-luna／max；原生子代理未提供 actual model 時明記 UNVERIFIED。
- Antigravity：已從原生 Gemini 3.8 Flash High 啟動看板「仍工作卻顯示未知」的精確源碼修復。只改隔離候選，不碰正在更新看板的程序或鎖。
- OpenCode：仍只在有明確任務且原生路線可用時，以鎖定 Muse Spark 1.3 Free 逐件派送。未啟動不能稱為工作中；額度可用不由模型目錄推定。

兩件目前任務皆由 CURRENT.latest_native_intents 尋址。原始 author／review／native receipts 保留，已回收項目依精確結果 digest 和 ACK 歸檔，不以「作者說完成」視作驗收。

## 必須接續的動作

效率修正：新增純本地模組採「來源修復 → 本機正向／負向測試與完整 log → 穩定 exact bytes → 不同作者語義審查 → Root 仲裁」，不先對尚未能通過正向測試的候選連做多輪昂貴語義審查。失敗輸出先落盤再摘摘要，禁止只有被工具截斷的全文。新的明確純本地測試可授權給原生施工者；這不解除曾被拒絕的精確路線。只在 bytes／fixtures 有實質修正後重跑；原生拒絕不能換工具或代理重試。

本輪完整測試實際 111 項／47 通過／64 失敗／0 跳過，所有失敗已整批派返工。看板新候選另有 5 項獨立審查 finding，亦已整批返工。兩片 write-set 分開，active observer 未替換。判定前不得稱 source／live 接受。

1. Luna 實測結果有失敗：一次交全部具體 failure 與定位給原 Antigravity 作者；只返工相應兩個新模組和測試，禁止開新全量施工。
2. Luna 實測無失敗：凍結本輪精確來源，仍需來源資格與整合範圍逐一對應；不稱已完成 live、Fleet、隔離執行或 Mission。
3. 看板作者交付後：回收實際 write-set、來源／測試雜湊、模型／conversation 與 denied actions，派不同作者獨立審查及純本機 fixture 執行。全部通過才授權替換同一觀察器，做原程序 readback／安全交接；不得另開第二個 bus 或 watcher。
4. 每次接受、拒絕或返工後，重算完整 59 個 operations 的 READY／RUNNING／RETRY／recoverable，派最高優先、不重疊 write-set 的合法工作。局部 source PASS 或某品牌等待，不是全域停工理由。
5. 最終 stable source 才做一個 direct-parent commit、一次 exact-head structural verifier；source bytes 有變就不能沿用舊 verdict。已凍結 PR385／386／388 無新缺陷不重跑。

## 不重讀、不空輪詢

看板每 30 秒讀本機有界 metadata，不呼叫模型。保底回收維持 30 分鐘；原生 Luna 子代理完成通知可立即回收，但外部 CLI 完成可直接喚醒 SOL 尚未證實，不宣稱全品牌即時互通或關 App／重開機存活。

只讀當前 exact intent／result／binding；無變化不讀歷史全文、不輪詢模型、不把同一在途工作重派。先讀 unknown-effect，同一拒絕不換工具／branch／副本／代理繞過。純新任務不承接無關的拒絕，也不強加未來 Host／MCP gate。

2026-10-04T20:21:25Z 真實帳戶讀回：五小時用量 45%，週用量 78%。舊 88% 不可作為本輪門檻依據；共享帳戶用量不是 per-session 帳單，不保證 hard token cap。未購入 credits 或使用 reset。

## 狀態與驗收

施工 V5.2、canonical CP200／V5.1-R2、installed UNKNOWN 三欄分開。真實本地 Goal paused，不造 ACTIVE 或重複 Goal；依法續派施工不以 UI Goal 狀態作 Project authority。

保留 STOP、精確 Project／Host、timeout、bounds、concurrency、CAS、same-source readback、未知效果先確認，以及 Production／成本／OAuth／MFA／重大不可逆 trust 的 Human gate。無新 worker provider-write credentials、owner generation 或 lease，無 revoke／Host dispatch／install／Production。

只有整體 Mission acceptance 證實或 Human 明確終止，才能說完成。真正全域 blocker 必須有完整 catalog、fresh facts、沒有 running／retry／recoverable lane 的逐項證據。各 lane 的 blocked 起因、解鎖條件與責任人要寫清楚；「本工廠沒有派工」不能取代規格驗收。

## 本輪已確認缺陷與接續規則

- 2026-10-04T21:23:27Z 帳戶實讀五小時 81%、週 84%；此讀回取代早先 45%。SOL 收斂為有界收件與必要仲裁，外部合法來源施工繼續。不得把帳戶變化推算為單一模型或 Session 的帳單。
- 測試必須保存完整 stdout/stderr，再讀 exit、執行數、失敗案例。原 111 項實跑 47 成功／64 失敗；修來源後不能攜帶舊結果。陣列合法的 length 不得誤拒，但非標準索引、稀疏陣列、自訂原型、存取器、過深結構仍需精確拒絕。
- Root 先前直接啟動只有 export 的 fixture，得到退出 0／執行 0；不算通過。Antigravity 修入口與假程序狀態注入後，交 Luna 獨立確認並實跑。設計 52 案例、37 區段與實際 assertion 數分開記錄。
- 新研究測試的原生 command denial 只停該命令；禁止用其他代理、包裝器、權限模式重新執行。來源修正與原專案檔案靜態審查可繼續，不宣稱執行通過。
- OpenCode 本次已實讀原專案八檔，實際 Muse Spark Free/xhigh、成本 0；指出八項來源 finding。外部 optional 附件不是來源審查前提，被拒附件不複製、不代理讀。Root 比對原檔 bytes；不能借用舊 Session verdict。
- 只提取 native event 的輸入路徑、完成狀態、message ID、最終小型 verdict；不把工具輸出的整份來源檔印到 SOL 上下文。原完整紀錄留在磁碟。
- 每批收件立即交全部具體 finding 返工或派下一個独立資格檢查。看板顯示「已交件，等待檢查」而非「沒工作」；只有原生執行確認才能顯示施工中。仍未證明外部 CLI 完成能立即喚醒 Root；保留免模型 30 秒看板與額度節流回收，不作即時、關 App 或重開機存活承諾。

## 2026-10-05 原生命令拒絕根因與續工修正
以「施工恢復與原生命令許可修正-20261005.md」及其 exact two-rule proposal 為本次新增契約。CLI 專用 API 缺失不等於本機 CLI 不可用；監控代理 actual 同 conversation 派送已證明。15 條舊原生命令允許規則未包含兩個目前測試命令；沒有新規則或原生 re-entry 授權不得重复拒絕動作。精確缺規則僅診斷，不自製比原生 matcher 更強的全域 veto；只有已確認而未改變的同一拒絕停該命令。file-only source lane、既有成果與完整59/64/PF30/PRG28保留。正常 Node 子程序不得全部禁止。
A00 source receipt 已存在；已更正舊「未收到」理由，live admitted scope/既有憑證讀路線仍未接受。未完成phase不是自動成立Human-reserved gate。歷史交接程式不建立ghost Luna、不改舊intent、不把PREPARED算RUNNING。收據準確ACK後才回收與續派；不可把空SUCCESS、無測試輸出或inert提案當PASS。
最新共享quota實讀25%五小時、91%週（2026-10-05 00:51:11 UTC），不是本Session帳單；無reset/paid fallback。原生許可修正等待Human精確核准，不能冒稱已套用。30秒metadata看板不叫模型；沒有新evidence不反覆喚醒Luna/SOL。保留CP200canonical／V5.2construction／installedUNKNOWN、Goalpaused實讀與所有Production/成本/身份/不可逆trust保護。


## 原生兩條許可已執行的補正

先前等待精確許可的狀態由 Human 復工授權及實際17規則讀回取代。讀 `原生復工與返工銜接現況-20261005.md` 與最新 `CURRENT.latest_native_intents`；兩條測試拒絕為0，但其來源仍需返工／獨立審查，不升為live接受。禁止重做相同未變更的拒絕命令或要求人類搬運。


## 20261005 Human週稽核／低Token續工修正

遵循本機「低Token續工契約-20261005.md」：機械metadata先行、2個完整finding包、精確freeze例外、changedbytes最多2輪、原生route分別判定、免費Source優先、異作者immutable snapshot review、Root入口反例仲裁；不更改模型、canonical或Host權限。
