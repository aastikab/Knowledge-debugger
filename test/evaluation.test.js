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

test('majorityVote picks the most common answer and breaks ties by earliest run', () => {
  const vote = ev.majorityVote([
    { responseType: 'partial', misconceptionCode: null, understandingLevel: 40 },
    { responseType: 'misconception', misconceptionCode: 'X', understandingLevel: 20 },
    { responseType: 'partial', misconceptionCode: null, understandingLevel: 50 },
  ]);
  assert.strictEqual(vote.responseType, 'partial');
  assert.strictEqual(vote.understandingLevel, 45);
  assert.ok(Math.abs(vote.agreement - 2 / 3) < 1e-9);

  const tie = ev.majorityVote([
    { responseType: 'incorrect', misconceptionCode: null, understandingLevel: 10 },
    { responseType: 'correct', misconceptionCode: null, understandingLevel: 90 },
  ]);
  assert.strictEqual(tie.responseType, 'incorrect');
});

test('mcnemarExact uses only discordant pairs', () => {
  // 6 pairs where only the second method is right, 0 the other way: p = 2 * 0.5^6
  const pairs = [
    ...Array(6).fill({ a: false, b: true }),
    ...Array(10).fill({ a: true, b: true }),
  ];
  const result = ev.mcnemarExact(pairs);
  assert.deepStrictEqual([result.b01, result.b10], [6, 0]);
  assert.strictEqual(result.pValue, 2 * 0.5 ** 6);
  assert.strictEqual(ev.mcnemarExact([{ a: true, b: true }]).pValue, 1);
});

test('bootstrapCI is reproducible and brackets the sample mean', () => {
  const data = [1, 1, 1, 0, 1, 0, 1, 1, 0, 1];
  const a = ev.bootstrapCI(data, (s) => ev.mean(s));
  const b = ev.bootstrapCI(data, (s) => ev.mean(s));
  assert.deepStrictEqual(a, b);
  assert.ok(a[0] <= 0.7 && a[1] >= 0.7);
});

test('robustnessMetrics separates out-of-catalog detection from forced fits', () => {
  const rows = [
    { item: { category: 'out_of_catalog', label: 'misconception' }, pred: { responseType: 'misconception', misconceptionCode: null } },
    { item: { category: 'out_of_catalog', label: 'misconception' }, pred: { responseType: 'misconception', misconceptionCode: 'WRONG' } },
    { item: { category: 'hedged', label: 'partial' }, pred: { responseType: 'misconception', misconceptionCode: null } },
    { item: { category: 'hedged', label: 'correct' }, pred: { responseType: 'correct', misconceptionCode: null } },
  ];
  const m = ev.robustnessMetrics(rows);
  assert.strictEqual(m.outOfCatalogFlaggedAsMisconception, 1);
  assert.strictEqual(m.outOfCatalogForcedFit, 0.5);
  assert.strictEqual(m.hedgedFalseMisconceptionRate, 0.5);
  assert.strictEqual(m.falseMisconceptionRate, 0.5);
});

test('evaluateScenario flags a probe asked when the learner has no misconception', () => {
  const items = {
    a: { id: 'a', questionId: 1, baselineCorrect: true },
    b: { id: 'b', questionId: 3, baselineCorrect: true },
    c: { id: 'c', questionId: 5, baselineCorrect: true },
    d: { id: 'd', questionId: 7, baselineCorrect: true },
    e: { id: 'e', questionId: 10, baselineCorrect: false },
  };
  const good = { responseType: 'correct', understandingLevel: 95, misconceptionCode: null };
  const runs = {
    a: good, b: good, c: good, d: good,
    // Wrongly reads "can't remember which is which" as authn/authz confusion
    e: { responseType: 'misconception', understandingLevel: 40, misconceptionCode: 'AUTHN_AUTHZ_CONFUSION' },
  };
  const result = ev.evaluateScenario(
    { id: 'S', responses: ['a', 'b', 'c', 'd', 'e'], targetConceptId: 5, targetMisconceptionCode: null },
    items, runs, curriculum
  );
  assert.strictEqual(result.llm.probeHit, null);
  assert.strictEqual(result.llm.falseProbe, true);
  assert.strictEqual(result.baseline.falseProbe, false);
});
