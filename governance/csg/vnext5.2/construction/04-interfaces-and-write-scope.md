# 共同接口與寫入邊界

共用閱讀結果至少分開 human_requested_spec、architecture_revision、canonical_control_spec/checkpoint/source、installed_runtime_version/evidence、operations/receipt/effects source與freshness。缺資料是 UNKNOWN／精確fail，不用舊snapshot代填。

此包的 scripts/csg-read-shared-context.mjs 是 read-only reference reader：fixed GitHub GET、freeze branch SHA、讀 CURRENT 和 exact Directory／control；沒有新 DB、scheduler、權限授予或第五 MCP tool。Codex 將結果適度接入既有 fixed factory_status projection；OpenCode 在既有 admission/recovery 消費，無需第二份 READY queue。

CURRENT 的 role 是 Human施工意圖／reference index；canonical control lookup仍走原Directory與pointer，正式artifact選定與 owner allocation仍走 protected transaction。

三片 write sets 在 dispatch-plan.json，跨 repo各自整合。公共 interface／lockfile／CI／trustroot／Mission／Policy／canonical／Directory pointer只由整合者協調。不在分片內偷偷改rootpackage與workflow。receipt同層debug/generated files清乾淨。

工作結束回傳 result.json：task_id、project_id、exact base／source commit／tree、patch digest、changed_paths、tests、findings、actualsideeffects、unresolvedeffects、scopedblocker/re-entry、下一READY。Model/task退出0不是驗收，receipt signature不是實際語意正確。
