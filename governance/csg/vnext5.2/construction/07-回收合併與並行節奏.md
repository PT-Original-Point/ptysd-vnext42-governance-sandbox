# 回收與合併

## 回收資料

每 agent以outputs/<slice>/result.json＋candidate.patch或Git bundle＋SHA256＋source/test evidence交付。patch來自finalstablebytes，包含untracked新source；不要只exportcached漏掉未staged檔。原staged與workingtree不改寫。

先source identity/write-set/patchhash→獨立語意review→隔離integrationworktree apply→功能/安全/E2E→rework finding。兩repo不互相cherry-pick；sourcefinalfreeze後由整合者更新cross-source blob bindings與promotionpacket。historical evidence不追著newhead重建。

## Git紀律

普通工作可在isolatedworktree本地迭代；不推每commit，不跑protectedverifier於knownmulti-commitwrongparenthead。若原repo contract要求directparent，stablecandidate fresh-read exact targetbase→套finalbytes→onecommit→localmatrix→同PR force-with-lease一次→exactstructural／semantic。不在controlsourcePR混src/core.ts。

sourcepair與promotion分開，no self-binding churn。知識包publication本身不能作runtimepromotion或gen5revoke。

## 調度

三片source並行；在途真Host/provider mutation由scope與fence控制。sharedintegration1。設resourcecaps，不為湊三片N3超capacity。缺某brand／auth時換人工接手路線但不改模型／付費授權；先做其他READY。

每片出首個materialdelta即可回報索引並續做；整合者可先收sourcepatch，不等全部agents一次寫長報告。返工只發finding與exacttarget，避免重新餵所有history。

核心必驗：新Session讀最新架構及未完工作、no globaldeny fromtoolgap、read權限不被rollover封、unknown不replay、Ads／D1same-source、MCPcapability不退化、queue／helper／callerboundary、nativecancel／receipt、survival。

工程量衡量：首次業務資料可讀時間、MCPread成功率、false-block數、重複工作數、總返工/用量、netcustomLOC。沒有真證據不能標live/system/ProductionPASS。
