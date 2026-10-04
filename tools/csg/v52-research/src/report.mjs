export function buildReportZh({ request, evidences, options, recommendation }) {
  const L = [];
  L.push("# P52 研究備選與推薦報告（測試夾具）");
  L.push("");
  L.push("> 僅測試夾具，非實際研究；即時／實際網路不被接受。");
  L.push("> 批准狀態：HUMAN_SELECTION_REQUIRED；自動派工：false。摘要僅綁定位元組，不證明人工身分，仍需明確人工選定。");
  L.push("> 機器僅核對結構性相異（文字、證據集合、決策維度鍵相異）；語義實質互異仍待原始人工選定審查。");
  L.push("");
  L.push("## 1. 請求");
  L.push(`- 專案：${request.project}`);
  L.push(`- 請求編號：${request.requestId}`);
  L.push(`- 目標：${request.goal}`);
  L.push(`- 請求摘要：${recommendation.requestDigest}`);
  L.push("");
  L.push("## 2. 證據（已驗證夾具記錄）");
  for (const ev of evidences) {
    L.push(`- ${ev.evidenceId}｜提供者 ${ev.provider}｜模式 ${ev.mode}｜來源 ${ev.sourceRef}｜收集 ${ev.collectedAt}｜摘要 ${ev.contentDigest.slice(0, 12)}…`);
  }
  L.push("");
  L.push("## 3. 備選（至少三項，結構相異＋待人工確認）");
  for (const o of options) {
    L.push(`### ${o.optionId}：${o.title}`);
    L.push(`- 作法：${o.approach}`);
    L.push(`- 說明：${o.description}`);
    L.push(`- 證據：${o.evidenceIds.join("、")}`);
    L.push(`- 決策維度：${o.distinction.dimension}｜差異：${o.distinction.difference}`);
    L.push(`- 取捨：${o.tradeoffs}`);
    L.push(`- 不確定性：${o.uncertainties}`);
    L.push(`- 選項摘要：${recommendation.optionDigests[o.optionId]}`);
  }
  L.push("");
  L.push("## 4. 權重與排序（有據分數）");
  const w = recommendation.weights;
  L.push(`- 權重：證據強度 ${w.evidenceStrength}、可行性 ${w.feasibility}、經濟性 ${w.economy}${recommendation.weightsDefaulted ? "（預設權重，用戶未提供）" : "（用戶提供）"}`);
  for (const r of recommendation.ranking) {
    L.push(`- 第 ${r.rank} 名 ${r.optionId}：總分 ${r.total}`);
    for (const c of ["evidenceStrength", "feasibility", "economy"]) {
      const bb = r.breakdown[c];
      L.push(`  - ${c} ${bb.score}｜理據：${bb.reason}｜依據：${bb.basisEvidenceIds.join("、")}`);
    }
  }
  L.push("");
  L.push("## 5. 推薦選項");
  L.push(`- 推薦：${recommendation.recommendedOptionId}`);
  L.push(`- 理由：${recommendation.rationale || "（待人工補充理由，本模組不自動派工）"}`);
  L.push("");
  L.push("## 6. 人工核准");
  L.push("- 狀態：HUMAN_SELECTION_REQUIRED，需明確人工選定。");
  L.push("- 本切片不含選定／工作器運行時，不自動派工。");
  L.push("- 後續整合仍被阻擋，須待 Intake 正式審查通過且新來源獨立審查。");
  return L.join("\n") + "\n";
}
