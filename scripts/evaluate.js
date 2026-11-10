/**
 * Baseline-vs-LLM experiment.
 *
 * Runs every labeled response in data/eval_responses.json through the LLM
 * (several times, to measure consistency), compares both learner models
 * against the labels, replays the learner scenarios in data/eval_scenarios.json
 * to test follow-up question selection, and writes result tables.
 *
 * Usage:
 *   node scripts/evaluate.js                 # 3 runs per response, writes to results/
 *   node scripts/evaluate.js --runs 1        # cheaper single run
 *   node scripts/evaluate.js --resume        # continue after a crash / rate limit
 *   node scripts/evaluate.js --mock          # no API calls; tests the pipeline only
 *   node scripts/evaluate.js --dataset data/robustness_responses.json \
 *        --scenarios data/robustness_scenarios.json --prompt v2 --out results/v2-robustness
 *
 * Options: --runs N, --delay-ms N (pause between API calls), --limit N
 * (only the first N responses), --out DIR, --resume, --mock,
 * --dataset FILE, --scenarios FILE, --prompt v1|v2
 */

require('dotenv').config();
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const pool = require('../src/db');
const { analyzeWrittenAnswer, resolvePromptVersion } = require('../src/llm');
const { loadCurriculum, toPromptCatalog } = require('../src/curriculum');
const ev = require('../src/evaluation');

const ROOT = path.join(__dirname, '..');

function parseArgs(argv) {
  const args = {
    runs: 3, delayMs: 4000, limit: null, out: null, resume: false, mock: false,
    dataset: 'data/eval_responses.json', scenarios: 'data/eval_scenarios.json', prompt: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--runs') args.runs = Number(argv[++i]);
    else if (flag === '--delay-ms') args.delayMs = Number(argv[++i]);
    else if (flag === '--limit') args.limit = Number(argv[++i]);
    else if (flag === '--out') args.out = argv[++i];
    else if (flag === '--resume') args.resume = true;
    else if (flag === '--mock') args.mock = true;
    else if (flag === '--dataset') args.dataset = argv[++i];
    else if (flag === '--scenarios') args.scenarios = argv[++i];
    else if (flag === '--prompt') args.prompt = argv[++i];
    else throw new Error(`Unknown option: ${flag}`);
  }
  // Mock output goes to its own folder so it is never mistaken for real results
  args.out = path.resolve(ROOT, args.out || (args.mock ? 'results-mock' : 'results'));
  if (args.mock) args.delayMs = 0;
  args.prompt = resolvePromptVersion(args.prompt);
  return args;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Pipeline test only: always answers "partial" and never names a misconception
async function mockAnalyze() {
  return {
    understandingSummary: 'MOCK',
    knowledgeGap: null,
    misconception: null,
    misconceptionCode: null,
    responseType: 'partial',
    understandingLevel: 50,
    seemsCorrect: false,
    warnings: [],
    model: 'mock',
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
}

// Retry with growing pauses because the API often returns rate-limit (429)
// or overload (503) errors. Failed calls are recorded and do not count as runs.
async function analyzeWithRetry(analyze, input, attempts = 6) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await analyze(input);
    } catch (error) {
      if (i === attempts) return { error: error.message };
      console.warn(`  call failed (${error.message}); retrying in ${10 * i}s`);
      await sleep(10000 * i);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.out, { recursive: true });

  const curriculum = await loadCurriculum(pool);
  if (curriculum.misconceptions.length === 0) {
    throw new Error('No misconceptions found. Run sql/add_learner_model.sql first.');
  }

  const datasetText = fs.readFileSync(path.resolve(ROOT, args.dataset), 'utf8');
  const dataset = JSON.parse(datasetText);
  const { scenarios } = JSON.parse(fs.readFileSync(path.resolve(ROOT, args.scenarios), 'utf8'));
  const items = args.limit ? dataset.responses.slice(0, args.limit) : dataset.responses;
  const itemsById = Object.fromEntries(dataset.responses.map((item) => [item.id, item]));

  const questionById = Object.fromEntries(curriculum.questions.map((q) => [q.id, q]));
  const conceptById = Object.fromEntries(curriculum.concepts.map((c) => [c.id, c]));
  const catalog = toPromptCatalog(curriculum.misconceptions);

  const missing = dataset.responses.filter((item) => !questionById[item.questionId]);
  if (missing.length > 0) {
    throw new Error(`Dataset refers to questions not in the database: ${missing.map((i) => i.questionId).join(', ')}`);
  }

  // ----- 1. Collect LLM runs (saved after every call) -----
  const rawPath = path.join(args.out, 'raw_runs.json');
  const raw = args.resume && fs.existsSync(rawPath) ? JSON.parse(fs.readFileSync(rawPath, 'utf8')) : {};
  // Never mix prompt versions in one results folder (runs from before
  // versioning existed were made with v1)
  for (const runs of Object.values(raw)) {
    for (const run of runs) {
      if (!run.error && (run.promptVersion || 'v1') !== args.prompt) {
        throw new Error(`${rawPath} holds ${run.promptVersion || 'v1'} runs; use --prompt ${run.promptVersion || 'v1'} or another --out folder.`);
      }
    }
  }
  const analyze = args.mock ? mockAnalyze : analyzeWrittenAnswer;

  for (const item of items) {
    const question = questionById[item.questionId];
    raw[item.id] = raw[item.id] || [];

    while (raw[item.id].filter((r) => !r.error).length < args.runs) {
      const runNumber = raw[item.id].length + 1;
      console.log(`${item.id} run ${runNumber}: "${item.answer.slice(0, 50)}..."`);

      const run = await analyzeWithRetry(analyze, {
        conceptName: conceptById[question.concept_id].name,
        questionText: question.question_text,
        expectedAnswer: question.expected_answer,
        submittedAnswer: item.answer,
        misconceptionCatalog: catalog,
        promptVersion: args.prompt,
      });
      raw[item.id].push(run);
      fs.writeFileSync(rawPath, JSON.stringify(raw, null, 2));

      if (run.error) {
        console.error(`  giving up on ${item.id}: ${run.error}`);
        break;
      }
      await sleep(args.delayMs);
    }
  }

  // ----- 2. Item-level comparison -----
  // allRuns keeps every saved run (used for consistency); okRuns keeps only the
  // first --runs runs so every response has the same weight in the metrics.
  const allRuns = Object.fromEntries(
    items.map((item) => [item.id, (raw[item.id] || []).filter((r) => !r.error)])
  );
  const okRuns = Object.fromEntries(
    Object.entries(allRuns).map(([id, runs]) => [id, runs.slice(0, args.runs)])
  );
  const failedCalls = items.reduce((n, item) => n + (raw[item.id] || []).filter((r) => r.error).length, 0);

  // Every successful LLM run counts as one prediction (= mean over runs)
  const llmRows = items.flatMap((item) =>
    okRuns[item.id].map((run, i) => ({ item, run: i + 1, pred: ev.llmPrediction(run), raw: run }))
  );
  const baselineRows = items.map((item) => ({ item, pred: ev.baselinePrediction(item) }));

  const compare = (rows) => ({
    responseTypeAccuracy: ev.accuracy(rows.map((r) => ({ truth: r.item.label, predicted: r.pred.responseType }))),
    gapDetection: ev.binaryMetrics(rows.map((r) => ({ truth: r.item.label !== 'correct', predicted: r.pred.gapDetected }))),
    misconception: ev.misconceptionMetrics(rows.map((r) => ({ truth: r.item.misconceptionCode, predicted: r.pred.misconceptionCode }))),
    // Gaps a binary grader misses: graded correct, but the label says otherwise
    hiddenGapRecall: ev.binaryMetrics(
      rows
        .filter((r) => r.item.baselineCorrect && r.item.label !== 'correct')
        .map((r) => ({ truth: true, predicted: r.pred.gapDetected }))
    ).recall,
    confusion: ev.confusionMatrix(rows.map((r) => ({ truth: r.item.label, predicted: r.pred.responseType }))),
  });

  const latencies = llmRows.map((r) => r.raw.latencyMs).filter((v) => v != null);
  const inputTokens = llmRows.map((r) => r.raw.inputTokens).filter((v) => v != null);
  const outputTokens = llmRows.map((r) => r.raw.outputTokens).filter((v) => v != null);

  // Item-level view: one prediction per response (majority vote over runs),
  // used for confidence intervals and the paired significance test
  const itemRows = items
    .filter((item) => okRuns[item.id].length > 0)
    .map((item) => {
      const vote = ev.majorityVote(okRuns[item.id]);
      const llm = { ...ev.llmPrediction(vote), agreement: vote.agreement };
      const base = ev.baselinePrediction(item);
      return {
        item,
        llm,
        base,
        llmTypeRight: llm.responseType === item.label,
        baseTypeRight: base.responseType === item.label,
        llmGapRight: llm.gapDetected === (item.label !== 'correct'),
        baseGapRight: base.gapDetected === (item.label !== 'correct'),
      };
    });
  const share = (rows, key) => (rows.length ? rows.filter((r) => r[key]).length / rows.length : null);
  const ci = (key) => ev.bootstrapCI(itemRows, (sample) => share(sample, key));
  const diffCi = (a, b) => ev.bootstrapCI(itemRows, (sample) => share(sample, a) - share(sample, b));

  const itemLevel = {
    n: itemRows.length,
    baselineTypeAccuracy: share(itemRows, 'baseTypeRight'),
    baselineTypeAccuracyCI: ci('baseTypeRight'),
    llmTypeAccuracy: share(itemRows, 'llmTypeRight'),
    llmTypeAccuracyCI: ci('llmTypeRight'),
    typeAccuracyDifferenceCI: diffCi('llmTypeRight', 'baseTypeRight'),
    typeMcNemar: ev.mcnemarExact(itemRows.map((r) => ({ a: r.baseTypeRight, b: r.llmTypeRight }))),
    baselineGapAccuracy: share(itemRows, 'baseGapRight'),
    baselineGapAccuracyCI: ci('baseGapRight'),
    llmGapAccuracy: share(itemRows, 'llmGapRight'),
    llmGapAccuracyCI: ci('llmGapRight'),
    gapAccuracyDifferenceCI: diffCi('llmGapRight', 'baseGapRight'),
    gapMcNemar: ev.mcnemarExact(itemRows.map((r) => ({ a: r.baseGapRight, b: r.llmGapRight }))),
  };

  // Label audit: items flagged as ambiguous are also reported separately
  const ambiguous = items.filter((item) => item.ambiguous).map((item) => item.id);
  const clearLlmRows = llmRows.filter((r) => !r.item.ambiguous);
  const clearBaselineRows = baselineRows.filter((r) => !r.item.ambiguous);

  const hasCategories = items.some((item) => item.category);

  const metrics = {
    generatedAt: new Date().toISOString(),
    mock: args.mock,
    dataset: args.dataset,
    datasetSha256: crypto.createHash('sha256').update(datasetText).digest('hex'),
    promptVersion: args.prompt,
    model: llmRows[0] ? llmRows[0].raw.model : null,
    responses: items.length,
    runsPerResponse: args.runs,
    successfulCalls: llmRows.length,
    failedCalls,
    outputWarnings: llmRows.filter((r) => r.raw.warnings && r.raw.warnings.length).length,
    baseline: compare(baselineRows),
    llm: compare(llmRows),
    itemLevel,
    robustness: {
      baseline: ev.robustnessMetrics(baselineRows),
      llm: ev.robustnessMetrics(llmRows),
    },
    byCategory: hasCategories
      ? {
          baseline: ev.accuracyBy(baselineRows, (r) => r.item.category),
          llm: ev.accuracyBy(llmRows, (r) => r.item.category),
        }
      : null,
    labelAudit: {
      ambiguousItems: ambiguous,
      baselineTypeAccuracyExcludingAmbiguous: ev.accuracy(clearBaselineRows.map((r) => ({ truth: r.item.label, predicted: r.pred.responseType }))),
      llmTypeAccuracyExcludingAmbiguous: ev.accuracy(clearLlmRows.map((r) => ({ truth: r.item.label, predicted: r.pred.responseType }))),
      llmMisconceptionF1ExcludingAmbiguous: ev.misconceptionMetrics(clearLlmRows.map((r) => ({ truth: r.item.misconceptionCode, predicted: r.pred.misconceptionCode }))).f1,
    },
    consistency: ev.consistencyMetrics(allRuns),
    cost: {
      meanLatencyMs: ev.mean(latencies),
      medianLatencyMs: ev.median(latencies),
      maxLatencyMs: latencies.length ? Math.max(...latencies) : null,
      meanInputTokens: ev.mean(inputTokens),
      meanOutputTokens: ev.mean(outputTokens),
      totalTokens: inputTokens.reduce((s, v) => s + v, 0) + outputTokens.reduce((s, v) => s + v, 0),
    },
  };

  // ----- 3. Scenario-level follow-up question selection -----
  // Uses each response's first successful run
  const firstRun = Object.fromEntries(items.map((item) => [item.id, okRuns[item.id][0]]).filter(([, run]) => run));
  const usableScenarios = scenarios.filter((s) => s.responses.every((id) => firstRun[id]));
  const scenarioResults = usableScenarios.map((s) => ev.evaluateScenario(s, itemsById, firstRun, curriculum));

  const hitRate = (method, key) => {
    const scored = scenarioResults.filter((r) => r[method][key] !== null);
    return scored.length ? scored.filter((r) => r[method][key]).length / scored.length : null;
  };
  metrics.scenarios = {
    evaluated: scenarioResults.length,
    skipped: scenarios.length - usableScenarios.length,
    baselineConceptHitRate: hitRate('baseline', 'conceptHit'),
    llmConceptHitRate: hitRate('llm', 'conceptHit'),
    baselineProbeHitRate: hitRate('baseline', 'probeHit'),
    llmProbeHitRate: hitRate('llm', 'probeHit'),
    baselineFalseProbeRate: hitRate('baseline', 'falseProbe'),
    llmFalseProbeRate: hitRate('llm', 'falseProbe'),
  };

  // ----- 4. Write outputs -----
  fs.writeFileSync(path.join(args.out, 'metrics.json'), JSON.stringify(metrics, null, 2));

  writeCsv(path.join(args.out, 'item_results.csv'), llmRows.map((r) => ({
    responseId: r.item.id,
    run: r.run,
    category: r.item.category || '',
    ambiguous: Boolean(r.item.ambiguous),
    questionId: r.item.questionId,
    label: r.item.label,
    trueMisconception: r.item.misconceptionCode,
    baselineCorrect: r.item.baselineCorrect,
    llmResponseType: r.raw.responseType,
    llmMisconception: r.raw.misconceptionCode,
    llmUnderstandingLevel: r.raw.understandingLevel,
    llmGap: r.raw.knowledgeGap,
    latencyMs: r.raw.latencyMs,
    inputTokens: r.raw.inputTokens,
    outputTokens: r.raw.outputTokens,
    answer: r.item.answer,
  })));

  // Failure cases for the qualitative analysis
  writeCsv(path.join(args.out, 'failure_cases.csv'), llmRows
    .filter((r) => r.raw.responseType !== r.item.label || (r.raw.misconceptionCode || null) !== r.item.misconceptionCode)
    .map((r) => ({
      responseId: r.item.id,
      run: r.run,
      category: r.item.category || '',
      label: r.item.label,
      llmResponseType: r.raw.responseType,
      trueMisconception: r.item.misconceptionCode,
      llmMisconception: r.raw.misconceptionCode,
      answer: r.item.answer,
      llmSummary: r.raw.understandingSummary,
      warnings: (r.raw.warnings || []).join('; '),
    })));

  writeCsv(path.join(args.out, 'scenario_results.csv'), scenarioResults.map((r) => ({
    scenario: r.scenarioId,
    description: r.description,
    baselineScore: r.baselineScore,
    targetConcept: conceptById[r.targetConceptId].name,
    targetMisconception: r.targetMisconceptionCode,
    baselineQuestion: r.baseline.questionId,
    baselineRule: r.baseline.rule,
    baselineConceptHit: r.baseline.conceptHit,
    baselineProbeHit: r.baseline.probeHit,
    llmQuestion: r.llm.questionId,
    llmRule: r.llm.rule,
    llmConceptHit: r.llm.conceptHit,
    llmProbeHit: r.llm.probeHit,
    llmFalseProbe: r.llm.falseProbe,
    llmReason: r.llm.reason,
  })));

  fs.writeFileSync(path.join(args.out, 'summary.md'), renderSummary(metrics, scenarioResults, conceptById));
  console.log(`\nDone. Results written to ${args.out}`);
}

// --------------------------------------------------
// Output helpers
// --------------------------------------------------

function writeCsv(filePath, rows) {
  if (rows.length === 0) {
    fs.writeFileSync(filePath, '');
    return;
  }
  const headers = Object.keys(rows[0]);
  const escape = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [headers.join(','), ...rows.map((row) => headers.map((h) => escape(row[h])).join(','))];
  fs.writeFileSync(filePath, lines.join('\n') + '\n');
}

const pct = (value) => (value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(1)}%`);
const range = (ci) => (ci ? `[${(ci[0] * 100).toFixed(1)}, ${(ci[1] * 100).toFixed(1)}]` : '');
const pval = (p) => (p === null || p === undefined ? 'n/a' : p < 0.001 ? '< 0.001' : p.toFixed(3));
const num = (value, digits = 1) => (value === null || value === undefined ? 'n/a' : value.toFixed(digits));

function renderSummary(m, scenarioResults, conceptById) {
  const b = m.baseline;
  const l = m.llm;
  const labels = ev.LABELS;
  const confusionRows = labels
    .map((t) => `| ${t} | ${labels.map((p) => l.confusion[t][p]).join(' | ')} |`)
    .join('\n');
  const yesNo = (v) => (v === null ? '–' : v ? 'yes' : 'no');

  return `# Knowledge Debugger — Evaluation Results
${m.mock ? '\n> **MOCK RUN — pipeline test only. These numbers are not research results.**\n' : ''}
Generated: ${m.generatedAt}
Dataset: \`${m.dataset}\` (sha256 ${m.datasetSha256.slice(0, 12)}) · Prompt: ${m.promptVersion}
Model: ${m.model} · Responses: ${m.responses} · Runs per response: ${m.runsPerResponse} · Successful LLM calls: ${m.successfulCalls} · Failed calls: ${m.failedCalls} · Outputs needing correction: ${m.outputWarnings}

## 1. Knowledge-gap and misconception detection

LLM figures are pooled over all runs (equivalent to the mean over runs).

| Metric | Baseline (correct/incorrect) | LLM-assisted |
|---|---|---|
| Response-type accuracy (4 classes) | ${pct(b.responseTypeAccuracy)} | ${pct(l.responseTypeAccuracy)} |
| Knowledge-gap detection accuracy | ${pct(b.gapDetection.accuracy)} | ${pct(l.gapDetection.accuracy)} |
| Knowledge-gap precision | ${pct(b.gapDetection.precision)} | ${pct(l.gapDetection.precision)} |
| Knowledge-gap recall | ${pct(b.gapDetection.recall)} | ${pct(l.gapDetection.recall)} |
| Knowledge-gap F1 | ${num(b.gapDetection.f1, 3)} | ${num(l.gapDetection.f1, 3)} |
| Hidden-gap recall (graded correct, but flawed) | ${pct(b.hiddenGapRecall)} | ${pct(l.hiddenGapRecall)} |
| Misconception identification precision | ${pct(b.misconception.precision)} | ${pct(l.misconception.precision)} |
| Misconception identification recall | ${pct(b.misconception.recall)} | ${pct(l.misconception.recall)} |
| Misconception identification F1 | ${num(b.misconception.f1, 3)} | ${num(l.misconception.f1, 3)} |

The baseline can only output "correct" or "incorrect" and cannot name a misconception, so its misconception scores are zero by design.

### LLM confusion matrix (rows = true label, columns = LLM prediction)

| True \\ Predicted | ${labels.join(' | ')} |
|---|${labels.map(() => '---').join('|')}|
${confusionRows}

### Item-level comparison with 95% confidence intervals

One LLM prediction per response (majority vote over runs). Intervals are percentile bootstrap (2,000 resamples of responses, seed 42). p-values are from an exact two-sided McNemar test on the paired right/wrong outcomes.

| Measure | Baseline | LLM-assisted | Difference (LLM − baseline) | McNemar p |
|---|---|---|---|---|
| Response-type accuracy | ${pct(m.itemLevel.baselineTypeAccuracy)} ${range(m.itemLevel.baselineTypeAccuracyCI)} | ${pct(m.itemLevel.llmTypeAccuracy)} ${range(m.itemLevel.llmTypeAccuracyCI)} | ${range(m.itemLevel.typeAccuracyDifferenceCI)} | ${pval(m.itemLevel.typeMcNemar.pValue)} |
| Knowledge-gap detection accuracy | ${pct(m.itemLevel.baselineGapAccuracy)} ${range(m.itemLevel.baselineGapAccuracyCI)} | ${pct(m.itemLevel.llmGapAccuracy)} ${range(m.itemLevel.llmGapAccuracyCI)} | ${range(m.itemLevel.gapAccuracyDifferenceCI)} | ${pval(m.itemLevel.gapMcNemar.pValue)} |

### Misconception handling

| Measure | Baseline | LLM-assisted |
|---|---|---|
| Misconception responses recognized as misconceptions (any, incl. out-of-catalog) | ${pct(m.robustness.baseline.misconceptionTypeRecall)} | ${pct(m.robustness.llm.misconceptionTypeRecall)} |
| False misconception rate (no false belief, but one reported) | ${pct(m.robustness.baseline.falseMisconceptionRate)} | ${pct(m.robustness.llm.falseMisconceptionRate)} |
${m.robustness.llm.hedgedN ? `| False misconception rate on hedged answers (n=${m.robustness.baseline.hedgedN}) | ${pct(m.robustness.baseline.hedgedFalseMisconceptionRate)} | ${pct(m.robustness.llm.hedgedFalseMisconceptionRate)} |
` : ''}${m.robustness.llm.outOfCatalogN ? `| Out-of-catalog (n=${m.robustness.baseline.outOfCatalogN}): gap detected | ${pct(m.robustness.baseline.outOfCatalogGapDetected)} | ${pct(m.robustness.llm.outOfCatalogGapDetected)} |
| Out-of-catalog: flagged as misconception | ${pct(m.robustness.baseline.outOfCatalogFlaggedAsMisconception)} | ${pct(m.robustness.llm.outOfCatalogFlaggedAsMisconception)} |
| Out-of-catalog: forced into a wrong catalog code | ${pct(m.robustness.baseline.outOfCatalogForcedFit)} | ${pct(m.robustness.llm.outOfCatalogForcedFit)} |
` : ''}
${m.byCategory ? `### Results by response category

| Category | n | Baseline type acc. | LLM type acc. | Baseline gap acc. | LLM gap acc. |
|---|---|---|---|---|---|
${Object.keys(m.byCategory.baseline).map((c) => `| ${c} | ${m.byCategory.baseline[c].n} | ${pct(m.byCategory.baseline[c].responseTypeAccuracy)} | ${pct(m.byCategory.llm[c].responseTypeAccuracy)} | ${pct(m.byCategory.baseline[c].gapDetectionAccuracy)} | ${pct(m.byCategory.llm[c].gapDetectionAccuracy)} |`).join('\n')}

LLM columns are pooled over runs.
` : ''}
${m.labelAudit.ambiguousItems.length ? `### Label audit

Responses flagged as ambiguous during the label review: ${m.labelAudit.ambiguousItems.join(', ')}. Their labels were kept unchanged; results without them:

| Measure | Baseline | LLM-assisted |
|---|---|---|
| Response-type accuracy excluding ambiguous items | ${pct(m.labelAudit.baselineTypeAccuracyExcludingAmbiguous)} | ${pct(m.labelAudit.llmTypeAccuracyExcludingAmbiguous)} |
| Misconception identification F1 excluding ambiguous items | 0.000 | ${num(m.labelAudit.llmMisconceptionF1ExcludingAmbiguous, 3)} |
` : ''}
## 2. Consistency of LLM assessments

| Metric | Value |
|---|---|
| Responses analyzed more than once | ${m.consistency.itemsWithRepeats} |
| Mean agreement on response type | ${pct(m.consistency.meanResponseTypeAgreement)} |
| Mean agreement on misconception code | ${pct(m.consistency.meanMisconceptionAgreement)} |
| Fully consistent responses | ${m.consistency.fullyConsistentItems} / ${m.consistency.itemsWithRepeats} |
| Mean std. dev. of understanding level (0-100) | ${num(m.consistency.meanUnderstandingLevelStd)} |

## 3. Response time and cost

| Metric | Baseline | LLM-assisted |
|---|---|---|
| Mean latency per response | ~0 ms (no external call) | ${num(m.cost.meanLatencyMs, 0)} ms |
| Median latency | ~0 ms | ${num(m.cost.medianLatencyMs, 0)} ms |
| Max latency | ~0 ms | ${num(m.cost.maxLatencyMs, 0)} ms |
| Mean input tokens per call | 0 | ${num(m.cost.meanInputTokens, 0)} |
| Mean output tokens per call | 0 | ${num(m.cost.meanOutputTokens, 0)} |
| Total tokens for the whole experiment | 0 | ${m.cost.totalTokens} |

## 4. Follow-up question selection (learner scenarios)

A concept hit means the selected question targets the learner's real gap. A probe hit means it is the probe question for the learner's actual misconception.

| Scenario | Score | Target | Baseline pick | Concept hit | LLM pick | Concept hit | Probe hit / false probe |
|---|---|---|---|---|---|---|---|
${scenarioResults
  .map(
    (r) =>
      `| ${r.scenarioId}: ${r.description} | ${r.baselineScore}% | ${conceptById[r.targetConceptId].name}${
        r.targetMisconceptionCode ? ` / ${r.targetMisconceptionCode}` : ''
      } | Q${r.baseline.questionId} (${r.baseline.rule}) | ${yesNo(r.baseline.conceptHit)} | Q${r.llm.questionId} (${r.llm.rule}) | ${yesNo(r.llm.conceptHit)} | ${r.llm.probeHit !== null ? yesNo(r.llm.probeHit) : r.llm.falseProbe ? 'FALSE PROBE' : '–'} |`
  )
  .join('\n')}

| Metric | Baseline | LLM-assisted |
|---|---|---|
| Concept hit rate | ${pct(m.scenarios.baselineConceptHitRate)} | ${pct(m.scenarios.llmConceptHitRate)} |
| Misconception probe hit rate | ${pct(m.scenarios.baselineProbeHitRate)} | ${pct(m.scenarios.llmProbeHitRate)} |
| False probe rate (probe asked, learner has no catalog misconception) | ${pct(m.scenarios.baselineFalseProbeRate)} | ${pct(m.scenarios.llmFalseProbeRate)} |

Scenarios evaluated: ${m.scenarios.evaluated} (skipped because of failed calls: ${m.scenarios.skipped})

## 5. Failure cases

See \`failure_cases.csv\` for every run where the LLM's response type or misconception code disagreed with the label.
`;
}

main()
  .catch((error) => {
    console.error('Evaluation failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
