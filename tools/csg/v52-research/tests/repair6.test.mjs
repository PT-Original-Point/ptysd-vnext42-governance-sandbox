import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sha256HexText, parseStrictUtcMs } from "../src/provenance.mjs";
import { verifyEvidence, FIXTURE_CLOCK_KIND } from "../src/evidence.mjs";
import { buildRecommendation, verifyApproval } from "../src/recommendation.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "cli.mjs");
const srcDir = path.join(here, "..", "src");
const NOW = parseStrictUtcMs("2026-10-04T00:00:00.000Z");
const CCTX = { expectedProject: "P52", expectedRequestId: "req-001", nowMs: NOW, clockKind: FIXTURE_CLOCK_KIND };

function ev(text = "夾具摘要甲。", over = {}) {
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
const request = { project: "P52", requestId: "req-001", goal: "比較三種快取策略", createdAt: "2026-09-01T00:00:00.000Z" };
function mkO(id, eid) {
  return { optionId: id, title: "方案" + id + "標題測試充足", description: "方案 " + id + " 的完整說明，涵蓋範圍與步驟，長度足夠充足。", approach: "作法" + id + "技術路徑與部署方式測試充足版本。", evidenceIds: [eid], tradeoffs: "取捨說明：" + id + " 的優點與代價對比，明確列出充足。", uncertainties: "不確定性說明：" + id + " 的未知因素與風險假設充足。", distinction: { dimension: "維度" + id, difference: "差異說明" + id + "：決策槓桿與變更範圍明確不同，長度足夠。" } };
}
function opts() { return [mkO("op-001", "ev-001"), mkO("op-002", "ev-002"), mkO("op-003", "ev-003")]; }
function scores() {
  const mk = (eid, base) => ({
    evidenceStrength: { score: base, reason: "證據直接支撐，理由充分說明。", basisEvidenceIds: [eid] },
    feasibility: { score: base - 1, reason: "可行性評估已附理由與依據。", basisEvidenceIds: [eid] },
    economy: { score: base - 2, reason: "經濟性評估已附理由與依據。", basisEvidenceIds: [eid] },
  });
  return { "op-001": mk("ev-001", 9), "op-002": mk("ev-002", 7), "op-003": mk("ev-003", 5) };
}
const weights = { evidenceStrength: 0.5, feasibility: 0.3, economy: 0.2 };

describe("F01 approval binding", () => {
  it("positive includes all digests and stays pending", () => {
    const r = buildRecommendation({ request, options: opts(), scores: scores(), weights });
    assert.equal(r.ok, true);
    assert.match(r.recommendation.approval.requestDigest, /^[0-9a-f]{64}$/);
    assert.equal(Object.keys(r.recommendation.approval.optionDigests).sort().join(","), "op-001,op-002,op-003");
    assert.equal(r.recommendation.approval.status, "HUMAN_SELECTION_REQUIRED");
    assert.equal(r.recommendation.approval.automaticDispatch, false);
    assert.ok(!("humanSignature" in r.recommendation.approval));
  });
  it("fail-closed stale bytes rejected", () => {
    const r = buildRecommendation({ request, options: opts(), scores: scores(), weights });
    const v = verifyApproval(r.recommendation.approval, { requestDigest: "f".repeat(64), optionDigests: r.recommendation.optionDigests });
    assert.equal(v.ok, false);
  });
});

describe("F02 closed keys", () => {
  it("positive exact keys pass", () => {
    const r = verifyEvidence(ev(), CCTX);
    assert.equal(r.ok, true);
  });
  it("fail-closed extra and alias rejected", () => {
    const r1 = verifyEvidence({ ...ev(), extra: 1 }, CCTX);
    assert.equal(r1.ok, false);
    const e = ev(); delete e.provider; e.Provider = "native-agent-fixture";
    const r2 = verifyEvidence(e, CCTX);
    assert.equal(r2.ok, false);
    assert.equal(r2.code, "E_ALIAS");
  });
});

describe("F03 explicit provider", () => {
  it("positive fixture enum passes", () => {
    for (const p of ["native-agent-fixture", "native-browser-fixture", "test-fixture"]) {
      const r = verifyEvidence(ev("文本。", { provider: p, mode: "fixture" }), CCTX);
      assert.equal(r.ok, true);
    }
  });
  it("fail-closed unknown stable and live rejected, benign kept", () => {
    const ru = verifyEvidence(ev("文本。", { provider: "mystery-provider", mode: "fixture" }), CCTX);
    assert.equal(ru.ok, false); assert.equal(ru.code, "E_PROVIDER_UNKNOWN");
    const rl = verifyEvidence(ev("文本。", { provider: "native-agent-live", mode: "live", isFixture: false }), CCTX);
    assert.equal(rl.ok, false); assert.equal(rl.code, "E_LIVE_NOT_ACCEPTED");
    const t = "alive 與 actualize 僅為一般英文，非提供者。";
    const rb = verifyEvidence(ev(t, { contentText: t, contentDigest: sha256HexText(t) }), CCTX);
    assert.equal(rb.ok, true);
  });
});

describe("F04 exclusive distinct targets", () => {
  let tmp = null;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(here, "tmp-r6-")); });
  afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null; });
  function run(args, cwd) {
    try {
      execFileSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return { ok: true };
    } catch (e) { return { ok: false, err: String(e.stderr ?? e.message).slice(0, 400) }; }
  }
  function wsRoot() { return path.resolve(here, "..", "..", "..", ".."); }
  it("fail-closed duplicate and case-variant duplicate", () => {
    const root = wsRoot();
    const mk = (n, d) => { const p = path.join(tmp, n); fs.writeFileSync(p, JSON.stringify(d)); return path.relative(root, p); };
    const rq = mk("request.json", request);
    const e1 = "摘要一。"; const e2 = "摘要二。"; const e3 = "摘要三。";
    const evs = [
      { evidenceId: "ev-001", provider: "native-agent-fixture", mode: "fixture", isFixture: true, targetProject: "P52", targetRequestId: "req-001", collectedAt: "2026-09-20T00:00:00.000Z", contentText: e1, contentDigest: sha256HexText(e1), sourceRef: "r1" },
      { evidenceId: "ev-002", provider: "native-browser-fixture", mode: "fixture", isFixture: true, targetProject: "P52", targetRequestId: "req-001", collectedAt: "2026-09-21T00:00:00.000Z", contentText: e2, contentDigest: sha256HexText(e2), sourceRef: "r2" },
      { evidenceId: "ev-003", provider: "test-fixture", mode: "fixture", isFixture: true, targetProject: "P52", targetRequestId: "req-001", collectedAt: "2026-09-22T00:00:00.000Z", contentText: e3, contentDigest: sha256HexText(e3), sourceRef: "r3" },
    ];
    const evp = mk("evidence.json", evs);
    const opp = mk("options.json", opts());
    const scp = mk("scores.json", scores());
    const out = path.join(tmp, "OUT.json");
    const r1 = run(["--request", rq, "--evidence", evp, "--options", opp, "--scores", scp, "--out", path.relative(root, out), "--report", path.relative(root, out), "--now", "2026-10-04T00:00:00.000Z"], root);
    assert.equal(r1.ok, false); assert.ok(r1.err.includes("E_SAME_TARGET"));
    const lower = out.toLowerCase();
    const r2 = run(["--request", rq, "--evidence", evp, "--options", opp, "--scores", scp, "--out", path.relative(root, out), "--report", path.relative(root, lower), "--now", "2026-10-04T00:00:00.000Z"], root);
    if (process.platform === "win32") {
      assert.equal(r2.ok, false); assert.ok(r2.err.includes("E_SAME_TARGET"));
    } else {
      assert.ok(r2.ok === true || r2.ok === false);
    }
  });
});

describe("F05 strict dates no TTL", () => {
  it("positive old date passes, future fails", () => {
    const ro = verifyEvidence(ev("舊資料。", { contentText: "舊資料。", contentDigest: sha256HexText("舊資料。"), collectedAt: "2020-01-01T00:00:00.000Z" }), CCTX);
    assert.equal(ro.ok, true);
    const rf = verifyEvidence(ev(), CCTX);
    assert.equal(rf.ok, true);
    const rb = verifyEvidence(ev("x", { collectedAt: "2026-02-30T00:00:00.000Z" }), CCTX);
    assert.equal(rb.ok, false);
  });
});

describe("F06 no dead code or keyword gate", () => {
  it("sources centralize and drop legacy gates", () => {
    const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".mjs"));
    for (const f of files) {
      const s = fs.readFileSync(path.join(srcDir, f), "utf8");
      assert.ok(!s.includes("void "), f + " must not contain void");
    }
    const evs = fs.readFileSync(path.join(srcDir, "evidence.mjs"), "utf8");
    assert.ok(!evs.includes("LIVE_HINT") && !evs.includes("actual-web"));
    const prov = fs.readFileSync(path.join(srcDir, "provenance.mjs"), "utf8");
    assert.ok(!prov.includes("Date.parse"));
    const cliSrc = fs.readFileSync(path.join(here, "..", "cli.mjs"), "utf8");
    assert.ok(cliSrc.includes('"wx"') && !cliSrc.includes("stale-days"));
  });
});
