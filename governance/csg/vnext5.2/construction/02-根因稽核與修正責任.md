# 根因稽核

## 已確認

- 本輪 GitHub control ref 仍 d39486601d851e31256852a24e9c1393b9046fe5，CP200／V5.1-R2；latest V5.2 files 原先主要在本機 ZIP，跨 Session 共用發布沒有完成。
- Directory 的 factory record 只帶 control／active_run_ref，沒有最新 V5.2 施工入口；Web 只讀它時不會自行得知本機契約修正。
- 多輪補丁改過施工順序：原本 F01／engine 先行，後來才提高 MCP／廣告。只有文字說「優先」而沒有統一 reader／排序及實際驗收，會讓舊 Session 繼續舊路線。
- HANYAO canonical Mission／Policy 已有 Human 授權日期限定 D1／Ads 零寫入讀回，checkpoint2 的 next business action 也是 fresh readback。新本地 A00 說整體 scope 未建立，不應直接當作原授權不存在；仍須驗 exact target、credential custodian、caps，不能假造 credential 可用。
- M01 source head 257318…已有一 commit direct parent CP200；PR381 ready-for-review。PR377 head491493…也一 commit，target main06da5…。這是 metadata，不是安裝成功。
- 目前 root Session tool catalog 沒暴露 Factory 四工具；只證此 Session route 不可直接呼叫，不能推論 Web 服務或原生本機能力不存在。

## 我方需要承擔的缺口

交付架構文件、保留 canonical，卻沒把「最新施工架構／進度」送進可被其他 consumer fresh-read 的固定入口。後續再用文件修文件，沒有完成 user-visible 同步閉環。上一版的 N1 優先也與業務先恢復的原始背景不夠一致。

背景足以理解設計演進；不足的是對現有實作、授權 readback、發布與 consumer 路線的落地確認。不能再請 Human 重貼所有歷史補這個缺口。

## 修復責任

整合者發布共用施工 artifact與 exact identity，保留兩種版本真相。Codex 接入 factory_status／Web既有閱讀面並修 transport false locks；OpenCode 接入 recovery/planner 並實測新 Session；Antigravity 恢復業務讀回、對帳與 scope reuse。Directory 發現流程的正式接入需按其 SINGLE_WRITER_GUARDED_CAS_NO_DUAL_WRITE，不能直接改權威 branch。

不透過修改 canonical 版本字串掩蓋未 cutover；亦不讓 protected control transition 把 public design／read-only source publication封死。

## 尚未完成

安裝 MCP、實際 Web tools/list＋fixed read、實際 Ads/D1 provider query、新 Session續工、gen5 control cutover與完整 runtime closure 都需真證據。不能靠 public branch 可讀宣稱以上全 PASS。
