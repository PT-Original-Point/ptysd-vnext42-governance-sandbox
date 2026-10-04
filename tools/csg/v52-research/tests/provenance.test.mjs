import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stableStringify, canonicalDigest, sha256HexText, isStrictUtcIso, parseStrictUtcMs, requireTrustedNowMs } from "../src/provenance.mjs";

describe("provenance", () => {
  it("stable stringify sorts keys deterministically", () => {
    const a = stableStringify({ b: 1, a: 2 });
    const b = stableStringify({ a: 2, b: 1 });
    assert.equal(a, b);
    assert.equal(a, '{"a":2,"b":1}');
  });
  it("sha256 hex format", () => {
    const h = sha256HexText("abc");
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(h, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("canonical digest stable", () => {
    const d1 = canonicalDigest({ x: [3, 2], y: { b: 1, a: 0 } });
    const d2 = canonicalDigest({ y: { a: 0, b: 1 }, x: [3, 2] });
    assert.equal(d1, d2);
  });
  it("strict UTC accepts valid", () => {
    assert.equal(isStrictUtcIso("2026-09-01T00:00:00.000Z"), true);
    assert.equal(isStrictUtcIso("2026-09-01T12:34:56Z"), true);
    assert.equal(typeof parseStrictUtcMs("2026-09-01T00:00:00.000Z"), "number");
  });
  it("strict UTC boundary years 0001..0099 round-trip", () => {
    for (const s of ["0001-01-01T00:00:00.000Z", "0099-12-31T23:59:59.123Z", "0100-06-15T12:00:00Z", "9999-12-31T23:59:59.999Z"]) {
      assert.equal(isStrictUtcIso(s), true, s);
      assert.ok(Number.isFinite(parseStrictUtcMs(s)));
    }
    assert.equal(isStrictUtcIso("0001-02-29T00:00:00.000Z"), false);
    assert.equal(isStrictUtcIso("0099-02-30T00:00:00.000Z"), false);
  });
  it("strict UTC rejects Date.parse-only forms", () => {
    assert.equal(isStrictUtcIso("not-a-date"), false);
    assert.equal(isStrictUtcIso("2026/09/01"), false);
    assert.equal(isStrictUtcIso("2026-09-01"), false);
    assert.equal(isStrictUtcIso("2026-09-01T00:00:00"), false);
    assert.equal(isStrictUtcIso("2026-09-01T00:00:00+08:00"), false);
    assert.equal(parseStrictUtcMs(123), null);
  });
  it("strict UTC rejects impossible calendar", () => {
    assert.equal(isStrictUtcIso("2026-02-30T00:00:00.000Z"), false);
    assert.equal(isStrictUtcIso("2026-13-01T00:00:00.000Z"), false);
    assert.equal(isStrictUtcIso("2026-00-10T00:00:00.000Z"), false);
    assert.equal(isStrictUtcIso("2026-09-01T24:00:00.000Z"), false);
  });
  it("trusted clock requires explicit number", () => {
    assert.equal(requireTrustedNowMs(Date.parse("2026-10-04T00:00:00.000Z")) !== null, true);
    assert.equal(requireTrustedNowMs(undefined), null);
    assert.equal(requireTrustedNowMs(NaN), null);
  });
});
