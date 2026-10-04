# P52 研究備選／推薦模組（隔離製備切片）

> 候選預備來源，非整合／驗收。僅測試夾具，非實際研究；即時模式一律拒絕。
> 批准一律 `HUMAN_SELECTION_REQUIRED`，自動派工 `false`，批准內含請求摘要＋全部（≥3）選項摘要；摘要僅綁定位元組，不證明人工身分。
> 本切片不含選定／工作器運行時。後續整合仍被阻擋，須待 Intake 正式審查通過且新來源獨立審查。

## 範圍
- 讀寫僅限 `tools/csg/v52-research/**` 與 `outputs/P52-RESEARCH/**`。
- 僅 Node 標準函式庫，無依賴，不改根套件。
- 所有輸入 JSON 限 64KiB，`schemas.mjs` 為唯一欄位規格來源，全物件／巢狀封閉驗證，拒絕多餘屬性、含糊別名與保留字（`__proto__` 等）。
- 日期僅接受嚴格 UTC ISO（`YYYY-MM-DDTHH:mm:ss[.mmm]Z`＋曆法往返，含 0001–0099 年），`--now` 為確定性夾具時鐘（非實際可信觀測）；無歷史 TTL，僅拒未來與不安全時鐘值。
- 提供者為明確枚舉＋明確 `mode`（`fixture`／`live`），以 own-key 驗證，未知（含繼承鍵）穩定錯誤；夾具不等於實際網路，內容含 benign 字不整體否決。
- 備選需結構性相異（文字、證據集合、決策維度鍵相異）＋`distinction` 結構證據；語義實質互異仍待原始人工選定審查，不虛構語義分類器。
- 摘要以 null-prototype／own-key 綁定全部選項；`buildRecommendation` 逐項驗證封閉 option。

## CLI
```sh
node tools/csg/v52-research/cli.mjs --request <p> --evidence <p> --options <p> --scores <p> [--weights <p>] --out <p> [--report <p>] --now ISO [--rationale TEXT]
```
- 嚴格旗標、路徑限工作區內（Windows 大小寫不敏感）、`--out` 與 `--report` 解析後必須相異，輸入／輸出逐層祖先 reparse 檢查（輸出先驗最近既存父層再建目錄），獨佔 `wx`，拒 symlink／junction／覆寫。
- 省略 `--weights` 時理由寫預設權重，不謊稱用戶權重。

## 測試
```sh
node --test tools/csg/v52-research/tests/*.test.mjs
```
僅夾具，不連網，不虛構研究／計費／來源 PASS。
