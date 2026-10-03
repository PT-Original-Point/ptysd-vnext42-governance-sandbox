# Ads→LINE 轉換追蹤恢復

MCP 的用途是讓 ChatGPT Web 觸達受控工具與讀回；轉換正確性是業務 pipeline 的證據，兩者不可混為一談。

原HANYAO血緣：Ads paid touch→immutable attribution→lead token／LINE handoff→signed LINE webhook→D1 business_conversion→唯一outbox／uploader→Data Manager→Ads reporting。GA4/browser點擊只診斷，不能升成 canonical verified LINE conversion；不得盲重送。

沿既有WP01／HG10做R1–R8漏斗診斷，優先D1與Ads日期readback、outbox／provider attempt狀態及reportinglag分類。沒有真事件時可查既有授權日期，不能編造真conversion或fakeupload驗收。

讀existing Human Mission／Policy證據，已允許google_ads_read_only、cloudflare_d1_read_only及Factory route。不要再要求Human批准同一read；核對exacttarget/account/custodian/caps即可。未找到credentialroute只park該read，不向worker散發serviceaccountJSON，不採集secret到報告。adwords scope本身不保證僅read，fixed query與methodguard仍必要。

Web route可用Factory受控舊runner作recovery fallback，但正常provider-native不依賴SYSTEM／gcloud。soleworkingroute未完成parity/readback不能退休。WIF可選，非前置；GTM publish、budget/bid/goal/campaign change、reingest與Production deploy不在本輪read修復裡。

驗收分：來源／localregression；真D1零write；真Adsboundedquery；DateVerdict＋usefulanalysis；WebMCP tools/list與target成功read。確切缺哪項就哪項pending，不用Factorystatus健康冒充全business恢復。
