# 跨 Session、compaction、executor exit 恢复

## 1. durable re-entry packet：薄投影

保存Mission/currentlocator与exactreadidentity、Humanadoptionreference、contractdigest、sourcepair/blobs、acceptedreceipts/fingerprints、ownedjobs/attempt/fence/effects、latestqueue/blockers、nextREADY、actualGoalstate、runtimeinstallation/healthreadback。只记录必要metadata与redactedreferences，不存workercredentials/rawbusinessrows。

re-entrypacket没有current指针权威，不含自生成自身SHA回绑。确定性jobfingerprint不包含sessionid/Goalstate/timestamp/ownoutputhead；external input/contract/genuinelogicalunit变化才产生新workidentity。

## 2. 新executor恢复顺序

```text
Directory → current → Mission/Policy/checkpoint/run/task/attempt/owner/effects
→ exactaccepted receipts + currentcapability/live observations
→ existingjobs/effects readback
→ compareinput identities, reusecompleted units, reconcileinflight
→ fulloperationREADY recomputation
→ nextlegalREADY within scope
```

不先信UIcache/localqueue。READBACKFIRST：effectUNKNOWN同资源先读回，不能新attempt/新sessionid就重派。worktree不是sandbox，sandboxqualification和thinadapter权限各自证明。

## 3. concurrency与所有权

每mutable slice一个validwriter，每Projectintegrationlane一个writer；canonicalclaim/backendfence防跨Session冲突。source离线不同slice可交错；不能要求所有旧process/orphan都证明消失才允许read/source。

ownerauthorityexpired、processUNKNOWN、activejobNONE_OBSERVED分别保存；后续reconciliation与dispatch分transaction。candidateownerless，realgeneration只按实际promotion/claimcontract、freshconsumedidentity与CAS分配；不burngen10为修候选。

## 4. 退出恢复

nativeGoalACTIVE及有remainingREADY：让supportedcontinuation继续；runtimeexitadmission已qualified时记录EXECUTOR_EXITED_WITH_READY并恢复，不标complete。

Goal不存在/不可resume：canonicalMission与acceptedwork不受影响；新session可创建自己的Goal，但不新claim同资源。没有nativecontinuation/installedruntime时据实记能力缺口，仍可source建置，不能宣称后台可用。

## 5. actual live acceptance

分别证明：newSession重建current+receipts且不repeatcompleted；executorcrash恢复；agentexit/cancel释放ownedcapacity；Supervisorcrashrestart；VM/Windowsreboot；UIclosed/GPTWebgone继续checkpoint/evidence；restore读取正确chain与provider效果。

任何recovery需要User重复搬运进度，记录R52-11/R52-24及REV2case未达标。不要自动跨chat发消息给他人；消息route遵守实际Human授权及工具限制，durableproviderread是恢复基线。
