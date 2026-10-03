# 血緣與不可重犯

| 版本 | 經驗 | V5.2 留下／改掉 |
|---|---|---|
| V4.2 | Chat／Host／VM／provider 分層 | 保留隔離；Chat 不當 durable owner |
| V4.3 | SQLite race、lease≠process、resume≠adoption | 原子 claim、外部 job readback；不 hand-roll 通用恢復 |
| V4.4 | DBOS／Postgres whole-layer replacement | 候選整層替換，不疊多個 engine |
| V4.5–4.6 | Directory／trust／文件≠live | 精確 Project；protected flow；證據分級 |
| V4.7 | Task owner／Project integration writer／async fleet | one authority 不是只能一個 coding agent |
| V4.8 | glue complexity／DELETE_FIRST | 以原生協議、OS與成熟元件刪 maintained code |
| V4.9 | H01–H40／command-to-delivery／DR | 保留歷史反例，不降格成只跑單元測試 |
| V5.0-R3 | Directory／active_run／worklog／unknown effect 漂移 | 薄入口直接讀選定來源，不信舊 chat／worklog |
| V5.1-R2 | MCP self-lock／雙 writer／Goal誤結束／self-binding churn | transport與Projectadmission分離；lane gate；source與promotion分開 |
| V5.2 | 成熟元件替責任、provider-native、跨 Session | MCP／業務 P0；一個共用施工索引，沒有第二 execution authority |

原始 lineage audit 在 references，日期快照不是本輪 live。以上是設計血緣摘要，不宣稱全部版本功能已 installed PASS。

特別禁止：aggregate zero 被當 process death、把 read403當 absence、重播 UNKNOWN write、把 worktree當 sandbox、worker自報 PASS、shared NETWORK SERVICE作唯一 caller、provider API全繞SYSTEM、未來phase作目前source前置、每次新SHA重開整個loop。
