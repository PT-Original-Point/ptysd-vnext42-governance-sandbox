# READY 與退出 admission

## 每個操作的評估

按 operation-plan definitions，加 latest receipt/facts，不用taskstatus字符串替代。fact必须附 authority/evidence/ref/time/scope；每个operation的qualification只包含其真实effect需要的条件。

READY条件：当前Human/canonical scope涵盖operation effect；required startdeps适用于该操作且成立；工具available；该effect所需qualification/fence通过；无same-resourceunknown；prestate该fresh时fresh。缺失事实标UNKNOWN，允许继续采集其合法source/read/preflight。单lane不能传染全部。

fullinventory包括剩余required operations与已DONE的receipt identity，expected catalog digest。省略catalog、facts过期或scope未判明→READINESS_INCOMPLETE，不得globalexhaustion。

## Bootstrap qualification 不能自我依赖

qualification区分「开始这次受控验收所需的既有安全条件」与「这次操作要产出的最终证据」。F01 real task只需已经确认的exact canary authority、真实隔离边界、trusted existing route、resource bounds、cancel/rollback条件；不能先要求F01整项PASS才能启动F01验收。M04安装要existing trustedinstaller/caller与qualifiedincomingbundle，不先要求新版本alreadyinstalled；D04故障验收不先要求D04survival已PASS。

若sandbox/cell还未准备，使用F01.CELL_PREPARE这条受控bootstrap lane：只操作其exactowned/reversiblecanary target，existingroute/权限/fence不足则停该lane。不能把准备和未来完全验收混成一个权限boolean，也不能用「bootstrap」跳过真实containment/target/unknown-effect限制。

## 正常continue

每materialdelta后re-read必要authority/effect状态，unchangedevidence复用→重算→nextREADY。保存薄receipt即可，不把报告写作设成每步gate。优先unlockoperation，再fix/inflight/aging公平；没有合格并行能力就单executor交错做，不为并行等待。

受平台可见状态影响：ACTIVEGoal允许nativecontinuation；如果自动turn无工具实际工作，不能靠写「继续」假装推进。捕捉此事实、保存nextREADY，已有qualifiedruntime负责可支持的恢复；没有runtime时明记缺能力。

## 停止类别

| decision | 判据与处理 |
|---|---|
| CONTINUE | 至少一个legalREADY：执行，不能以batch完成final |
| OBSERVE_OWNED_INFLIGHT | 同一资源工作在途：读既有job/effect，不redispatch；其他ready继续 |
| WAIT_EXACT_LANE | 无新事实，该lanebounded策略已耗尽；保存解除条件，其他lane继续 |
| GLOBAL_EXHAUSTED | fullrequiredinventory齐全、factsfresh、allstatesreasoned、legal_ready_count=0；有durablereentry |
| HUMAN_PAUSE_CANCEL | 尊重当前Humanrequest；不会强行continue |
| PLATFORM_INTERRUPTED | 真平台/usage/budget限制；保存状态，不伪装GLOBAL或complete |
| MISSION_COMPLETE | mandatorycore适用已授权验收达标，canonicalselection/readback完成，未决requiredreview/live/effects为0 |

GLOBAL_EXHAUSTED只是此时无法前进，Mission保持其真实lifecycle；Goalblocked要另外符合actualtoolthreshold。不可用三个无意义命令/重跑证明达到三turn门槛。

## stop-decision.json（executor生成，不由这个包预填）

必须包含：decision、mission/currentidentity、catalogdigest、required_operation_ids、evaluatedunits（state/reason/evidencerefs/freshness/reentry）、legalreadyids、ownedinflight/effectrefs、actualGoalstate、platformreason如适用、nextvalidwakecondition。

缺fullinventory就拒绝globalstop证书；这不赋予shadow或validator派工权限。routineSTOP、unknown-effectreadbackfirst、wrongtargetdeny等仍有效。真实无ready时不要busyloop，按现有scheduler等待事件/必要freshness读；source批次无数扩张也不算进度。

## 与UI的接线

这个包不提供可劫持Codexfinal的hook。必须查actualapp-server/CLI/Goal支持的控制surface，在existingruntime对executor exit receipt做admission。可行时exitwithready→保存EXECUTOR_EXITED_WITH_READY→用qualifiedexistingroute恢复。该机制没installed/validated之前，把它列NOT_IMPLEMENTED，不宣称自动纠正已经生效。
