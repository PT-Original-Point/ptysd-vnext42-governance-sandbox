# 跨 Session／Web 讀回

固定入口：GitHub repo PT-Original-Point/ptysd-vnext42-governance-sandbox，branch codex/vnext5.2-shared-construction-20261003-r2，path governance/csg/vnext5.2/construction/CURRENT.json。最初無 r2 的分支是舊格式相容性讀取 probe，尚未合格的歷史 artifact，不當最新入口。

新 consumer先 GET branch head，以 immutable SHA 讀該 path 和 architecture_path；獨立 fresh-read Directory→選定control→Mission/Policy/run/owner/effects。spec是目前要建的V5.2；canonical control依實際讀回可能仍V5.1-R2，不能混寫成一個version。

每個delta：已有合法durable receipt先寫→same-source readback→更新非選定成果索引→consumer重新讀→重算完整catalog。普通taskprogress使用runtime／現有receipt，不為每行Gitcommit加新checkpoint。正式Directorylocator更新與controlselection走原流程，static docs不能接管。

驗收：真新Session讀到A上一筆新receipt，找到next合法工作，不重做已完成；同時sessionB可read，重疊mutation stale-fence拒絕。CLI/connector/Web兩路read只能證consumerroute，不冒充所有新Session已接續。Apps/runtime authfreshness要實測，不讀auth.json／secret值到packet。

Goal active/null/paused按實際API；Human新的continue授權合法work，沒有resume API不改appDB／取消舊Goal。UI消失不等Mission成功，真正持續run需engine／OS資格化。

讀取器已核對兩個現有 digest profile：Factory CP200 是移除 payload_digest 欄後的 canonical JSON hash；HANYAO CP2 是原 provider UTF-8 bytes 的 hash，不 trim／補 newline，也不要求舊檔多出新欄位。其他未確認 profile 只標精確讀取問題，不假稱已驗證或增加全域拒絕。
