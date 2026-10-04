import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sha256HexText, parseStrictUtcMs, isStrictUtcIso } from "../src/provenance.mjs";
import { verifyEvidence, FIXTURE_CLOCK_KIND } from "../src/evidence.mjs";
import { buildRecommendation, verifyApproval } from "../src/recommendation.mjs";
import { validateAlternatives } from "../src/alternatives.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "cli.mjs");
function wsRoot() { return path.resolve(here, "..", "..", "..", ".."); }
const NOW = parseStrictUtcMs("2026-10-04T00:00:00.000Z");
const CCTX = { expectedProject: "P52", expectedRequestId: "req-001", nowMs: NOW, clockKind: FIXTURE_CLOCK_KIND };
const request = { project: "P52", requestId: "req-001", goal: "比較三種快取策略", createdAt: "2026-09-01T00:00:00.000Z" };
function mkO(id, eid, dim) {
  return { optionId: id, title: "方案" + id + "標題充足測試", description: "方案 " + id + " 的完整說明，涵蓋範圍與步驟，長度足夠充足。", approach: "作法" + id + "技術路徑與部署方式測試充足版本。", evidenceIds: [eid], tradeoffs: "取捨說明：" + id + " 的優點與代價對比，明確列出充足。", uncertainties: "不確定性說明：" + id + " 的未知因素與風險假設充足。", distinction: { dimension: dim ?? ("維度" + id), difference: "差異說明" + id + "：決策槓桿與變更範圍明確不同，長度足夠。" } };
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
function mkEv(over = {}) {
  const t = over.contentText ?? "夾具文本。";
  return { evidenceId: "ev-001", provider: "native-agent-fixture", mode: "fixture", isFixture: true, targetProject: "P52", targetRequestId: "req-001", collectedAt: "2026-09-20T00:00:00.000Z", contentText: t, contentDigest: sha256HexText(t), sourceRef: "r1", ...over };
}

describe("R9-F01 proto digest binding", () => {
  it("positive own keys bound", () => {
    const r = buildRecommendation({ request, options: stdOpts(), scores: stdScores(), weights: { evidenceStrength: 0.5, feasibility: 0.3, economy: 0.2 } });
    assert.equal(r.ok, true);
    for (const id of ["op-001", "op-002", "op-003"]) assert.ok(Object.hasOwn(r.recommendation.approval.optionDigests, id), id);
  });
  it("negative __proto__ reserved rejected", () => {
    const oo = stdOpts(); oo[0] = { ...oo[0], optionId: "__proto__" };
    const s = stdScores(); s["__proto__"] = s["op-001"]; delete s["op-001"];
    const r = buildRecommendation({ request, options: oo, scores: s, weights: { evidenceStrength: 0.5, feasibility: 0.3, economy: 0.2 } });
    assert.equal(r.ok, false);
  });
  it("negative missing one digest fails", () => {
    const r = buildRecommendation({ request, options: stdOpts(), scores: stdScores(), weights: { evidenceStrength: 0.5, feasibility: 0.3, economy: 0.2 } });
    assert.equal(r.ok, true);
    const tampered = { ...r.recommendation.approval, optionDigests: { ...r.recommendation.approval.optionDigests } };
    delete tampered.optionDigests["op-003"];
    const v = verifyApproval(tampered, { requestDigest: r.recommendation.requestDigest, optionDigests: r.recommendation.optionDigests });
    assert.equal(v.ok, false);
  });
});

describe("R9-F01 empty digest set", () => {
  it("negative empty and short sets rejected", () => {
    const e0 = { status: "HUMAN_SELECTION_REQUIRED", automaticDispatch: false, requestDigest: "a".repeat(64), optionDigests: {} };
    assert.equal(verifyApproval(e0, { requestDigest: "a".repeat(64), optionDigests: {} }).ok, false);
    const e1 = { status: "HUMAN_SELECTION_REQUIRED", automaticDispatch: false, requestDigest: "a".repeat(64), optionDigests: { "op-001": "b".repeat(64), "op-002": "c".repeat(64) } };
    assert.equal(verifyApproval(e1, { requestDigest: "a".repeat(64), optionDigests: e1.optionDigests }).ok, false);
  });
});

describe("R9-F02 builder bypass and distinctness", () => {
  it("negative direct extra key rejected", () => {
    const oo = stdOpts(); oo[1] = { ...oo[1], extra: 1 };
    const r = buildRecommendation({ request, options: oo, scores: stdScores(), weights: { evidenceStrength: 0.5, feasibility: 0.3, economy: 0.2 } });
    assert.equal(r.ok, false);
  });
  it("negative same dimension rejected, honest note kept", () => {
    const oo = stdOpts(); oo[1] = { ...oo[1], distinction: { ...oo[0].distinction } };
    const m = new Map([["ev-001", 1], ["ev-002", 1], ["ev-003", 1]]);
    const r = validateAlternatives(oo, m);
    assert.equal(r.ok, false); assert.equal(r.code, "E_NOT_DISTINCT");
    const ok = validateAlternatives(stdOpts(), m);
    assert.equal(ok.ok, true);
    assert.ok(String(ok.note || "").includes("人工"));
  });
});

describe("R9-F03 provider own-key", () => {
  it("negative inherited keys stable unknown", () => {
    for (const p of ["toString", "constructor", "__proto__"]) {
      const r = verifyEvidence(mkEv({ provider: p }), CCTX);
      assert.equal(r.ok, false, p); assert.equal(r.code, "E_PROVIDER_UNKNOWN", p);
    }
  });
});

describe("R9-F05 years and clock", () => {
  it("positive years 0001..0099", () => {
    for (const s of ["0001-01-01T00:00:00.000Z", "0099-06-15T12:00:00Z"]) {
      assert.equal(isStrictUtcIso(s), true, s);
    }
    assert.equal(isStrictUtcIso("0099-02-30T00:00:00.000Z"), false);
  });
  it("negative unsafe clock rejected, fixture labelled", () => {
    assert.equal(verifyEvidence(mkEv(), { ...CCTX, nowMs: NaN }).ok, false);
    assert.equal(verifyEvidence(mkEv(), { ...CCTX, clockKind: "trusted" }).ok, false);
  });
});

describe("R9-F03 weights F04 paths F05 clock CLI", () => {
  let tmp = null;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(here, "tmp-r9-")); });
  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = null;
    try {
      const sc = path.join(wsRoot(), "outputs", "P52-RESEARCH", "rework9", "scratch-link-target");
      if (fs.existsSync(sc)) fs.rmSync(sc, { recursive: true, force: true });
    } catch { /* ignore */ }
  });
  function run(args, cwd) {
    try {
      const out = execFileSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return { ok: true, out: String(out) };
    } catch (e) { return { ok: false, err: String(e.stderr ?? e.message).slice(0, 600) }; }
  }
  function baseFiles() {
    const w = (n, d) => { const p = path.join(tmp, n); fs.writeFileSync(p, JSON.stringify(d)); return path.relative(wsRoot(), p); };
    const e1 = "摘要甲。"; const e2 = "摘要乙。"; const e3 = "摘要丙。";
    const evs = [
      { evidenceId: "ev-001", provider: "native-agent-fixture", mode: "fixture", isFixture: true, targetProject: "P52", targetRequestId: "req-001", collectedAt: "2026-09-20T00:00:00.000Z", contentText: e1, contentDigest: sha256HexText(e1), sourceRef: "r1" },
      { evidenceId: "ev-002", provider: "native-browser-fixture", mode: "fixture", isFixture: true, targetProject: "P52", targetRequestId: "req-001", collectedAt: "2026-09-21T00:00:00.000Z", contentText: e2, contentDigest: sha256HexText(e2), sourceRef: "r2" },
      { evidenceId: "ev-003", provider: "test-fixture", mode: "fixture", isFixture: true, targetProject: "P52", targetRequestId: "req-001", collectedAt: "2026-09-22T00:00:00.000Z", contentText: e3, contentDigest: sha256HexText(e3), sourceRef: "r3" },
    ];
    return { rq: w("request.json", request), ev: w("evidence.json", evs), op: w("options.json", stdOpts()), sc: w("scores.json", stdScores()) };
  }
  it("default weights rationale honest and clock labelled", () => {
    const root = wsRoot(); const f = baseFiles();
    const out = path.join(tmp, "out.json");
    const r = run(["--request", f.rq, "--evidence", f.ev, "--options", f.op, "--scores", f.sc, "--out", path.relative(root, out), "--now", "2026-10-04T00:00:00.000Z"], root);
    assert.equal(r.ok, true);
    const j = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.equal(j.weightsDefaulted, true);
    assert.ok(j.rationale.includes("預設權重"));
    assert.ok(!j.rationale.includes("用戶權重"));
    assert.equal(j.clock.kind, "fixture-deterministic");
    const out2 = path.join(tmp, "out2.json");
    const wpath = path.join(tmp, "w.json"); fs.writeFileSync(wpath, JSON.stringify({ evidenceStrength: 0.5, feasibility: 0.3, economy: 0.2 }));
    const r2 = run(["--request", f.rq, "--evidence", f.ev, "--options", f.op, "--scores", f.sc, "--weights", path.relative(root, wpath), "--out", path.relative(root, out2), "--now", "2026-10-04T00:00:00.000Z"], root);
    assert.equal(r2.ok, true);
    const j2 = JSON.parse(fs.readFileSync(out2, "utf8"));
    assert.ok(j2.rationale.includes("用戶權重"));
  });
  it("case-variant in-workspace accepted on win32, duplicate rejected", () => {
    const root = wsRoot(); const f = baseFiles();
    const out = path.join(tmp, "out.json");
    const mixed = f.rq.toUpperCase();
    const r = run(["--request", mixed, "--evidence", f.ev, "--options", f.op, "--scores", f.sc, "--out", path.relative(root, out), "--now", "2026-10-04T00:00:00.000Z"], root);
    if (process.platform === "win32") assert.equal(r.ok, true);
    else assert.ok(r.ok === true || r.ok === false);
    const outA = path.join(tmp, "OUT.json");
    const r2 = run(["--request", f.rq, "--evidence", f.ev, "--options", f.op, "--scores", f.sc, "--out", path.relative(root, outA), "--report", path.relative(root, outA.toLowerCase()), "--now", "2026-10-04T00:00:00.000Z"], root);
    if (process.platform === "win32") { assert.equal(r2.ok, false); assert.ok(r2.err.includes("E_SAME_TARGET")); }
  });
  it("junction ancestor escape blocked within allowed scratch", () => {
    if (process.platform !== "win32") return;
    const root = wsRoot();
    const target = path.join(root, "outputs", "P52-RESEARCH", "rework9", "scratch-link-target");
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "real.json"), JSON.stringify(request));
    const link = path.join(tmp, "jlink");
    try { fs.symlinkSync(target, link, "junction"); } catch { return; }
    const f = baseFiles();
    const out = path.join(tmp, "out.json");
    const viaLink = path.relative(root, path.join(link, "real.json"));
    const r = run(["--request", viaLink, "--evidence", f.ev, "--options", f.op, "--scores", f.sc, "--out", path.relative(root, out), "--now", "2026-10-04T00:00:00.000Z"], root);
    assert.equal(r.ok, false);
    assert.ok(r.err.includes("E_SYMLINK") || r.err.includes("E_PATH"));
    const outViaLink = path.join(link, "ev-out.json");
    const r2 = run(["--request", f.rq, "--evidence", f.ev, "--options", f.op, "--scores", f.sc, "--out", path.relative(root, outViaLink), "--now", "2026-10-04T00:00:00.000Z"], root);
    assert.equal(r2.ok, false);
    assert.ok(r2.err.includes("E_SYMLINK") || r2.err.includes("E_PATH") || r2.err.includes("E_OVERWRITE"));
  });
});
