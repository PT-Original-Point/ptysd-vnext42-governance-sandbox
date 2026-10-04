#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { MAX_JSON_BYTES, canonicalDigest, parseStrictUtcMs } from "./src/provenance.mjs";
import { verifyEvidenceList, FIXTURE_CLOCK_KIND } from "./src/evidence.mjs";
import { validateAlternatives } from "./src/alternatives.mjs";
import { validateRequestShape, normalizeWeights, buildRecommendation, attachRationale } from "./src/recommendation.mjs";
import { buildReportZh } from "./src/report.mjs";

const ALLOWED_FLAGS = new Set(["--request", "--evidence", "--options", "--scores", "--weights", "--out", "--report", "--now", "--rationale", "--help"]);

function fail(code, msg) {
  process.stderr.write(`ERROR[${code}] ${msg}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help") { out.help = true; continue; }
    if (!ALLOWED_FLAGS.has(a)) fail("E_FLAG", "unknown flag");
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) fail("E_FLAG", "missing value");
    out[a.slice(2)] = v;
    i++;
  }
  return out;
}

function canonicalForCompare(p) {
  let r = path.normalize(path.resolve(p));
  if (process.platform === "win32") r = r.toLowerCase();
  return r;
}

function isWithin(workspace, target) {
  const w = canonicalForCompare(workspace);
  const t = canonicalForCompare(target);
  return t === w || t.startsWith(w + path.sep);
}

function resolveContained(cwd, p) {
  const r = path.resolve(cwd, p);
  if (!isWithin(cwd, r)) fail("E_PATH", "path outside workspace");
  return r;
}

function checkAncestors(abs, workspace) {
  if (!isWithin(workspace, abs)) fail("E_PATH", "path outside workspace");
  const wCanon = canonicalForCompare(workspace);
  let cur = canonicalForCompare(abs);
  const stack = [];
  while (true) {
    stack.push(cur);
    if (cur === wCanon) break;
    const parent = canonicalForCompare(path.dirname(cur));
    if (parent === cur) break;
    cur = parent;
    if (cur.length < wCanon.length) break;
  }
  for (const prefixCanon of stack) {
    let realPrefix = null;
    try {
      const st = fs.lstatSync(prefixCanon);
      if (st.isSymbolicLink()) fail("E_SYMLINK", "symlink ancestor not allowed");
      try {
        realPrefix = fs.realpathSync(prefixCanon);
      } catch { continue; }
      if (canonicalForCompare(realPrefix) !== prefixCanon) fail("E_SYMLINK", "reparse ancestor not allowed");
    } catch (e) {
      if (e && e.code === "ENOENT") continue;
      if (e && String(e.message || "").startsWith("ERROR[")) throw e;
      continue;
    }
  }
}

function nearestExistingParent(abs) {
  let cur = abs;
  while (true) {
    try {
      fs.lstatSync(cur);
      return cur;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return cur;
      cur = parent;
    }
  }
}

function validateInputFile(abs, workspace) {
  checkAncestors(abs, workspace);
  let st;
  try { st = fs.lstatSync(abs); } catch { fail("E_PATH", "file not found"); }
  if (st.isSymbolicLink()) fail("E_SYMLINK", "symlink not allowed");
  try {
    const rp = fs.realpathSync(abs);
    if (canonicalForCompare(rp) !== canonicalForCompare(abs)) fail("E_SYMLINK", "reparse not allowed");
  } catch { /* ignore */ }
  if (!st.isFile()) fail("E_PATH", "not a file");
  return st;
}

function sameTarget(a, b) {
  return canonicalForCompare(a) === canonicalForCompare(b);
}

function loadJsonBounded(abs, workspace) {
  const st = validateInputFile(abs, workspace);
  if (st.size > MAX_JSON_BYTES) fail("E_BOUND", "file exceeds 64KiB");
  const raw = fs.readFileSync(abs, "utf8");
  if (Buffer.byteLength(raw, "utf8") > MAX_JSON_BYTES) fail("E_BOUND", "file exceeds 64KiB");
  try { return { data: JSON.parse(raw), bytes: st.size }; }
  catch { fail("E_JSON", "invalid JSON"); }
}

function writeExclusive(abs, data, workspace) {
  const parent = path.dirname(abs);
  const near = nearestExistingParent(parent);
  checkAncestors(near, workspace);
  fs.mkdirSync(parent, { recursive: true });
  checkAncestors(parent, workspace);
  try {
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) fail("E_SYMLINK", "symlink not allowed");
    void st;
    fail("E_OVERWRITE", "output exists, refusing overwrite");
  } catch (e) {
    if (e && String(e.message || "").startsWith("ERROR[")) throw e;
  }
  try {
    const rpParent = fs.realpathSync(parent);
    if (canonicalForCompare(rpParent) !== canonicalForCompare(parent)) fail("E_SYMLINK", "reparse parent not allowed");
  } catch { /* ignore */ }
  try {
    fs.writeFileSync(abs, data, { encoding: "utf8", flag: "wx" });
  } catch (e) {
    if (e && (e.code === "EEXIST" || e.code === "EISDIR" || e.code === "EPERM")) fail("E_OVERWRITE", "output exists, refusing overwrite");
    fail("E_PATH", "write failed");
  }
}

function main() {
  const cwd = process.cwd();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write("usage: cli.mjs --request <p> --evidence <p> --options <p> --scores <p> [--weights <p>] --out <p> [--report <p>] --now ISO [--rationale TEXT]\n");
    process.exit(0);
  }
  for (const k of ["request", "evidence", "options", "scores", "out"]) {
    if (!args[k]) fail("E_FLAG", "missing required flag");
  }
  if (!args.now) fail("E_CLOCK", "missing trusted clock");
  if (args.rationale !== undefined && (args.rationale.length < 20 || args.rationale.length > 2000))
    fail("E_FLAG", "rationale 20..2000 chars");
  const nowMs = parseStrictUtcMs(args.now);
  if (nowMs === null) fail("E_DATE_INVALID", "bad --now date");
  const reqPath = resolveContained(cwd, args.request);
  const evPath = resolveContained(cwd, args.evidence);
  const optPath = resolveContained(cwd, args.options);
  const scPath = resolveContained(cwd, args.scores);
  const outPath = resolveContained(cwd, args.out);
  const weightsPath = args.weights ? resolveContained(cwd, args.weights) : null;
  const reportPath = args.report ? resolveContained(cwd, args.report) : null;
  if (reportPath && sameTarget(outPath, reportPath)) fail("E_SAME_TARGET", "out and report must differ");

  const reqJ = loadJsonBounded(reqPath, cwd);
  const evJ = loadJsonBounded(evPath, cwd);
  const optJ = loadJsonBounded(optPath, cwd);
  const scJ = loadJsonBounded(scPath, cwd);
  const wJ = weightsPath ? loadJsonBounded(weightsPath, cwd) : { data: undefined };

  const request = reqJ.data;
  const evidences = evJ.data;
  const options = optJ.data;
  const scores = scJ.data;

  const rq = validateRequestShape(request);
  if (!rq.ok) fail(rq.code, "request invalid");
  if (!Array.isArray(evidences)) fail("E_LACK", "evidence must be array");
  const clockCtx = { expectedProject: request.project, expectedRequestId: request.requestId, nowMs, clockKind: FIXTURE_CLOCK_KIND };
  const evr = verifyEvidenceList(evidences, clockCtx);
  if (!evr.ok) fail(evr.code, "evidence rejected");
  const evidenceMap = new Map(evidences.map((e) => [e.evidenceId, e]));
  const alt = validateAlternatives(options, evidenceMap);
  if (!alt.ok) fail(alt.code, "options rejected");
  const wres = normalizeWeights(wJ.data);
  if (!wres.ok) fail(wres.code, "weights invalid");
  const bres = buildRecommendation({ request, options, scores, weights: wJ.data });
  if (!bres.ok) fail(bres.code, "recommendation rejected");
  const rec = bres.recommendation;
  const defaultRationale = rec.weightsDefaulted
    ? `基於已驗證夾具證據與預設權重排序，${rec.ranking[0].optionId} 總分最高；取捨與不確定性已列明，仍需人工選定。`
    : `基於已驗證夾具證據與用戶權重排序，${rec.ranking[0].optionId} 總分最高；取捨與不確定性已列明，仍需人工選定。`;
  const rationale = args.rationale ?? defaultRationale;
  const ar = attachRationale(rec, rationale);
  if (!ar.ok) fail(ar.code, "rationale invalid");

  const output = {
    kind: "P52_RESEARCH_OPTIONS",
    isFixture: true,
    fixtureNote: "僅測試夾具，非實際研究；摘要僅綁定位元組，不證明人工身分。",
    clock: { kind: FIXTURE_CLOCK_KIND, now: args.now, note: "確定性夾具時鐘，非實際可信觀測；未來實際路徑另行注入運行時鐘。" },
    project: request.project,
    requestId: request.requestId,
    requestDigest: rec.requestDigest,
    optionDigests: rec.optionDigests,
    evidenceCount: evidences.length,
    ranking: rec.ranking,
    recommendedOptionId: rec.recommendedOptionId,
    rationale: rec.rationale,
    weights: rec.weights,
    weightsDefaulted: rec.weightsDefaulted,
    approval: rec.approval,
  };
  output.outputDigest = canonicalDigest({ requestDigest: output.requestDigest, optionDigests: output.optionDigests, ranking: output.ranking });

  writeExclusive(outPath, JSON.stringify(output, null, 2) + "\n", cwd);
  if (reportPath) {
    writeExclusive(reportPath, buildReportZh({ request, evidences, options, recommendation: rec }), cwd);
  }
  process.stdout.write(`OK requestDigest=${rec.requestDigest.slice(0, 12)} options=${options.length} recommended=${rec.recommendedOptionId}\n`);
}

main();
