import { normKey } from "./provenance.mjs";
import { validateOptionClosed } from "./schemas.mjs";

export const DISTINCTNESS_NOTE = "機器僅核對結構性相異（正規化文字、證據集合、決策維度鍵相異）；語義上的實質互異仍待原始人工選定審查。";

export function checkStructuralDistinctness(options) {
  const dims = new Set();
  for (const o of options) {
    const key = normKey(o.distinction.dimension);
    if (dims.has(key))
      return { ok: false, code: "E_NOT_DISTINCT", message: "duplicate distinction.dimension:" + o.optionId };
    dims.add(key);
  }
  for (let i = 0; i < options.length; i++) {
    for (let j = i + 1; j < options.length; j++) {
      const a = options[i];
      const b = options[j];
      if (normKey(a.title) === normKey(b.title))
        return { ok: false, code: "E_NOT_DISTINCT", message: "duplicate title:" + a.optionId + "/" + b.optionId };
      if (normKey(a.approach) === normKey(b.approach))
        return { ok: false, code: "E_NOT_DISTINCT", message: "duplicate approach:" + a.optionId + "/" + b.optionId };
      if (normKey(a.description) === normKey(b.description))
        return { ok: false, code: "E_NOT_DISTINCT", message: "duplicate description:" + a.optionId + "/" + b.optionId };
      const sa = [...a.evidenceIds].sort().join(",");
      const sb = [...b.evidenceIds].sort().join(",");
      if (sa === sb)
        return { ok: false, code: "E_NOT_DISTINCT", message: "identical evidence set:" + a.optionId + "/" + b.optionId };
    }
  }
  return { ok: true };
}

export function validateAlternatives(options, evidenceMap) {
  if (!Array.isArray(options) || options.length < 3)
    return { ok: false, code: "E_NEED_3_OPTIONS", message: "at least 3 options required" };
  const ids = new Set();
  for (const o of options) {
    const r = validateOptionClosed(o);
    if (!r.ok) return { ok: false, code: r.code, message: r.message + ":" + String(o?.optionId ?? "?") };
    if (ids.has(o.optionId)) return { ok: false, code: "E_DUP", message: "dup optionId:" + o.optionId };
    ids.add(o.optionId);
    for (const eid of o.evidenceIds) {
      if (!evidenceMap.has(eid))
        return { ok: false, code: "E_NO_EVIDENCE", message: "unsupported evidence:" + o.optionId + "->" + eid };
    }
  }
  const d = checkStructuralDistinctness(options);
  if (!d.ok) return d;
  return { ok: true, note: DISTINCTNESS_NOTE };
}
