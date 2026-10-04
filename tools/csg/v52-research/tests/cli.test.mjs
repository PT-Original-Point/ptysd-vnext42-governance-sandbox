import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sha256HexText } from "../src/provenance.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "cli.mjs");
function req() { return { project: "P52", requestId: "req-001", goal: "比較三種快取策略", createdAt: "2026-09-01T00:00:00.000Z" }; }
function evList() {
  const t1 = "原生代理夾具摘要一：邊緣快取。";
  const t2 = "原生瀏覽器夾具摘要二：源站直讀。";
  const t3 = "測試夾具摘要三：混合分層。";
  return [
    { evidenceId: "ev-001", provider: "native-agent-fixture", mode: "fixture", isFixture: true, targetProject: "P52", targetRequestId: "req-001", collectedAt: "2026-09-20T00:00:00.000Z", contentText: t1, contentDigest: sha256HexText(t1), sourceRef: "native-record-001" },
    { evidenceId: "ev-002", provider: "native-browser-fixture", mode: "fixture", isFixture: true, targetProject: "P52", targetRequestId: "req-001", collectedAt: "2026-09-21T00:00:00.000Z", contentText: t2, contentDigest: sha256HexText(t2), sourceRef: "native-record-002" },
    { evidenceId: "ev-003", provider: "test-fixture", mode: "fixture", isFixture: true, targetProject: "P52", targetRequestId: "req-001", collectedAt: "2026-09-22T00:00:00.000Z", contentText: t3, contentDigest: sha256HexText(t3), sourceRef: "native-record-003" },
  ];
}
function optList() {
  return [
    { optionId: "op-001", title: "方案一：邊緣快取架構路徑甲", description: "方案 op-001 的完整說明，涵蓋範圍與步驟，長度足夠。", approach: "作法一：邊緣節點快取的技術路徑與部署方式甲。", evidenceIds: ["ev-001"], distinction: { dimension: "維度op-001", difference: "差異說明op-001：決策槓桿與變更範圍明確不同，長度足夠。" }, tradeoffs: "取捨說明：op-001 的優點與代價對比，明確列出。", uncertainties: "不確定性說明：op-001 的未知因素與風險假設。" },
    { optionId: "op-002", title: "方案二：源站直讀架構路徑乙", description: "方案 op-002 的完整說明，涵蓋範圍與步驟，長度足夠。", approach: "作法二：源站直讀強一致的技術路徑與部署方式乙。", evidenceIds: ["ev-002"], distinction: { dimension: "維度op-002", difference: "差異說明op-002：決策槓桿與變更範圍明確不同，長度足夠。" }, tradeoffs: "取捨說明：op-002 的優點與代價對比，明確列出。", uncertainties: "不確定性說明：op-002 的未知因素與風險假設。" },
    { optionId: "op-003", title: "方案三：混合分層架構路徑丙", description: "方案 op-003 的完整說明，涵蓋範圍與步驟，長度足夠。", approach: "作法三：混合分層冷熱分離的技術路徑與部署方式丙。", evidenceIds: ["ev-003"], distinction: { dimension: "維度op-003", difference: "差異說明op-003：決策槓桿與變更範圍明確不同，長度足夠。" }, tradeoffs: "取捨說明：op-003 的優點與代價對比，明確列出。", uncertainties: "不確定性說明：op-003 的未知因素與風險假設。" },
  ];
}
function scoreObj() {
  const mk = (ev, base) => ({
    evidenceStrength: { score: base, reason: "證據直接支撐，理由充分說明。", basisEvidenceIds: [ev] },
    feasibility: { score: base - 1, reason: "可行性評估已附理由與依據。", basisEvidenceIds: [ev] },
    economy: { score: base - 2, reason: "經濟性評估已附理由與依據。", basisEvidenceIds: [ev] },
  });
  return { "op-001": mk("ev-001", 9), "op-002": mk("ev-002", 7), "op-003": mk("ev-003", 5) };
}

let tmp = null;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(here, "tmp-cli-")); });
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null; });

function write(name, data) { const p = path.join(tmp, name); fs.writeFileSync(p, JSON.stringify(data)); return p; }
function run(args, cwd) {
  try {
    const out = execFileSync(process.execPath, [cli, ...args], { cwd: cwd ?? path.resolve(here, "..", "..", "..", ".."), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, out };
  } catch (e) { return { ok: false, err: String(e.stderr ?? e.message).slice(0, 500), code: e.status }; }
}
function wsRoot() { return path.resolve(here, "..", "..", "..", ".."); }

describe("cli positive", () => {
  it("end-to-end fixture produces HUMAN_SELECTION_REQUIRED", () => {
    const root = wsRoot();
    const rel = (p) => path.relative(root, p);
    const rq = write("request.json", req());
    const ev = write("evidence.json", evList());
    const op = write("options.json", optList());
    const sc = write("scores.json", scoreObj());
    const out = path.join(tmp, "out.json");
    const rep = path.join(tmp, "report.md");
    const r = run(["--request", rel(rq), "--evidence", rel(ev), "--options", rel(op), "--scores", rel(sc), "--out", rel(out), "--report", rel(rep), "--now", "2026-10-04T00:00:00.000Z"], root);
    assert.equal(r.ok, true);
    const j = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.equal(j.approval.status, "HUMAN_SELECTION_REQUIRED");
    assert.equal(j.approval.automaticDispatch, false);
    assert.match(j.approval.requestDigest, /^[0-9a-f]{64}$/);
    assert.equal(Object.keys(j.approval.optionDigests).length, 3);
    assert.equal(j.isFixture, true);
    assert.equal(j.ranking.length, 3);
    const md = fs.readFileSync(rep, "utf8");
    assert.ok(md.includes("HUMAN_SELECTION_REQUIRED"));
  });
  it("old date passes without TTL", () => {
    const root = wsRoot(); const rel = (p) => path.relative(root, p);
    const evs = evList(); evs[0] = { ...evs[0], collectedAt: "2025-01-01T00:00:00.000Z" };
    const rq = write("request.json", req());
    const ev = write("evidence.json", evs);
    const op = write("options.json", optList());
    const sc = write("scores.json", scoreObj());
    const out = path.join(tmp, "out.json");
    const r = run(["--request", rel(rq), "--evidence", rel(ev), "--options", rel(op), "--scores", rel(sc), "--out", rel(out), "--now", "2026-10-04T00:00:00.000Z"], root);
    assert.equal(r.ok, true);
  });
});

describe("cli fail-closed", () => {
  it("rejects unknown flag", () => {
    const r = run(["--nope", "x"], wsRoot());
    assert.equal(r.ok, false);
    assert.ok(r.err.includes("E_FLAG"));
  });
  it("rejects removed TTL flag", () => {
    const root = wsRoot(); const rel = (p) => path.relative(root, p);
    const rq = write("request.json", req());
    const ev = write("evidence.json", evList());
    const op = write("options.json", optList());
    const sc = write("scores.json", scoreObj());
    const out = path.join(tmp, "out.json");
    const r = run(["--request", rel(rq), "--evidence", rel(ev), "--options", rel(op), "--scores", rel(sc), "--out", rel(out), "--now", "2026-10-04T00:00:00.000Z", "--stale-days", "90"], root);
    assert.equal(r.ok, false);
    assert.ok(r.err.includes("E_FLAG"));
  });
  it("refuses overwrite exclusive", () => {
    const root = wsRoot();
    const rel = (p) => path.relative(root, p);
    const rq = write("request.json", req());
    const ev = write("evidence.json", evList());
    const op = write("options.json", optList());
    const sc = write("scores.json", scoreObj());
    const out = path.join(tmp, "out.json");
    fs.writeFileSync(out, "{}");
    const r = run(["--request", rel(rq), "--evidence", rel(ev), "--options", rel(op), "--scores", rel(sc), "--out", rel(out), "--now", "2026-10-04T00:00:00.000Z"], root);
    assert.equal(r.ok, false);
    assert.ok(r.err.includes("E_OVERWRITE") || r.err.includes("E_SYMLINK"));
  });
  it("rejects duplicate out report target", () => {
    const root = wsRoot(); const rel = (p) => path.relative(root, p);
    const rq = write("request.json", req());
    const ev = write("evidence.json", evList());
    const op = write("options.json", optList());
    const sc = write("scores.json", scoreObj());
    const out = path.join(tmp, "same.json");
    const r = run(["--request", rel(rq), "--evidence", rel(ev), "--options", rel(op), "--scores", rel(sc), "--out", rel(out), "--report", rel(out), "--now", "2026-10-04T00:00:00.000Z"], root);
    assert.equal(r.ok, false);
    assert.ok(r.err.includes("E_SAME_TARGET"));
  });
  it("rejects path outside workspace", () => {
    const outside = path.join(os.tmpdir(), "p52-outside.json");
    const root = wsRoot();
    const rq = path.join(tmp, "request.json"); fs.writeFileSync(rq, JSON.stringify(req()));
    const rel = (p) => path.relative(root, p);
    const ev = write("evidence.json", evList());
    const op = write("options.json", optList());
    const sc = write("scores.json", scoreObj());
    const r = run(["--request", rel(rq), "--evidence", rel(ev), "--options", rel(op), "--scores", rel(sc), "--out", outside, "--now", "2026-10-04T00:00:00.000Z"], root);
    assert.equal(r.ok, false);
    assert.ok(r.err.includes("E_PATH"));
  });
  it("rejects non-UTC now", () => {
    const root = wsRoot(); const rel = (p) => path.relative(root, p);
    const rq = write("request.json", req());
    const ev = write("evidence.json", evList());
    const op = write("options.json", optList());
    const sc = write("scores.json", scoreObj());
    const out = path.join(tmp, "out.json");
    const r = run(["--request", rel(rq), "--evidence", rel(ev), "--options", rel(op), "--scores", rel(sc), "--out", rel(out), "--now", "2026/10/04"], root);
    assert.equal(r.ok, false);
    assert.ok(r.err.includes("E_DATE_INVALID"));
  });
  it("rejects missing trusted now", () => {
    const root = wsRoot(); const rel = (p) => path.relative(root, p);
    const rq = write("request.json", req());
    const ev = write("evidence.json", evList());
    const op = write("options.json", optList());
    const sc = write("scores.json", scoreObj());
    const out = path.join(tmp, "out.json");
    const r = run(["--request", rel(rq), "--evidence", rel(ev), "--options", rel(op), "--scores", rel(sc), "--out", rel(out)], root);
    assert.equal(r.ok, false);
    assert.ok(r.err.includes("E_CLOCK"));
  });
});
