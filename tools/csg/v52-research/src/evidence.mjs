import { sha256HexText, parseStrictUtcMs } from "./provenance.mjs";
import { validateEvidenceClosed } from "./schemas.mjs";

export const FIXTURE_CLOCK_KIND = "fixture-deterministic";

export function validateEvidenceShape(ev) {
  return validateEvidenceClosed(ev);
}

export function verifyEvidence(ev, ctx) {
  const shape = validateEvidenceClosed(ev);
  if (!shape.ok) return shape;
  if (ev.mode === "live") {
    return { ok: false, code: "E_LIVE_NOT_ACCEPTED", message: "live mode not accepted in fixture slice" };
  }
  if (ev.provider === "native-agent-live" || ev.provider === "native-browser-live") {
    return { ok: false, code: "E_LIVE_NOT_ACCEPTED", message: "live provider not accepted" };
  }
  const nowMs = ctx?.nowMs;
  const clockKind = ctx?.clockKind;
  if (clockKind !== FIXTURE_CLOCK_KIND) {
    return { ok: false, code: "E_CLOCK", message: "explicit fixture clock required" };
  }
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) {
    return { ok: false, code: "E_CLOCK", message: "unsafe clock value" };
  }
  const expectedProject = ctx?.expectedProject;
  const expectedRequestId = ctx?.expectedRequestId;
  if (expectedProject !== undefined && ev.targetProject !== expectedProject)
    return { ok: false, code: "E_CONFLICT_TARGET", message: "targetProject mismatch" };
  if (expectedRequestId !== undefined && ev.targetRequestId !== expectedRequestId)
    return { ok: false, code: "E_CONFLICT_TARGET", message: "targetRequestId mismatch" };
  const actual = sha256HexText(ev.contentText);
  if (actual !== ev.contentDigest.toLowerCase())
    return { ok: false, code: "E_TAMPER", message: "contentDigest mismatch" };
  const collectedMs = parseStrictUtcMs(ev.collectedAt);
  if (collectedMs === null)
    return { ok: false, code: "E_DATE_INVALID", message: "bad collectedAt" };
  if (collectedMs > nowMs + 60_000)
    return { ok: false, code: "E_DATE_INVALID", message: "collectedAt in future vs fixture clock" };
  return { ok: true, digest: actual };
}

export function verifyEvidenceList(list, ctx) {
  if (!Array.isArray(list) || list.length === 0)
    return { ok: false, code: "E_LACK", message: "evidence list empty" };
  const seen = new Set();
  for (const ev of list) {
    const r = verifyEvidence(ev, ctx);
    if (!r.ok) return { ok: false, code: r.code, message: r.message + ":" + String(ev?.evidenceId ?? "?") };
    if (seen.has(ev.evidenceId))
      return { ok: false, code: "E_DUP", message: "dup evidenceId:" + ev.evidenceId };
    seen.add(ev.evidenceId);
  }
  return { ok: true };
}
