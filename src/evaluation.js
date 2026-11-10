/**
 * Scoring functions for the baseline-vs-LLM experiment.
 * Plain functions (no database or API calls) so they can be unit tested.
 */

const { baselineMastery, llmLearnerState, selectNextQuestion } = require('./learnerModel');

const LABELS = ['correct', 'partial', 'incorrect', 'misconception'];

// --------------------------------------------------
// What each method "says" about one labeled response
// --------------------------------------------------

// The baseline only knows the binary right/wrong grade, so it can never
// output "partial" or "misconception" and can never name a misconception.
function baselinePrediction(item) {
  return {
    responseType: item.baselineCorrect ? 'correct' : 'incorrect',
    gapDetected: !item.baselineCorrect,
    misconceptionCode: null,
  };
}

function llmPrediction(run) {
  return {
    responseType: run.responseType,
    gapDetected: run.responseType !== 'correct',
    misconceptionCode: run.misconceptionCode || null,
  };
}

// --------------------------------------------------
// Metrics
// --------------------------------------------------

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

// pairs: [{ truth: boolean, predicted: boolean }]
function binaryMetrics(pairs) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const { truth, predicted } of pairs) {
    if (truth && predicted) tp += 1;
    else if (!truth && predicted) fp += 1;
    else if (truth && !predicted) fn += 1;
    else tn += 1;
  }
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const f1 = precision && recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { n: pairs.length, tp, fp, fn, tn, accuracy: ratio(tp + tn, pairs.length), precision, recall, f1 };
}

// pairs: [{ truth: label, predicted: label }]
function confusionMatrix(pairs, labels = LABELS) {
  const matrix = Object.fromEntries(labels.map((t) => [t, Object.fromEntries(labels.map((p) => [p, 0]))]));
  for (const { truth, predicted } of pairs) {
    if (matrix[truth] && matrix[truth][predicted] !== undefined) matrix[truth][predicted] += 1;
  }
  return matrix;
}

function accuracy(pairs) {
  return ratio(pairs.filter((p) => p.truth === p.predicted).length, pairs.length);
}

// pairs: [{ truth: code|null, predicted: code|null }]
// A prediction only counts as a true positive if it names the RIGHT misconception.
function misconceptionMetrics(pairs) {
  let tp = 0, fp = 0, fn = 0;
  for (const { truth, predicted } of pairs) {
    if (predicted && predicted === truth) tp += 1;
    else {
      if (predicted) fp += 1;
      if (truth) fn += 1;
    }
  }
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const f1 = precision && recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { n: pairs.length, tp, fp, fn, precision, recall, f1 };
}

function mean(values) {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

// Share of runs that agree with the most common answer (1 = always the same)
function modeAgreement(values) {
  const counts = {};
  for (const v of values) counts[String(v)] = (counts[String(v)] || 0) + 1;
  return Math.max(...Object.values(counts)) / values.length;
}

// runsByItem: { [itemId]: [run, run, ...] } (successful runs only)
function consistencyMetrics(runsByItem) {
  const items = Object.values(runsByItem).filter((runs) => runs.length >= 2);
  const typeAgreement = items.map((runs) => modeAgreement(runs.map((r) => r.responseType)));
  const codeAgreement = items.map((runs) => modeAgreement(runs.map((r) => r.misconceptionCode || null)));
  const levelStd = items.map((runs) => standardDeviation(runs.map((r) => r.understandingLevel)));

  return {
    itemsWithRepeats: items.length,
    meanResponseTypeAgreement: mean(typeAgreement),
    meanMisconceptionAgreement: mean(codeAgreement),
    fullyConsistentItems: items.filter((runs, i) => typeAgreement[i] === 1 && codeAgreement[i] === 1).length,
    meanUnderstandingLevelStd: mean(levelStd),
  };
}

// --------------------------------------------------
// Scenario evaluation: does each method pick a relevant follow-up question?
// scenario: { id, responses: [itemId], targetConceptId, targetMisconceptionCode }
// --------------------------------------------------
function evaluateScenario(scenario, itemsById, runByItemId, curriculum) {
  const questionById = Object.fromEntries(curriculum.questions.map((q) => [q.id, q]));
  const items = scenario.responses.map((id) => itemsById[id]);

  const attempts = items.map((item) => ({
    question_id: item.questionId,
    concept_id: questionById[item.questionId].concept_id,
    is_correct: item.baselineCorrect,
  }));

  const analyses = items
    .filter((item) => runByItemId[item.id])
    .map((item) => ({
      question_id: item.questionId,
      concept_id: questionById[item.questionId].concept_id,
      understanding_level: runByItemId[item.id].understandingLevel,
      misconception_code: runByItemId[item.id].misconceptionCode || null,
      response_type: runByItemId[item.id].responseType,
    }));

  const answeredQuestionIds = items.map((item) => item.questionId);
  const llmState = llmLearnerState(analyses, curriculum.misconceptions, curriculum.questions);

  const selections = {
    baseline: selectNextQuestion({
      ...curriculum,
      answeredQuestionIds,
      mastery: baselineMastery(attempts),
    }),
    llm: selectNextQuestion({
      ...curriculum,
      answeredQuestionIds,
      mastery: llmState.mastery,
      activeMisconceptions: llmState.activeMisconceptions,
    }),
  };

  const targetMisconception = curriculum.misconceptions.find(
    (m) => m.code === scenario.targetMisconceptionCode
  );

  const score = (selection) => ({
    questionId: selection ? selection.question.id : null,
    conceptId: selection ? selection.conceptId : null,
    rule: selection ? selection.rule : null,
    reason: selection ? selection.reason : null,
    conceptHit: Boolean(selection && selection.conceptId === scenario.targetConceptId),
    probeHit: targetMisconception
      ? Boolean(selection && selection.question.probes_misconception_id === targetMisconception.id)
      : null,
    // Asking a misconception probe when the learner has no (catalog) misconception
    falseProbe: targetMisconception ? null : Boolean(selection && selection.rule === 'misconception-probe'),
  });

  return {
    scenarioId: scenario.id,
    description: scenario.description,
    targetConceptId: scenario.targetConceptId,
    targetMisconceptionCode: scenario.targetMisconceptionCode || null,
    baselineScore: Math.round((attempts.filter((a) => a.is_correct).length / attempts.length) * 100),
    baseline: score(selections.baseline),
    llm: score(selections.llm),
  };
}

// --------------------------------------------------
// Statistics added for the final evaluation (Weeks 10-12)
// --------------------------------------------------

// One prediction per item: the most common (responseType, misconceptionCode)
// pair across runs. Ties go to the earliest run, so the result is deterministic.
function majorityVote(runs) {
  if (!runs || runs.length === 0) return null;
  const key = (r) => `${r.responseType}|${r.misconceptionCode || ''}`;
  const counts = {};
  for (const r of runs) counts[key(r)] = (counts[key(r)] || 0) + 1;
  const best = Math.max(...Object.values(counts));
  const winner = runs.find((r) => counts[key(r)] === best);
  const sameAnswer = runs.filter((r) => key(r) === key(winner));
  return {
    responseType: winner.responseType,
    misconceptionCode: winner.misconceptionCode || null,
    understandingLevel: Math.round(mean(sameAnswer.map((r) => r.understandingLevel))),
    agreement: best / runs.length,
  };
}

// Exact two-sided McNemar test on paired outcomes.
// pairs: [{ a: boolean, b: boolean }] (e.g. a = baseline right, b = LLM right)
// Only discordant pairs matter: b01 = a wrong & b right, b10 = a right & b wrong.
function mcnemarExact(pairs) {
  const b01 = pairs.filter((p) => !p.a && p.b).length;
  const b10 = pairs.filter((p) => p.a && !p.b).length;
  const n = b01 + b10;
  if (n === 0) return { b01, b10, pValue: 1 };
  const k = Math.min(b01, b10);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += binomial(n, i) * 0.5 ** n;
  return { b01, b10, pValue: Math.min(1, 2 * tail) };
}

function binomial(n, k) {
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return result;
}

// Small seeded random generator so bootstrap results are reproducible
function seededRandom(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Percentile bootstrap 95% confidence interval, resampling items.
// statistic(sample) must return a number (or null, which is skipped).
function bootstrapCI(items, statistic, { reps = 2000, seed = 42, level = 0.95 } = {}) {
  if (items.length === 0) return null;
  const random = seededRandom(seed);
  const values = [];
  for (let r = 0; r < reps; r++) {
    const sample = items.map(() => items[Math.floor(random() * items.length)]);
    const value = statistic(sample);
    if (value !== null && Number.isFinite(value)) values.push(value);
  }
  values.sort((a, b) => a - b);
  const lowIndex = Math.floor(((1 - level) / 2) * values.length);
  const highIndex = Math.min(values.length - 1, Math.ceil((1 - (1 - level) / 2) * values.length) - 1);
  return [values[lowIndex], values[highIndex]];
}

// Measures for the robustness set.
// rows: [{ item, pred }] where pred = { responseType, misconceptionCode }
function robustnessMetrics(rows) {
  const rate = (subset, test) => (subset.length ? subset.filter(test).length / subset.length : null);
  const outOfCatalog = rows.filter((r) => r.item.category === 'out_of_catalog');
  const noBelief = rows.filter((r) => r.item.label !== 'misconception');
  const hedged = rows.filter((r) => r.item.category === 'hedged');
  const anyMisconception = rows.filter((r) => r.item.label === 'misconception');

  return {
    // Out-of-catalog misconceptions: the right output is "misconception" with no code
    outOfCatalogN: outOfCatalog.length,
    outOfCatalogFlaggedAsMisconception: rate(outOfCatalog, (r) => r.pred.responseType === 'misconception'),
    outOfCatalogGapDetected: rate(outOfCatalog, (r) => r.pred.responseType !== 'correct'),
    outOfCatalogForcedFit: rate(outOfCatalog, (r) => Boolean(r.pred.misconceptionCode)),
    // Reporting a misconception the learner does not have
    falseMisconceptionRate: rate(noBelief, (r) => r.pred.responseType === 'misconception' || Boolean(r.pred.misconceptionCode)),
    hedgedN: hedged.length,
    hedgedFalseMisconceptionRate: rate(hedged, (r) => r.pred.responseType === 'misconception' || Boolean(r.pred.misconceptionCode)),
    // Any misconception (catalog or not) recognized as a misconception
    misconceptionTypeRecall: rate(anyMisconception, (r) => r.pred.responseType === 'misconception'),
  };
}

// Accuracy per category (or any other key) for one method
function accuracyBy(rows, keyFn) {
  const groups = {};
  for (const r of rows) {
    const k = keyFn(r);
    if (!groups[k]) groups[k] = { n: 0, typeCorrect: 0, gapCorrect: 0 };
    groups[k].n += 1;
    if (r.pred.responseType === r.item.label) groups[k].typeCorrect += 1;
    if (r.pred.gapDetected === (r.item.label !== 'correct')) groups[k].gapCorrect += 1;
  }
  return Object.fromEntries(
    Object.entries(groups).map(([k, g]) => [
      k,
      { n: g.n, responseTypeAccuracy: g.typeCorrect / g.n, gapDetectionAccuracy: g.gapCorrect / g.n },
    ])
  );
}

module.exports = {
  LABELS,
  majorityVote,
  mcnemarExact,
  bootstrapCI,
  seededRandom,
  robustnessMetrics,
  accuracyBy,
  baselinePrediction,
  llmPrediction,
  binaryMetrics,
  confusionMatrix,
  accuracy,
  misconceptionMetrics,
  consistencyMetrics,
  evaluateScenario,
  mean,
  median,
  standardDeviation,
  modeAgreement,
};
