import { canonicalDigest } from "./provenance.mjs";
import {
  APPROVAL_STATUS,
  CRITERIA,
  ID_RE,
  HEX64_RE,
  isReservedId,
  checkClosed,
  validateRequestClosed,
  validateWeightsClosed,
  validateScoreEntryClosed,
  validateApprovalClosed,
  validateOptionClosed,
} from "./schemas.mjs";
import { checkStructuralDistinctness } from "./alternatives.mjs";

export const APPROVAL_REQUIRED = APPROVAL_STATUS;

export function validateRequestShape(r) {
  return validateRequestClosed(r);
}

export function normalizeWeights(w) {
  const r = validateWeightsClosed(w);
  if (!r.ok) return r;
  if (w === undefined)
    return { ok: true, weights: { evidenceStrength: 0.4, feasibility: 0.35, economy: 0.25 }, def: true };
  return { ok: true, weights: { evidenceStrength: w.evidenceStrength, feasibility: w.feasibility, economy: w.economy }, def: false };
}

function checkScoreEntry(entry, allowedEvidenceIds, label) {
  const base = validateScoreEntryClosed(entry, label);
  if (!base.ok) return base;
  const c = checkClosed(entry, ["score", "reason", "basisEvidenceIds"], label);
  if (!c.ok) return { ok: false, code: "E_UNDOCUMENTED_SCORE", message: c.message };
  for (const id of entry.basisEvidenceIds) {
    if (typeof id !== "string" || !ID_RE.test(id) || isReservedId(id))
      return { ok: false, code: "E_HALLUCINATED_EVIDENCE", message: "bad evidence id:" + label };
    if (!allowedEvidenceIds.has(id))
      return { ok: false, code: "E_HALLUCINATED_EVIDENCE", message: "unknown evidence:" + label + "->" + String(id) };
  }
  return { ok: true };
}

function newDigestMap() {
  return Object.create(null);
}

export function buildRecommendation({ request, options, scores, weights }) {
  const rq = validateRequestClosed(request);
  if (!rq.ok) return rq;
  if (!Array.isArray(options) || options.length < 3)
    return { ok: false, code: "E_NEED_3_OPTIONS", message: "at least 3 options" };
  for (const o of options) {
    const vr = validateOptionClosed(o);
    if (!vr.ok) return { ok: false, code: vr.code, message: vr.message + ":" + String(o?.optionId ?? "?") };
  }
  const seenOpt = new Set();
  for (const o of options) {
    if (seenOpt.has(o.optionId)) return { ok: false, code: "E_DUP", message: "dup optionId:" + o.optionId };
    seenOpt.add(o.optionId);
  }
  const dd = checkStructuralDistinctness(options);
  if (!dd.ok) return dd;
  const wres = normalizeWeights(weights);
  if (!wres.ok) return wres;
  const W = wres.weights;
  if (typeof scores !== "object" || scores === null || Array.isArray(scores))
    return { ok: false, code: "E_UNDOCUMENTED_SCORE", message: "scores required" };
  const optionIds = options.map((o) => o.optionId).sort();
  const scRoot = checkClosed(scores, optionIds, "scores");
  if (!scRoot.ok) return { ok: false, code: "E_UNDOCUMENTED_SCORE", message: scRoot.message };
  const scoreKeys = Object.keys(scores).sort();
  if (JSON.stringify(optionIds) !== JSON.stringify(scoreKeys))
    return { ok: false, code: "E_UNDOCUMENTED_SCORE", message: "scores keys must equal optionIds" };
  for (const id of optionIds) {
    if (!Object.hasOwn(scores, id))
      return { ok: false, code: "E_UNDOCUMENTED_SCORE", message: "scores missing own key:" + id };
  }
  const ranked = [];
  for (const o of options) {
    const s = scores[o.optionId];
    if (typeof s !== "object" || s === null || Array.isArray(s))
      return { ok: false, code: "E_UNDOCUMENTED_SCORE", message: "missing scores:" + o.optionId };
    const ck = checkClosed(s, [...CRITERIA], "scores." + o.optionId);
    if (!ck.ok) return { ok: false, code: "E_UNDOCUMENTED_SCORE", message: ck.message };
    const allowed = new Set(o.evidenceIds);
    const breakdown = {};
    let total = 0;
    for (const crit of CRITERIA) {
      if (!Object.hasOwn(s, crit))
        return { ok: false, code: "E_UNDOCUMENTED_SCORE", message: "missing criterion:" + o.optionId + "." + crit };
      const chk = checkScoreEntry(s[crit], allowed, o.optionId + "." + crit);
      if (!chk.ok) return chk;
      breakdown[crit] = { score: s[crit].score, reason: s[crit].reason, basisEvidenceIds: [...s[crit].basisEvidenceIds] };
      total += s[crit].score * W[crit];
    }
    total = Math.round(total * 1000) / 1000;
    ranked.push({ optionId: o.optionId, total, breakdown });
  }
  ranked.sort((a, b) => (b.total - a.total) || (a.optionId < b.optionId ? -1 : 1));
  const ranking = ranked.map((r, i) => ({ rank: i + 1, ...r }));
  const requestDigest = canonicalDigest(request);
  const optionDigests = newDigestMap();
  for (const o of options) {
    if (isReservedId(o.optionId)) return { ok: false, code: "E_RESERVED_ID", message: "reserved optionId:" + o.optionId };
    optionDigests[o.optionId] = canonicalDigest(o);
  }
  if (Object.keys(optionDigests).length < 3)
    return { ok: false, code: "E_NEED_3_OPTIONS", message: "at least 3 digests" };
  for (const id of optionIds) {
    if (!Object.hasOwn(optionDigests, id))
      return { ok: false, code: "E_APPROVAL_MISSING", message: "missing digest:" + id };
  }
  const recommendedOptionId = ranking[0].optionId;
  const approvalDigests = newDigestMap();
  Object.assign(approvalDigests, optionDigests);
  return {
    ok: true,
    recommendation: {
      requestDigest,
      optionDigests,
      weights: W,
      weightsDefaulted: wres.def,
      ranking,
      recommendedOptionId,
      rationale: "",
      approval: {
        status: APPROVAL_STATUS,
        automaticDispatch: false,
        requestDigest,
        optionDigests: approvalDigests,
      },
      isFixture: true,
      fixtureNote: "僅測試夾具，非實際研究；摘要僅綁定位元組，不證明人工身分；仍需人工選定。",
    },
  };
}

export function attachRationale(recommendation, text) {
  if (typeof text !== "string" || text.trim().length < 20 || text.length > 2000)
    return { ok: false, code: "E_LACK", message: "rationale 20..2000 required" };
  recommendation.rationale = text;
  return { ok: true };
}

export function verifyApproval(approval, a, b) {
  let expectedRequestDigest;
  let expectedOptionDigests;
  if (typeof a === "string") {
    expectedRequestDigest = a;
    expectedOptionDigests = b;
  } else if (typeof a === "object" && a !== null) {
    expectedRequestDigest = a.requestDigest;
    expectedOptionDigests = a.optionDigests;
  }
  if (typeof approval !== "object" || approval === null || Array.isArray(approval))
    return { ok: false, code: "E_FORGED_APPROVAL", message: "approval missing" };
  if ("humanSignature" in approval || "approved" in approval || "humanId" in approval || "signature" in approval)
    return { ok: false, code: "E_FORGED_APPROVAL", message: "forged human approval" };
  const closed = validateApprovalClosed(approval);
  if (!closed.ok) return closed;
  if (typeof expectedRequestDigest !== "string" || !HEX64_RE.test(expectedRequestDigest.toLowerCase()))
    return { ok: false, code: "E_APPROVAL_MALFORMED", message: "expected requestDigest malformed" };
  if (typeof expectedOptionDigests !== "object" || expectedOptionDigests === null || Array.isArray(expectedOptionDigests))
    return { ok: false, code: "E_APPROVAL_MALFORMED", message: "expected optionDigests malformed" };
  const expKeys = Object.keys(expectedOptionDigests);
  if (expKeys.length < 3)
    return { ok: false, code: "E_APPROVAL_MALFORMED", message: "expected at least 3 digests" };
  for (const k of expKeys) {
    if (!ID_RE.test(k) || isReservedId(k))
      return { ok: false, code: "E_APPROVAL_MALFORMED", message: "bad expected key:" + k };
  }
  const gotKeys = Object.keys(approval.optionDigests).sort();
  const expSorted = [...expKeys].sort();
  if (JSON.stringify(gotKeys) !== JSON.stringify(expSorted))
    return { ok: false, code: "E_APPROVAL_CONFLICT", message: "option set changed" };
  if (approval.requestDigest.toLowerCase() !== String(expectedRequestDigest).toLowerCase())
    return { ok: false, code: "E_REQUEST_TAMPER", message: "request bytes changed; approval stale" };
  for (const k of expSorted) {
    if (!Object.hasOwn(approval.optionDigests, k))
      return { ok: false, code: "E_APPROVAL_MISSING", message: "missing digest:" + k };
    if (!Object.hasOwn(expectedOptionDigests, k))
      return { ok: false, code: "E_APPROVAL_MALFORMED", message: "expected missing:" + k };
    const got = String(approval.optionDigests[k]).toLowerCase();
    const exp = String(expectedOptionDigests[k]).toLowerCase();
    if (!HEX64_RE.test(exp))
      return { ok: false, code: "E_APPROVAL_MALFORMED", message: "expected digest malformed:" + k };
    if (got !== exp)
      return { ok: false, code: "E_OPTION_TAMPER", message: "option bytes changed:" + k };
  }
  return { ok: true };
}
