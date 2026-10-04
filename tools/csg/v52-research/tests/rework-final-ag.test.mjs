import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sha256HexText } from "../src/provenance.mjs";
import { buildRecommendation } from "../src/recommendation.mjs";
import { validateApprovalClosed } from "../src/schemas.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "cli.mjs");
function wsRoot() { return path.resolve(here, "..", "..", "..", ".."); }
const request = { project: "P52", requestId: "req-001", goal: "比較三種快取策略", createdAt: "2026-09-01T00:00:00.000Z" };
function mkO(id, eid, dim, title) {
  return { optionId: id, title: title ?? ("方案" + id + "標題充足測試"), description: "方案 " + id + " 的完整說明，涵蓋範圍與步驟，長度足夠充足。", approach: "作法" + id + "技術路徑與部署方式測試充足版本。", evidenceIds: [eid], tradeoffs: "取捨說明：" + id + " 的優點與代價對比，明確列出充足。", uncertainties: "不確定性說明：" + id + " 的未知因素與風險假設充足。", distinction: { dimension: dim ?? ("維度" + id), difference: "差異說明" + id + "：決策槓桿與變更範圍明確不同，長度足夠。" } };
}
function stdOpts() { return [mkO("op-001", "ev-001"), mkO("op-002", "ev-002"), mkO("op-003", "ev-003")]; }
function stdScores() {
  const mk = (eid, base) => ({
    evidenceStrength: { score: base, reason: "證據直接支撐，理由充分說明。", basisEvidenceIds: [eid] },
    feasibility: { score: base - 1, reason: "可行性評估已附理由與依據。", basisEvidenceIds: [eid] },
    economy: { score: base - 2, reason: "經濟性評估已附理由與依據。", basisEvidenceIds: [eid] },
  });
  return { "op-001": mk("ev-001", 9), "op-002": mk("ev-002", 7), "op-003": mk("ev-003", 5) };
}
const weights = { evidenceStrength: 0.5, feasibility: 0.3, economy: 0.2 };

describe("CLI-ERRCODE-CONFLATION", () => {
  let tmp = null;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(here, "tmp-ag-")); });
  afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null; });
  function run(args, cwd) {
    try {
      execFileSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return { ok: true };
    } catch (e) { return { ok: false, err: String(e.stderr ?? e.message).slice(0, 400) }; }
  }
  it("missing file flag reports E_FLAG not E_CLOCK; missing now reports E_CLOCK", () => {
    const root = wsRoot();
    const mk = (n, d) => { const p = path.join(tmp, n); fs.writeFileSync(p, JSON.stringify(d)); return path.relative(root, p); };
    const e1 = "甲。"; const e2 = "乙。"; const e3 = "丙。";
    const evs = [
      { evidenceId: "ev-001", provider: "native-agent-fixture", mode: "fixture", isFixture: true, targetProject: "P52", targetRequestId: "req-001", collectedAt: "2026-09-20T00:00:00.000Z", contentText: e1, contentDigest: sha256HexText(e1), sourceRef: "r1" },
      { evidenceId: "ev-002", provider: "native-browser-fixture", mode: "fixture", isFixture: true, targetProject: "P52", targetRequestId: "req-001", collectedAt: "2026-09-21T00:00:00.000Z", contentText: e2, contentDigest: sha256HexText(e2), sourceRef: "r2" },
      { evidenceId: "ev-003", provider: "test-fixture", mode: "fixture", isFixture: true, targetProject: "P52", targetRequestId: "req-001", collectedAt: "2026-09-22T00:00:00.000Z", contentText: e3, contentDigest: sha256HexText(e3), sourceRef: "r3" },
    ];
    const ev = mk("evidence.json", evs);
    const op = mk("options.json", stdOpts());
    const sc = mk("scores.json", stdScores());
    const out = path.join(tmp, "out.json");
    const r1 = run(["--evidence", ev, "--options", op, "--scores", sc, "--out", path.relative(root, out), "--now", "2026-10-04T00:00:00.000Z"], root);
    assert.equal(r1.ok, false); assert.ok(r1.err.includes("E_FLAG"), r1.err);
    assert.ok(!r1.err.includes("E_CLOCK"), r1.err);
    const rq = mk("request.json", request);
    const r2 = run(["--request", rq, "--evidence", ev, "--options", op, "--scores", sc, "--out", path.relative(root, out)], root);
    assert.equal(r2.ok, false); assert.ok(r2.err.includes("E_CLOCK"), r2.err);
  });
});

describe("SCORES-ROOT-PROTOTYPE-BYPASS", () => {
  it("rejects custom prototype and symbol keys at scores root", () => {
    const s1 = { ...stdScores() };
    Object.setPrototypeOf(s1, { evil: 1 });
    const r1 = buildRecommendation({ request, options: stdOpts(), scores: s1, weights });
    assert.equal(r1.ok, false);
    const s2 = { ...stdScores() };
    s2[Symbol("hidden")] = 1;
    const r2 = buildRecommendation({ request, options: stdOpts(), scores: s2, weights });
    assert.equal(r2.ok, false);
  });
  it("positive plain scores root passes", () => {
    const r = buildRecommendation({ request, options: stdOpts(), scores: stdScores(), weights });
    assert.equal(r.ok, true);
  });
});

describe("STANDALONE-BUILDER-DISTINCTNESS-OMISSION", () => {
  it("direct builder rejects duplicate title without CLI", () => {
    const oo = stdOpts(); oo[1] = { ...oo[1], title: oo[0].title };
    const r = buildRecommendation({ request, options: oo, scores: stdScores(), weights });
    assert.equal(r.ok, false); assert.equal(r.code, "E_NOT_DISTINCT");
  });
  it("direct builder rejects duplicate dimension without CLI", () => {
    const oo = stdOpts(); oo[2] = { ...oo[2], distinction: { ...oo[0].distinction } };
    const r = buildRecommendation({ request, options: oo, scores: stdScores(), weights });
    assert.equal(r.ok, false); assert.equal(r.code, "E_NOT_DISTINCT");
  });
});

describe("CLI-TAUTOLOGY-ANCESTOR-CHECK", () => {
  it("redundant ternary removed", () => {
    const src = fs.readFileSync(path.join(here, "..", "cli.mjs"), "utf8");
    assert.ok(!src.includes("parent === near ? near : near"));
  });
});

describe("APPROVAL-OPTION-DIGESTS-PROTOTYPE-CLOSURE", () => {
  it("rejects non-plain prototype nested map", () => {
    const r = buildRecommendation({ request, options: stdOpts(), scores: stdScores(), weights });
    assert.equal(r.ok, true);
    const evil = Object.assign(Object.create({ evil: 1 }), r.recommendation.approval.optionDigests);
    const bad = { ...r.recommendation.approval, optionDigests: evil };
    assert.equal(validateApprovalClosed(bad).ok, false);
  });
  it("rejects symbol key nested map", () => {
    const r = buildRecommendation({ request, options: stdOpts(), scores: stdScores(), weights });
    assert.equal(r.ok, true);
    const evil = { ...r.recommendation.approval.optionDigests };
    evil[Symbol("s")] = "b".repeat(64);
    const bad = { ...r.recommendation.approval, optionDigests: evil };
    assert.equal(validateApprovalClosed(bad).ok, false);
  });
  it("rejects hidden non-enumerable nested key", () => {
    const r = buildRecommendation({ request, options: stdOpts(), scores: stdScores(), weights });
    assert.equal(r.ok, true);
    const evil = { ...r.recommendation.approval.optionDigests };
    Object.defineProperty(evil, "op-001", { enumerable: false });
    const bad = { ...r.recommendation.approval, optionDigests: evil };
    assert.equal(validateApprovalClosed(bad).ok, false);
  });
});
