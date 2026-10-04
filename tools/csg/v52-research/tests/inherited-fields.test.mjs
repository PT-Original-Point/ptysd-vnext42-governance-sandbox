import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRecommendation } from "../src/recommendation.mjs";

const optionIds = ["op-001", "op-002", "op-003"];
const evidenceIds = ["ev-001", "ev-002", "ev-003"];
const weights = { evidenceStrength: 0.5, feasibility: 0.3, economy: 0.2 };

function record(values, nullPrototype = false) {
  return Object.assign(Object.create(nullPrototype ? null : Object.prototype), values);
}

function buildInputs({ nullPrototype = false } = {}) {
  const make = (values) => record(values, nullPrototype);
  const request = make({
    project: "P52",
    requestId: "req-001",
    goal: "比較三種快取策略",
    createdAt: "2026-09-01T00:00:00.000Z",
  });
  const options = optionIds.map((optionId, i) => make({
    optionId,
    title: `方案${i + 1}：不同架構路徑測試` ,
    description: `方案 ${optionId} 的完整說明，涵蓋範圍與步驟，長度足夠。`,
    approach: `作法${i + 1}：採用不同技術路徑與部署方式。`,
    evidenceIds: [evidenceIds[i]],
    tradeoffs: `取捨說明：${optionId} 的優點與代價對比，明確列出。`,
    uncertainties: `不確定性說明：${optionId} 的未知因素與風險假設。`,
    distinction: make({
      dimension: `決策維度${i + 1}`,
      difference: `差異說明：${optionId} 改變不同決策槓桿與範圍，描述足夠。`,
    }),
  }));
  const scores = make({});
  for (let i = 0; i < optionIds.length; i++) {
    const score = 9 - i * 2;
    const entry = (value) => make({
      score: value,
      reason: "評分理由足夠長度並明確說明。",
      basisEvidenceIds: [evidenceIds[i]],
    });
    scores[optionIds[i]] = make({
      evidenceStrength: entry(score),
      feasibility: entry(score - 1),
      economy: entry(score - 2),
    });
  }
  return {
    request,
    options,
    scores,
    weights: make(weights),
  };
}

function build(inputs) {
  return buildRecommendation(inputs);
}

describe("exported builder own-field closure", () => {
  it("accepts ordinary and null-prototype records with own required fields", () => {
    assert.equal(build(buildInputs()).ok, true);
    assert.equal(build(buildInputs({ nullPrototype: true })).ok, true);
  });

  it("rejects inherited weights and inherited nested score entries", () => {
    const inheritedWeights = buildInputs();
    inheritedWeights.weights = Object.create(weights);
    assert.equal(build(inheritedWeights).ok, false);

    const inheritedScores = buildInputs();
    const parentEntry = {
      score: 9,
      reason: "評分理由足夠長度並明確說明。",
      basisEvidenceIds: [evidenceIds[0]],
    };
    inheritedScores.scores[optionIds[0]].evidenceStrength = Object.create(parentEntry);
    assert.equal(build(inheritedScores).ok, false);
  });

  it("rejects inherited values filling each missing mandatory weight or score key", () => {
    for (const key of Object.keys(weights)) {
      const input = buildInputs();
      const parent = { [key]: weights[key] };
      const own = { ...weights };
      delete own[key];
      input.weights = Object.assign(Object.create(parent), own);
      assert.equal(build(input).ok, false, `inherited weight ${key}`);
    }

    const entryFields = {
      score: 9,
      reason: "評分理由足夠長度並明確說明。",
      basisEvidenceIds: [evidenceIds[0]],
    };
    for (const key of Object.keys(entryFields)) {
      const input = buildInputs();
      const own = { ...entryFields };
      delete own[key];
      const inheritedEntry = Object.assign(Object.create({ [key]: entryFields[key] }), own);
      input.scores[optionIds[0]].evidenceStrength = inheritedEntry;
      assert.equal(build(input).ok, false, `inherited score field ${key}`);
    }
  });

  it("rejects unknown own keys in weights and nested score entries", () => {
    const extraWeight = buildInputs();
    extraWeight.weights.extra = 0;
    assert.equal(build(extraWeight).ok, false);

    const extraScore = buildInputs();
    extraScore.scores[optionIds[0]].evidenceStrength.extra = true;
    assert.equal(build(extraScore).ok, false);
  });

  it("rejects inherited unknown properties on schema records", () => {
    const input = buildInputs();
    input.weights = Object.assign(Object.create({ unknown: true }), weights);
    assert.equal(build(input).ok, false);
  });
});
