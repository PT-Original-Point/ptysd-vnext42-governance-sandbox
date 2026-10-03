# 上層仲裁與三施工代理分工

Human 2026-10-03最新明示：root不直接施工產品code，負責獨立audit、plan、dispatch、collection、rework/acceptance arbitration。自動取得worker結果，不要求Human搬運。

| 角色 | 工作片 | 寫入範圍 | 實際路線 |
|---|---|---|---|
| root | 稽核、切片、優先度、回收、仲裁 | 計劃/操作收據/索引；不產品code | 本thread與原生heartbeat |
| Codex Luna Max | S-RUNTIME-SEMANTIC-REPAIR；依READY續做Supervisor | 專用runtime worktree tools/csg/v51-supervisor/** | 既有thread 01a0fd19-df99-7013-8a8b-eb952c647e3d 已收到新派工且active |
| OpenCode | S-MCP-SEMANTIC-REPAIR；其後intake候選接手 | 專用MCP worktree tools/csg/factory-mcp/** | 真Session ses_efe606f6cffeBxLiIedexWKrH5 已提交；沿用free model |
| Antigravity | S-ADS與廣告日期範圍唯讀recovery | S-ADS隔離worktree既定6 paths | CLI尚缺，bootstrap由OpenCode原生Session ses_efe5a0099ffeieQJn8IEJ3t8lq施工準備；不能宣稱Antigravity已啟動 |

bootstrap只安裝Google官方user CLI與資格確認；沿用native keyring，無credentials extraction、無API key/付費fallback。需要OAuth/MFA時精確park身份操作並繼續其他施工，不能偽造登入或讓Human搬完整工程包。

原root修改過intake的候選變更保留，交施工代理接手；original OpenCode raw receipt以及root新14tests/hash evidence各自保留，尚未final exact semantic acceptance。

回收流程：native worker status→exact result/source tree/patch/write-set→root獨立稽核→finding返工或接受source lane→本輪優先READY→自動再派。root不以自己補code再自己review取代獨立施工。Final merge/live/system acceptance各有對應證據。

Mission未完成；CP200 canonical未動。使用者保留真正Production與身份/成本/重大不可逆gate；施工scope不追加perSession人工確認。
