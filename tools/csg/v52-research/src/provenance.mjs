import { createHash } from "node:crypto";

export const MAX_JSON_BYTES = 64 * 1024;
export const MAX_TEXT_LEN = 8000;
export const HEX64 = /^[0-9a-f]{64}$/;
export const ID_RE_SRC = "^[A-Za-z0-9_-]{1,64}$";

const STRICT_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const STRICT_UTC_PARTS = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map((v) => stableStringify(v)).join(",") + "]";
  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k]));
  return "{" + parts.join(",") + "}";
}

export function sha256HexText(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function canonicalDigest(obj) {
  return sha256HexText(stableStringify(obj));
}

export function byteLengthUtf8(s) {
  return Buffer.byteLength(s, "utf8");
}

function daysInMonth(y, m) {
  if (m === 2) {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return leap ? 29 : 28;
  }
  if (m === 4 || m === 6 || m === 9 || m === 11) return 30;
  return 31;
}

function utcMsNoYearShift(y, mo, d, h, mi, se, ms) {
  const dt = new Date(0);
  dt.setUTCFullYear(y, mo - 1, d);
  dt.setUTCHours(h, mi, se, ms);
  return dt.getTime();
}

export function parseStrictUtcMs(s) {
  if (typeof s !== "string") return null;
  if (!STRICT_UTC_RE.test(s)) return null;
  const m = STRICT_UTC_PARTS.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const se = Number(m[6]);
  const ms = m[7] === undefined ? 0 : Number(m[7].padEnd(3, "0"));
  if (y < 1 || y > 9999) return null;
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > daysInMonth(y, mo)) return null;
  if (h > 23 || mi > 59 || se > 59 || ms > 999) return null;
  const t = utcMsNoYearShift(y, mo, d, h, mi, se, ms);
  if (!Number.isFinite(t)) return null;
  const c = new Date(t);
  if (
    c.getUTCFullYear() !== y ||
    c.getUTCMonth() !== mo - 1 ||
    c.getUTCDate() !== d ||
    c.getUTCHours() !== h ||
    c.getUTCMinutes() !== mi ||
    c.getUTCSeconds() !== se ||
    c.getUTCMilliseconds() !== ms
  ) return null;
  return t;
}

export function isStrictUtcIso(s) {
  return parseStrictUtcMs(s) !== null;
}

export function requireTrustedNowMs(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

export function normKey(s) {
  return String(s).trim().toLowerCase().replace(/\s+/g, " ");
}
