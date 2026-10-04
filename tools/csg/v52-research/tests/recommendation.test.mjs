import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRecommendation, attachRationale, verifyApproval, normalizeWeights } from "../src/recommendation.mjs";

const request = { project: "P52", requestId: "req-001", goal: "比較三種快取策略", createdAt: "2026-09-01T00:00:00.000Z" };
function mkOpt(id, eid) {
  return { optionId: id, title: "方案" + id + "：邊緣快取架構路徑測試", description: "方案 " + id + " 的完整說明，涵蓋範圍與步驟，長度足夠充足。", approach: "作法" + id + "：邊緣節點快取的技術路徑與部署方式測試版。", evidenceIds: [eid], tradeoffs: "取捨說明：" + id + " 的優點與代價對比，明確列出充足。", uncertainties: "不確定性說明：" + id + " 的未知因素與風險假設充足。", distinction: { dimension: "維度" + id, difference: "差異說明" + id + "：決策槓桿與變更範圍明確不同，長度足夠。" } };
}
function opts() {
  return [mkOpt("op-001", "ev-001"), mkOpt("op-002", "ev-002"), mkOpt("op-003", "ev-003")];
}
function scores() {
  const mk = (ev, base) => ({
    evidenceStrength: { score: base, reason: "證據直接支撐，理由充分說明。", basisEvidenceIds: [ev] },
    feasibility: { score: base - 1, reason: "可行性評估已附理由與依據。", basisEvidenceIds: [ev] },
    economy: { score: base - 2, reason: "經濟性評估已附理由與依據。", basisEvidenceIds: [ev] },
  });
  return { "op-001": mk("ev-001", 9), "op-002": mk("ev-002", 7), "op-003": mk("ev-003", 5) };
}
const weights = { evidenceStrength: 0.5, feasibility: 0.3, economy: 0.2 };

describe("recommendation positive", () => {
  it("ranks with user weights and requires human approval", () => {
    const r = buildRecommendation({ request, options: opts(), scores: scores(), weights });
    assert.equal(r.ok, true);
    assert.equal(r.recommendation.ranking[0].optionId, "op-001");
    assert.equal(r.recommendation.approval.status, "HUMAN_SELECTION_REQUIRED");
    assert.equal(r.recommendation.approval.automaticDispatch, false);
    assert.equal(r.recommendation.isFixture, true);
    assert.match(r.recommendation.approval.requestDigest, /^[0-9a-f]{64}$/);
    assert.equal(Object.keys(r.recommendation.approval.optionDigests).length, 3);
    assert.ok(Object.hasOwn(r.recommendation.approval.optionDigests, "op-001"));
  });
  it("defaults weights when absent", () => {
    const r = buildRecommendation({ request, options: opts(), scores: scores(), weights: undefined });
    assert.equal(r.ok, true);
    assert.equal(r.recommendation.weightsDefaulted, true);
  });
  it("attaches rationale", () => {
    const r = buildRecommendation({ request, options: opts(), scores: scores(), weights });
    const a = attachRationale(r.recommendation, "基於三項夾具證據與用戶權重，op-001 證據強度最高，故推薦，仍需人工核准。");
    assert.equal(a.ok, true);
  });
  it("verifies bound approval", () => {
    const r = buildRecommendation({ request, options: opts(), scores: scores(), weights });
    const v = verifyApproval(r.recommendation.approval, { requestDigest: r.recommendation.requestDigest, optionDigests: r.recommendation.optionDigests });
    assert.equal(v.ok, true);
  });
});

describe("recommendation fail-closed", () => {
  it("rejects undocumented score", () => {
    const s = scores(); s["op-001"].evidenceStrength.reason = "";
    const r = buildRecommendation({ request, options: opts(), scores: s, weights });
    assert.equal(r.ok, false); assert.equal(r.code, "E_UNDOCUMENTED_SCORE");
  });
  it("rejects hallucinated evidence", () => {
    const s = scores(); s["op-002"].feasibility.basisEvidenceIds = ["ev-999"];
    const r = buildRecommendation({ request, options: opts(), scores: s, weights });
    assert.equal(r.ok, false); assert.equal(r.code, "E_HALLUCINATED_EVIDENCE");
  });
  it("rejects bad weights sum", () => {
    const w = normalizeWeights({ evidenceStrength: 0.5, feasibility: 0.5, economy: 0.5 });
    assert.equal(w.ok, false); assert.equal(w.code, "E_WEIGHTS");
  });
  it("rejects extra weights prop", () => {
    const w = normalizeWeights({ evidenceStrength: 0.5, feasibility: 0.3, economy: 0.2, extra: 0 });
    assert.equal(w.ok, false);
  });
  it("rejects direct builder extra option key", () => {
    const oo = opts(); oo[0] = { ...oo[0], extra: 1 };
    const r = buildRecommendation({ request, options: oo, scores: scores(), weights });
    assert.equal(r.ok, false);
  });
  it("rejects reserved __proto__ optionId", () => {
    const oo = opts(); oo[0] = { ...oo[0], optionId: "__proto__" };
    const s = scores(); s["__proto__"] = s["op-001"]; delete s["op-001"];
    const r = buildRecommendation({ request, options: oo, scores: s, weights });
    assert.equal(r.ok, false);
  });
  it("rejects forged approval", () => {
    const r = buildRecommendation({ request, options: opts(), scores: scores(), weights });
    const forged = { ...r.recommendation.approval, status: "APPROVED", automaticDispatch: true, humanSignature: "x" };
    const v = verifyApproval(forged, { requestDigest: r.recommendation.requestDigest, optionDigests: r.recommendation.optionDigests });
    assert.equal(v.ok, false); assert.equal(v.code, "E_FORGED_APPROVAL");
  });
  it("rejects missing digests", () => {
    const v = verifyApproval({ status: "HUMAN_SELECTION_REQUIRED", automaticDispatch: false }, { requestDigest: "a".repeat(64), optionDigests: { "op-001": "b".repeat(64) } });
    assert.equal(v.ok, false);
  });
  it("rejects empty digest set", () => {
    const v = verifyApproval({ status: "HUMAN_SELECTION_REQUIRED", automaticDispatch: false, requestDigest: "a".repeat(64), optionDigests: {} }, { requestDigest: "a".repeat(64), optionDigests: {} });
    assert.equal(v.ok, false);
  });
  it("rejects malformed digest", () => {
    const r = buildRecommendation({ request, options: opts(), scores: scores(), weights });
    const bad = { ...r.recommendation.approval, requestDigest: "not-hex" };
    const v = verifyApproval(bad, { requestDigest: r.recommendation.requestDigest, optionDigests: r.recommendation.optionDigests });
    assert.equal(v.ok, false); assert.equal(v.code, "E_APPROVAL_MALFORMED");
  });
  it("rejects request tamper", () => {
    const r = buildRecommendation({ request, options: opts(), scores: scores(), weights });
    const v = verifyApproval(r.recommendation.approval, { requestDigest: "0".repeat(64), optionDigests: r.recommendation.optionDigests });
    assert.equal(v.ok, false); assert.equal(v.code, "E_REQUEST_TAMPER");
  });
  it("rejects option tamper", () => {
    const r = buildRecommendation({ request, options: opts(), scores: scores(), weights });
    const exp = { requestDigest: r.recommendation.requestDigest, optionDigests: { ...r.recommendation.optionDigests, "op-001": "0".repeat(64) } };
    const v = verifyApproval(r.recommendation.approval, exp);
    assert.equal(v.ok, false); assert.equal(v.code, "E_OPTION_TAMPER");
  });
  it("rejects conflicting option set", () => {
    const r = buildRecommendation({ request, options: opts(), scores: scores(), weights });
    const exp = { requestDigest: r.recommendation.requestDigest, optionDigests: { "op-001": r.recommendation.optionDigests["op-001"] } };
    const v = verifyApproval(r.recommendation.approval, exp);
    assert.equal(v.ok, false);
  });
});
