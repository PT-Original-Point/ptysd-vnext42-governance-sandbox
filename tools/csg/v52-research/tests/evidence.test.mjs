import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sha256HexText, parseStrictUtcMs } from "../src/provenance.mjs";
import { verifyEvidence, verifyEvidenceList, FIXTURE_CLOCK_KIND } from "../src/evidence.mjs";

function mkEv(over = {}) {
  const text = over.contentText ?? "原生代理研究摘要：快取策略比較。";
  return {
    evidenceId: "ev-001",
    provider: "native-agent-fixture",
    mode: "fixture",
    isFixture: true,
    targetProject: "P52",
    targetRequestId: "req-001",
    collectedAt: "2026-09-20T00:00:00.000Z",
    contentText: text,
    contentDigest: sha256HexText(text),
    sourceRef: "native-record-001",
    ...over,
  };
}
const NOW = parseStrictUtcMs("2026-10-04T00:00:00.000Z");
const ctx = { expectedProject: "P52", expectedRequestId: "req-001", nowMs: NOW, clockKind: FIXTURE_CLOCK_KIND };

describe("evidence positive", () => {
  it("accepts valid fixture", () => {
    const r = verifyEvidence(mkEv(), ctx);
    assert.equal(r.ok, true);
  });
  it("accepts list", () => {
    const t2 = "瀏覽器研究摘要：第二來源。";
    const e2 = mkEv({ evidenceId: "ev-002", provider: "native-browser-fixture", contentText: t2, contentDigest: sha256HexText(t2) });
    const r = verifyEvidenceList([mkEv(), e2], ctx);
    assert.equal(r.ok, true);
  });
  it("accepts old date without TTL", () => {
    const r = verifyEvidence(mkEv({ collectedAt: "2025-01-01T00:00:00.000Z" }), ctx);
    assert.equal(r.ok, true);
  });
  it("accepts boundary year 0001", () => {
    const r = verifyEvidence(mkEv({ collectedAt: "0001-01-02T00:00:00.000Z" }), { ...ctx, nowMs: parseStrictUtcMs("0001-02-01T00:00:00.000Z") });
    assert.equal(r.ok, true);
  });
  it("benign words with live substring still pass", () => {
    const t = "內容提及 live actual WEB 皆為一般文字，非模式。";
    const r = verifyEvidence(mkEv({ contentText: t, contentDigest: sha256HexText(t), sourceRef: "alive-record-live-benign" }), ctx);
    assert.equal(r.ok, true);
  });
});

describe("evidence fail-closed", () => {
  it("rejects bad date", () => {
    const r = verifyEvidence(mkEv({ collectedAt: "bad-date" }), ctx);
    assert.equal(r.ok, false); assert.equal(r.code, "E_DATE_INVALID");
  });
  it("rejects impossible calendar", () => {
    const r = verifyEvidence(mkEv({ collectedAt: "2026-02-30T00:00:00.000Z" }), ctx);
    assert.equal(r.ok, false); assert.equal(r.code, "E_DATE_INVALID");
  });
  it("rejects non-UTC form", () => {
    const r = verifyEvidence(mkEv({ collectedAt: "2026-09-20T00:00:00+08:00" }), ctx);
    assert.equal(r.ok, false); assert.equal(r.code, "E_DATE_INVALID");
  });
  it("rejects lack (empty content)", () => {
    const r = verifyEvidence(mkEv({ contentText: "" }), ctx);
    assert.equal(r.ok, false); assert.equal(r.code, "E_LACK");
  });
  it("rejects tamper", () => {
    const r = verifyEvidence(mkEv({ contentDigest: "0".repeat(64) }), ctx);
    assert.equal(r.ok, false); assert.equal(r.code, "E_TAMPER");
  });
  it("rejects conflicting target", () => {
    const r = verifyEvidence(mkEv({ targetRequestId: "req-999" }), ctx);
    assert.equal(r.ok, false); assert.equal(r.code, "E_CONFLICT_TARGET");
  });
  it("rejects live mode", () => {
    const r = verifyEvidence(mkEv({ provider: "native-agent-live", mode: "live", isFixture: false }), ctx);
    assert.equal(r.ok, false); assert.equal(r.code, "E_LIVE_NOT_ACCEPTED");
  });
  it("rejects unknown provider stable", () => {
    const r = verifyEvidence(mkEv({ provider: "custom-scraper", mode: "fixture" }), ctx);
    assert.equal(r.ok, false); assert.equal(r.code, "E_PROVIDER_UNKNOWN");
  });
  it("rejects inherited provider keys stable", () => {
    for (const p of ["toString", "constructor", "__proto__"]) {
      const r = verifyEvidence(mkEv({ provider: p, mode: "fixture" }), ctx);
      assert.equal(r.ok, false, p); assert.equal(r.code, "E_PROVIDER_UNKNOWN", p);
    }
  });
  it("rejects mode mismatch", () => {
    const r = verifyEvidence(mkEv({ provider: "native-agent-fixture", mode: "live", isFixture: false }), ctx);
    assert.equal(r.ok, false);
  });
  it("rejects non-fixture masquerade", () => {
    const r = verifyEvidence(mkEv({ isFixture: false }), ctx);
    assert.equal(r.ok, false);
  });
  it("rejects extra prop closed", () => {
    const r = verifyEvidence({ ...mkEv(), extra: 1 }, ctx);
    assert.equal(r.ok, false);
  });
  it("rejects alias prop", () => {
    const e = mkEv(); delete e.provider; e.Provider = "native-agent-fixture";
    const r = verifyEvidence(e, ctx);
    assert.equal(r.ok, false);
  });
  it("rejects missing fixture clock kind", () => {
    const r = verifyEvidence(mkEv(), { expectedProject: "P52", expectedRequestId: "req-001", nowMs: NOW });
    assert.equal(r.ok, false); assert.equal(r.code, "E_CLOCK");
  });
  it("rejects unsafe clock value", () => {
    const r = verifyEvidence(mkEv(), { expectedProject: "P52", expectedRequestId: "req-001", nowMs: NaN, clockKind: FIXTURE_CLOCK_KIND });
    assert.equal(r.ok, false); assert.equal(r.code, "E_CLOCK");
  });
  it("rejects dup ids", () => {
    const r = verifyEvidenceList([mkEv(), mkEv()], ctx);
    assert.equal(r.ok, false); assert.equal(r.code, "E_DUP");
  });
  it("rejects future date", () => {
    const r = verifyEvidence(mkEv({ collectedAt: "2026-12-01T00:00:00.000Z" }), ctx);
    assert.equal(r.ok, false);
  });
});
