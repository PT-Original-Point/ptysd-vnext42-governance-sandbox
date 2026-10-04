import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateAlternatives } from "../src/alternatives.mjs";

function mkOpt(id, over = {}) {
  return {
    optionId: id,
    title: "方案" + id + "：不同架構路徑",
    description: "方案 " + id + " 的完整說明，涵蓋範圍與步驟，長度足夠。",
    approach: "作法" + id + "：採用完全不同的技術路徑與部署方式。",
    evidenceIds: ["ev-00" + id.slice(-1)],
    tradeoffs: "取捨說明：" + id + " 的優點與代價對比，明確列出。",
    uncertainties: "不確定性說明：" + id + " 的未知因素與風險假設。",
    distinction: { dimension: "維度" + id, difference: "差異說明" + id + "：決策槓桿與變更範圍明確不同，長度足夠。" },
    ...over,
  };
}
function evMap() { return new Map([["ev-001", 1], ["ev-002", 1], ["ev-003", 1], ["ev-004", 1]]); }

describe("alternatives positive", () => {
  it("accepts 3 materially distinct", () => {
    const opts = [mkOpt("op-001"), mkOpt("op-002"), mkOpt("op-003")];
    const r = validateAlternatives(opts, evMap());
    assert.equal(r.ok, true);
  });
});

describe("alternatives fail-closed", () => {
  it("needs at least 3", () => {
    const r = validateAlternatives([mkOpt("op-001"), mkOpt("op-002")], evMap());
    assert.equal(r.ok, false); assert.equal(r.code, "E_NEED_3_OPTIONS");
  });
  it("rejects duplicate title", () => {
    const a = mkOpt("op-001"); const b = mkOpt("op-002", { title: a.title });
    const c = mkOpt("op-003");
    const r = validateAlternatives([a, b, c], evMap());
    assert.equal(r.ok, false); assert.equal(r.code, "E_NOT_DISTINCT");
  });
  it("rejects duplicate approach", () => {
    const a = mkOpt("op-001"); const b = mkOpt("op-002", { approach: a.approach });
    const r = validateAlternatives([a, b, mkOpt("op-003")], evMap());
    assert.equal(r.ok, false); assert.equal(r.code, "E_NOT_DISTINCT");
  });
  it("rejects identical evidence set", () => {
    const a = mkOpt("op-001"); const b = mkOpt("op-002", { evidenceIds: [...a.evidenceIds] });
    const r = validateAlternatives([a, b, mkOpt("op-003")], evMap());
    assert.equal(r.ok, false); assert.equal(r.code, "E_NOT_DISTINCT");
  });
  it("rejects duplicate distinction dimension", () => {
    const a = mkOpt("op-001"); const b = mkOpt("op-002", { distinction: { ...a.distinction } });
    const r = validateAlternatives([a, b, mkOpt("op-003")], evMap());
    assert.equal(r.ok, false); assert.equal(r.code, "E_NOT_DISTINCT");
  });
  it("rejects missing distinction", () => {
    const a = mkOpt("op-001"); delete a.distinction;
    const r = validateAlternatives([a, mkOpt("op-002"), mkOpt("op-003")], evMap());
    assert.equal(r.ok, false);
  });
  it("rejects unsupported evidence", () => {
    const a = mkOpt("op-001", { evidenceIds: ["ev-999"] });
    const r = validateAlternatives([a, mkOpt("op-002"), mkOpt("op-003")], evMap());
    assert.equal(r.ok, false); assert.equal(r.code, "E_NO_EVIDENCE");
  });
  it("rejects missing tradeoffs", () => {
    const a = mkOpt("op-001", { tradeoffs: "短" });
    const r = validateAlternatives([a, mkOpt("op-002"), mkOpt("op-003")], evMap());
    assert.equal(r.ok, false);
  });
  it("rejects extra prop closed", () => {
    const a = { ...mkOpt("op-001"), extra: 1 };
    const r = validateAlternatives([a, mkOpt("op-002"), mkOpt("op-003")], evMap());
    assert.equal(r.ok, false);
  });
  it("rejects alias prop", () => {
    const a = mkOpt("op-001"); delete a.title; a.Title = "別名標題測試足夠長度";
    const r = validateAlternatives([a, mkOpt("op-002"), mkOpt("op-003")], evMap());
    assert.equal(r.ok, false);
  });
  it("rejects reserved optionId", () => {
    const a = mkOpt("__proto__");
    const r = validateAlternatives([a, mkOpt("op-002"), mkOpt("op-003")], new Map([["__proto__", 1], ["ev-002", 1], ["ev-003", 1]]));
    assert.equal(r.ok, false);
  });
});
