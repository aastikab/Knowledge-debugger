const test = require('node:test');
const assert = require('node:assert');
const ev = require('../src/evaluation');
const { curriculum } = require('./fixtures');

test('binaryMetrics computes precision, recall and F1', () => {
  const m = ev.binaryMetrics([
    { truth: true, predicted: true },
    { truth: true, predicted: false },
    { truth: false, predicted: true },
    { truth: false, predicted: false },
  ]);
  assert.strictEqual(m.accuracy, 0.5);
  assert.strictEqual(m.precision, 0.5);
  assert.strictEqual(m.recall, 0.5);
  assert.strictEqual(m.f1, 0.5);
});

test('misconceptionMetrics only rewards naming the right misconception', () => {
  const m = ev.misconceptionMetrics([
    { truth: 'A', predicted: 'A' },
    { truth: 'A', predicted: 'B' },
    { truth: null, predicted: 'B' },
    { truth: 'C', predicted: null },
    { truth: null, predicted: null },
  ]);
  assert.deepStrictEqual([m.tp, m.fp, m.fn], [1, 2, 2]);
});

test('baseline can never name a misconception or output partial', () => {
  const p = ev.baselinePrediction({ baselineCorrect: true, label: 'misconception' });
  assert.deepStrictEqual(p, { responseType: 'correct', gapDetected: false, misconceptionCode: null });
});

test('consistencyMetrics measures agreement across repeated runs', () => {
  const c = ev.consistencyMetrics({
    a: [
      { responseType: 'correct', misconceptionCode: null, understandingLevel: 90 },
      { responseType: 'correct', misconceptionCode: null, understandingLevel: 90 },
    ],
    b: [
      { responseType: 'partial', misconceptionCode: null, understandingLevel: 50 },
      { responseType: 'incorrect', misconceptionCode: null, understandingLevel: 30 },
    ],
  });
  assert.strictEqual(c.meanResponseTypeAgreement, 0.75);
  assert.strictEqual(c.fullyConsistentItems, 1);
  assert.strictEqual(c.meanUnderstandingLevelStd, 5);
});

test('evaluateScenario: hidden misconception is missed by baseline and probed by LLM', () => {
  const items = {
    a: { id: 'a', questionId: 1, baselineCorrect: true },
    b: { id: 'b', questionId: 3, baselineCorrect: true },
    c: { id: 'c', questionId: 5, baselineCorrect: true },
    d: { id: 'd', questionId: 7, baselineCorrect: true },
    e: { id: 'e', questionId: 9, baselineCorrect: true },
  };
  const good = { responseType: 'correct', understandingLevel: 95, misconceptionCode: null };
  const runs = {
    a: good, b: good, c: good, e: good,
    d: { responseType: 'misconception', understandingLevel: 55, misconceptionCode: 'AUTHN_AUTHZ_CONFUSION' },
  };
  const result = ev.evaluateScenario(
    { id: 'S', responses: ['a', 'b', 'c', 'd', 'e'], targetConceptId: 5, targetMisconceptionCode: 'AUTHN_AUTHZ_CONFUSION' },
    items, runs, curriculum
  );
  assert.strictEqual(result.baselineScore, 100);
  assert.strictEqual(result.baseline.conceptHit, false);
  assert.strictEqual(result.llm.conceptHit, true);
  assert.strictEqual(result.llm.probeHit, true);
});
