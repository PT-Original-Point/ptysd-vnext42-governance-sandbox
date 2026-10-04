# VNEXT5.2 施工可見性與即時回收修正契約

## 實際缺陷

原流程把四小時低頻全面稽核當作所有 worker 的回收時鐘。OpenCode Intake repair 在 2026-10-04 16:14:07（台灣時間）已完成，但 sequence19 snapshot 仍顯示在途。收據已寫入不代表 root 已收到事件，造成 completion → review → rework 的人為空窗。

## 已啟用流程

1. 沿用原 native CLI collector。每次 start 自動登記 exact intent 到 routes/progress-registry.json，最多24筆當前任務；超限先回收、封存 terminal項目，禁止悄悄覆蓋在途記錄。
2. routes/progress-observer.mjs 只讀固定 registry 中的本機 metadata，不讀產品source、history、secret、不調模型、不啟動或取消worker、不派工、不授權、不寫provider。以既有 intent 更新事件＋30秒保底刷新 PROGRESS.json/PROGRESS.html。
3. PROGRESS.html 每10秒重開本機投影，呈現 exact model、session、最後活動、RUNNING、COMPLETED_UNCOLLECTED、PERMISSION_PARKED、UNKNOWN_READBACK、root disposition。觀察器超過90秒未更新顯示過期；完成未回收超過10分鐘警示；20分鐘無native活動只要求readback，不能推定死亡或取消。
4. 唯一既有 automation vnext5-2 已改為5分鐘有界回收。第一步只讀看板小摘要；無可行動變化即結束該次巡檢，不結束Mission、不重讀source。完整authority read与59-unit READY只在material delta做；完整契約稽核最多每4小時。排程與完成處理分離。
5. Root 收回 actual export/result、驗 bytes/write-set與evidence scope，寫 routes/progress-ack.json 的 exact signature＋仲裁disposition。ACK意味收回並決策，不意味source、live或Mission驗收。完成marker直到ACK前持續可見，不靠短暫delta旗標。
6. 有在途／未回收工作維持5分鐘；沒有在途但有可恢復外部等待可退到30分鐘；僅Human reserved gate且無其他READY/RUNNING/RETRY/recovery才可4小時。使用 automation_update 實際修改並讀回，不只寫文件。共享額度70%/85%按既定15/30分鐘節流；不宣稱零token巡檢或hard cap。
7. 人類打開 PROGRESS.html 或讀 PROGRESS.json 即可查狀態，無須貼worker輸出給root。未啟动品牌／缺失實讀模型／成本使用UNKNOWN；Luna日常0不能展示為正在施工。

## 具體回收結果

- Intake原生Muse/xhigh export：succeeded、cost0，7份結果hash讀回一致。作者claim24 total＝23 pass＋1 skip，Windows file-symlink EPERM skip，不能寫24/24PASS。
- 已立即交給 distinct AG Gemini3.8FlashHigh 精確審查。原生回報 denied_actions=[read_file/ViewFile]、空response、exit0/SUCCESS；審查NOT_ACCEPTED，精確review lane停放。provider未提供具體被拒檔案，不能猜測目標或用另一工具/品牌代讀同操作。重新進入條件：原生路線提供明確合法review讀取能力，或Human解決該exact permission。其他合法lane仍續做。
- MCP new6＋27fixture scoped review通過不等於full legacy/installed/Web/live；D02 ACCEPT_SHADOW_ONLY不等於24x7、UIclosed或reboot證據。

## 已知能力邊界

桌面目前沒有支持外部CLI完成事件直接喚醒SOL的native trigger；observer不是root喚醒API。當前確切能力是30秒內本機可見＋5分鐘schedule回收目標，不是保證5分鐘內仲裁完成。主機睡眠、App关闭、服務/額度阻塞仍可能延遲。通知策略只在material delta/failure/Human gate通知，無變更安靜。App scheduled notification可能受OS設定影響。

這是既有collector的唯讀投影，不建立第二agentbus/dispatcher，不恢復provider-write workercredentials。產品级Supervisor關App/重啟自動恢復另屬D04驗收，不把這個projection進程稱成PASS。

## 權威保持

施工VNEXT5.2／canonicalCP200 VNEXT5.1-R2／installedUNKNOWN三欄保持。Root實際Goal paused不偽ACTIVE、不建重複Goal。STOP、exacttarget、bounds、timeout、concurrency、unknown-effect readback、CAS/same-source、Production、成本、身份/OAuth/MFA與不可逆trust gates保持。任一局部來源、測試或看板marker不得結束Mission。

官方能力參考：https://learn.chatgpt.com/docs/automations?surface=app
