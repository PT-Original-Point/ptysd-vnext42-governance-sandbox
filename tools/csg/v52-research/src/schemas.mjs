import { MAX_JSON_BYTES, MAX_TEXT_LEN, parseStrictUtcMs } from "./provenance.mjs";

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const HEX64_RE = /^[0-9a-f]{64}$/;
export const RESERVED_IDS = Object.freeze(["__proto__", "constructor", "prototype"]);

export function isReservedId(id) {
  return id === "__proto__" || id === "constructor" || id === "prototype";
}

const _pt = Object.create(null);
_pt["native-agent-fixture"] = "fixture";
_pt["native-browser-fixture"] = "fixture";
_pt["test-fixture"] = "fixture";
_pt["native-agent-live"] = "live";
_pt["native-browser-live"] = "live";
export const PROVIDER_TABLE = Object.freeze(_pt);
export const FIXTURE_PROVIDERS = Object.freeze([
  "native-agent-fixture",
  "native-browser-fixture",
  "test-fixture",
]);
export const MODES = Object.freeze(["fixture", "live"]);
export const APPROVAL_STATUS = "HUMAN_SELECTION_REQUIRED";
export const CRITERIA = Object.freeze(["evidenceStrength", "feasibility", "economy"]);

export const REQUEST_KEYS = Object.freeze(["project", "requestId", "goal", "createdAt"]);
export const EVIDENCE_KEYS = Object.freeze([
  "evidenceId",
  "provider",
  "mode",
  "isFixture",
  "targetProject",
  "targetRequestId",
  "collectedAt",
  "contentText",
  "contentDigest",
  "sourceRef",
]);
export const OPTION_KEYS = Object.freeze([
  "optionId",
  "title",
  "description",
  "approach",
  "evidenceIds",
  "tradeoffs",
  "uncertainties",
  "distinction",
]);
export const DISTINCTION_KEYS = Object.freeze(["dimension", "difference"]);
export const WEIGHTS_KEYS = Object.freeze(["evidenceStrength", "feasibility", "economy"]);
export const SCORE_ENTRY_KEYS = Object.freeze(["score", "reason", "basisEvidenceIds"]);
export const APPROVAL_KEYS = Object.freeze(["status", "automaticDispatch", "requestDigest", "optionDigests"]);

function normAlias(s) {
  return String(s).toLowerCase().replace(/[_-]+/g, "");
}

export function checkClosed(obj, allowedKeys, label) {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj))
    return { ok: false, code: "E_SHAPE", message: label + " must be object" };
  const proto = Object.getPrototypeOf(obj);
  if (proto !== null && proto !== Object.prototype)
    return { ok: false, code: "E_SHAPE", message: label + " must be plain data object" };
  const allowed = new Set(allowedKeys);
  const lowerMap = new Map();
  for (const k of allowedKeys) lowerMap.set(normAlias(k), k);
  for (const k of Reflect.ownKeys(obj)) {
    if (typeof k !== "string")
      return { ok: false, code: "E_EXTRA_PROP", message: label + " extra non-string key" };
    if (allowed.has(k)) continue;
    const hit = lowerMap.get(normAlias(k));
    if (hit !== undefined)
      return { ok: false, code: "E_ALIAS", message: label + " ambiguous alias:" + k };
    return { ok: false, code: "E_EXTRA_PROP", message: label + " extra prop:" + k };
  }
  return { ok: true };
}

function isNonEmptyString(v, min, max) {
  return typeof v === "string" && v.trim().length >= min && v.length <= max;
}

export function validateRequestClosed(r) {
  const c = checkClosed(r, REQUEST_KEYS, "request");
  if (!c.ok) return c;
  for (const k of REQUEST_KEYS) {
    if (!Object.hasOwn(r, k)) return { ok: false, code: "E_LACK", message: "missing:" + k };
  }
  if (!isNonEmptyString(r.project, 1, 128))
    return { ok: false, code: "E_SHAPE", message: "bad project" };
  if (typeof r.requestId !== "string" || !ID_RE.test(r.requestId) || isReservedId(r.requestId))
    return { ok: false, code: "E_SHAPE", message: "bad requestId" };
  if (!isNonEmptyString(r.goal, 4, 2000))
    return { ok: false, code: "E_SHAPE", message: "bad goal" };
  if (typeof r.createdAt !== "string" || parseStrictUtcMs(r.createdAt) === null)
    return { ok: false, code: "E_DATE_INVALID", message: "bad createdAt" };
  return { ok: true };
}

export function validateEvidenceClosed(ev) {
  const c = checkClosed(ev, EVIDENCE_KEYS, "evidence");
  if (!c.ok) return c;
  for (const k of EVIDENCE_KEYS) {
    if (!Object.hasOwn(ev, k)) return { ok: false, code: "E_LACK", message: "missing:" + k };
  }
  if (typeof ev.evidenceId !== "string" || !ID_RE.test(ev.evidenceId) || isReservedId(ev.evidenceId))
    return { ok: false, code: "E_SHAPE", message: "bad evidenceId" };
  if (typeof ev.provider !== "string")
    return { ok: false, code: "E_SHAPE", message: "bad provider" };
  if (!Object.hasOwn(PROVIDER_TABLE, ev.provider))
    return { ok: false, code: "E_PROVIDER_UNKNOWN", message: "unknown provider" };
  if (typeof ev.mode !== "string" || !MODES.includes(ev.mode))
    return { ok: false, code: "E_MODE", message: "bad mode" };
  if (PROVIDER_TABLE[ev.provider] !== ev.mode)
    return { ok: false, code: "E_MODE_MISMATCH", message: "provider/mode mismatch" };
  if (typeof ev.isFixture !== "boolean")
    return { ok: false, code: "E_SHAPE", message: "bad isFixture" };
  if (ev.isFixture !== (ev.mode === "fixture"))
    return { ok: false, code: "E_FIXTURE_MISMATCH", message: "isFixture/mode mismatch" };
  if (!isNonEmptyString(ev.targetProject, 1, 128))
    return { ok: false, code: "E_SHAPE", message: "bad targetProject" };
  if (typeof ev.targetRequestId !== "string" || !ID_RE.test(ev.targetRequestId) || isReservedId(ev.targetRequestId))
    return { ok: false, code: "E_SHAPE", message: "bad targetRequestId" };
  if (typeof ev.collectedAt !== "string" || parseStrictUtcMs(ev.collectedAt) === null)
    return { ok: false, code: "E_DATE_INVALID", message: "bad collectedAt" };
  if (typeof ev.contentText !== "string" || ev.contentText.length < 1 || ev.contentText.length > MAX_TEXT_LEN)
    return { ok: false, code: "E_LACK", message: "bad contentText" };
  if (typeof ev.contentDigest !== "string" || !HEX64_RE.test(ev.contentDigest.toLowerCase()))
    return { ok: false, code: "E_SHAPE", message: "bad contentDigest" };
  if (!isNonEmptyString(ev.sourceRef, 1, 256))
    return { ok: false, code: "E_LACK", message: "bad sourceRef" };
  return { ok: true };
}

export function validateDistinctionClosed(d, label) {
  const c = checkClosed(d, DISTINCTION_KEYS, label);
  if (!c.ok) return c;
  for (const k of DISTINCTION_KEYS) {
    if (!Object.hasOwn(d, k)) return { ok: false, code: "E_LACK", message: "missing:" + k };
  }
  if (!isNonEmptyString(d.dimension, 4, 64))
    return { ok: false, code: "E_SHAPE", message: "bad distinction.dimension" };
  if (!isNonEmptyString(d.difference, 10, 500))
    return { ok: false, code: "E_SHAPE", message: "bad distinction.difference" };
  return { ok: true };
}

export function validateOptionClosed(o) {
  const c = checkClosed(o, OPTION_KEYS, "option");
  if (!c.ok) return c;
  for (const k of OPTION_KEYS) {
    if (!Object.hasOwn(o, k)) return { ok: false, code: "E_LACK", message: "missing:" + k };
  }
  if (typeof o.optionId !== "string" || !ID_RE.test(o.optionId))
    return { ok: false, code: "E_SHAPE", message: "bad optionId" };
  if (isReservedId(o.optionId))
    return { ok: false, code: "E_RESERVED_ID", message: "reserved optionId" };
  if (!isNonEmptyString(o.title, 4, 120))
    return { ok: false, code: "E_SHAPE", message: "bad title" };
  if (!isNonEmptyString(o.description, 10, 4000))
    return { ok: false, code: "E_SHAPE", message: "bad description" };
  if (!isNonEmptyString(o.approach, 10, 2000))
    return { ok: false, code: "E_SHAPE", message: "bad approach" };
  if (!Array.isArray(o.evidenceIds) || o.evidenceIds.length < 1 || o.evidenceIds.length > 8)
    return { ok: false, code: "E_NO_EVIDENCE", message: "evidenceIds 1..8 required" };
  const s = new Set();
  for (const id of o.evidenceIds) {
    if (typeof id !== "string" || !ID_RE.test(id) || isReservedId(id))
      return { ok: false, code: "E_SHAPE", message: "bad evidenceId ref" };
    if (s.has(id)) return { ok: false, code: "E_DUP", message: "dup evidence ref" };
    s.add(id);
  }
  if (!isNonEmptyString(o.tradeoffs, 10, 2000))
    return { ok: false, code: "E_LACK", message: "tradeoffs required" };
  if (!isNonEmptyString(o.uncertainties, 10, 2000))
    return { ok: false, code: "E_LACK", message: "uncertainties required" };
  if (typeof o.distinction !== "object" || o.distinction === null || Array.isArray(o.distinction))
    return { ok: false, code: "E_LACK", message: "distinction required" };
  const dd = validateDistinctionClosed(o.distinction, "option.distinction");
  if (!dd.ok) return dd;
  return { ok: true };
}

export function validateWeightsClosed(w) {
  if (w === undefined) return { ok: true, def: true };
  const c = checkClosed(w, WEIGHTS_KEYS, "weights");
  if (!c.ok) return c;
  for (const k of WEIGHTS_KEYS) {
    if (!Object.hasOwn(w, k))
      return { ok: false, code: "E_WEIGHTS", message: "missing own weight:" + k };
    if (typeof w[k] !== "number" || !Number.isFinite(w[k]) || w[k] < 0 || w[k] > 1)
      return { ok: false, code: "E_WEIGHTS", message: "bad weight:" + k };
  }
  const sum = w.evidenceStrength + w.feasibility + w.economy;
  if (Math.abs(sum - 1) > 0.001)
    return { ok: false, code: "E_WEIGHTS", message: "weights must sum to 1" };
  return { ok: true, def: false };
}

export function validateScoreEntryClosed(entry, label) {
  const c = checkClosed(entry, SCORE_ENTRY_KEYS, label);
  if (!c.ok) return { ok: false, code: "E_UNDOCUMENTED_SCORE", message: c.message };
  for (const k of SCORE_ENTRY_KEYS) {
    if (!Object.hasOwn(entry, k))
      return { ok: false, code: "E_UNDOCUMENTED_SCORE", message: "missing own key:" + k + ":" + label };
  }
  if (typeof entry.score !== "number" || !Number.isFinite(entry.score) || entry.score < 0 || entry.score > 10)
    return { ok: false, code: "E_UNDOCUMENTED_SCORE", message: "score 0..10 required:" + label };
  if (!isNonEmptyString(entry.reason, 8, 500))
    return { ok: false, code: "E_UNDOCUMENTED_SCORE", message: "score reason required:" + label };
  if (!Array.isArray(entry.basisEvidenceIds) || entry.basisEvidenceIds.length === 0)
    return { ok: false, code: "E_UNDOCUMENTED_SCORE", message: "basisEvidenceIds required:" + label };
  return { ok: true };
}

export function validateApprovalClosed(a) {
  const c = checkClosed(a, APPROVAL_KEYS, "approval");
  if (!c.ok) {
    if (c.code === "E_EXTRA_PROP" || c.code === "E_ALIAS")
      return { ok: false, code: "E_FORGED_APPROVAL", message: c.message };
    return c;
  }
  for (const k of APPROVAL_KEYS) {
    if (!Object.hasOwn(a, k)) {
      if (k === "requestDigest" || k === "optionDigests")
        return { ok: false, code: "E_APPROVAL_MISSING", message: "missing:" + k };
      return { ok: false, code: "E_FORGED_APPROVAL", message: "missing:" + k };
    }
  }
  if (a.status !== APPROVAL_STATUS)
    return { ok: false, code: "E_FORGED_APPROVAL", message: "status must be HUMAN_SELECTION_REQUIRED" };
  if (a.automaticDispatch !== false)
    return { ok: false, code: "E_FORGED_APPROVAL", message: "automaticDispatch must be false" };
  if (typeof a.requestDigest !== "string" || !HEX64_RE.test(a.requestDigest.toLowerCase()))
    return { ok: false, code: "E_APPROVAL_MALFORMED", message: "bad requestDigest" };
  if (typeof a.optionDigests !== "object" || a.optionDigests === null || Array.isArray(a.optionDigests))
    return { ok: false, code: "E_APPROVAL_MALFORMED", message: "bad optionDigests" };
  const protoD = Object.getPrototypeOf(a.optionDigests);
  if (protoD !== null && protoD !== Object.prototype)
    return { ok: false, code: "E_APPROVAL_MALFORMED", message: "optionDigests must be plain data" };
  if (Object.getOwnPropertySymbols(a.optionDigests).length !== 0)
    return { ok: false, code: "E_APPROVAL_MALFORMED", message: "optionDigests symbol key rejected" };
  if (Object.keys(a.optionDigests).length !== Object.getOwnPropertyNames(a.optionDigests).length)
    return { ok: false, code: "E_APPROVAL_MALFORMED", message: "optionDigests hidden key rejected" };
  const keys = Object.keys(a.optionDigests);
  if (keys.length < 3)
    return { ok: false, code: "E_APPROVAL_MALFORMED", message: "at least 3 option digests required" };
  for (const k of keys) {
    if (!ID_RE.test(k) || isReservedId(k))
      return { ok: false, code: "E_APPROVAL_MALFORMED", message: "bad optionId key" };
    const v = a.optionDigests[k];
    if (typeof v !== "string" || !HEX64_RE.test(String(v).toLowerCase()))
      return { ok: false, code: "E_APPROVAL_MALFORMED", message: "bad optionDigest:" + k };
  }
  return { ok: true };
}

export const MAX_INPUTS = { MAX_JSON_BYTES };
