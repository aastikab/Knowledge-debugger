/**
 * Builds the final tables and figures from the four experiment folders:
 *   results/                 prompt v1, original 40-response set (Progress Report 3)
 *   results/v2-original      prompt v2, original set
 *   results/v1-robustness    prompt v1, 49-response robustness set
 *   results/v2-robustness    prompt v2, robustness set
 *
 * Usage: node scripts/report.js   (writes results/final/summary.md and figures/*.svg)
 * No API or database access needed.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'results/final');
const FIG = path.join(OUT, 'figures');

const RUNS = {
  v1Original: 'results',
  v2Original: 'results/v2-original',
  v1Robust: 'results/v1-robustness',
  v2Robust: 'results/v2-robustness',
};

// Chart palette (validated: categorical slots 1-3, light surface).
// Series identity is fixed across every figure.
const COLORS = { baseline: '#2a78d6', v1: '#eb6834', v2: '#1baf7a' };
const INK = { primary: '#0b0b0b', secondary: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', surface: '#fcfcfb' };

function load(dir) {
  const file = path.join(ROOT, dir, 'metrics.json');
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}. Run the experiment first (see README).`);
  const metrics = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (metrics.mock) throw new Error(`${file} is a mock run.`);
  return metrics;
}

const pct = (v) => (v === null || v === undefined ? 'n/a' : `${(v * 100).toFixed(1)}%`);
const f3 = (v) => (v === null || v === undefined ? 'n/a' : v.toFixed(3));
const ci = (c) => (c ? ` [${(c[0] * 100).toFixed(1)}, ${(c[1] * 100).toFixed(1)}]` : '');
const pv = (p) => (p < 0.001 ? '< 0.001' : p.toFixed(3));
const sec = (ms) => (ms === null || ms === undefined ? 'n/a' : `${(ms / 1000).toFixed(1)} s`);
const CATEGORY_NAMES = {
  long: 'Long', mixed: 'Mixed', hedged: 'Hedged', out_of_catalog: 'Out-of-catalog', informal: 'Informal', probe: 'Probe answers',
};

function main() {
  const m = Object.fromEntries(Object.entries(RUNS).map(([k, dir]) => [k, load(dir)]));
  fs.mkdirSync(FIG, { recursive: true });

  // ---------- Figure 1: original set, baseline vs LLM v1 vs LLM v2 ----------
  const o1 = m.v1Original, o2 = m.v2Original;
  writeSvg('fig1_original_set.svg', groupedBars({
    title: 'Original set (40 responses): baseline vs LLM-assisted',
    groups: [
      { label: 'Response-type accuracy', values: [o1.baseline.responseTypeAccuracy, o1.llm.responseTypeAccuracy, o2.llm.responseTypeAccuracy] },
      { label: 'Gap detection F1', values: [o1.baseline.gapDetection.f1, o1.llm.gapDetection.f1, o2.llm.gapDetection.f1] },
      { label: 'Hidden-gap recall', values: [o1.baseline.hiddenGapRecall, o1.llm.hiddenGapRecall, o2.llm.hiddenGapRecall] },
      { label: 'Misconception F1', values: [o1.baseline.misconception.f1, o1.llm.misconception.f1, o2.llm.misconception.f1] },
    ],
    series: SERIES3,
  }));

  // ---------- Figure 2: robustness set by category ----------
  const r1 = m.v1Robust, r2 = m.v2Robust;
  const categories = Object.keys(r1.byCategory.baseline);
  writeSvg('fig2_robustness_by_category.svg', groupedBars({
    title: 'Robustness set (49 responses): response-type accuracy by category',
    groups: categories.map((c) => ({
      label: `${CATEGORY_NAMES[c] || c} (n=${r1.byCategory.baseline[c].n})`,
      values: [r1.byCategory.baseline[c].responseTypeAccuracy, r1.byCategory.llm[c].responseTypeAccuracy, r2.byCategory.llm[c].responseTypeAccuracy],
    })),
    series: SERIES3,
  }));

  // ---------- Figure 3: prompt v1 vs v2 trade-off ----------
  writeSvg('fig3_prompt_tradeoff.svg', groupedBars({
    title: 'Prompt v1 vs v2: recognizing misconceptions vs false alarms',
    groups: [
      { label: 'Out-of-catalog recognized (robust.)', values: [r1.robustness.llm.outOfCatalogFlaggedAsMisconception, r2.robustness.llm.outOfCatalogFlaggedAsMisconception] },
      { label: 'All misconceptions recognized (robust.)', values: [r1.robustness.llm.misconceptionTypeRecall, r2.robustness.llm.misconceptionTypeRecall] },
      { label: 'Response-type accuracy (robust.)', values: [r1.llm.responseTypeAccuracy, r2.llm.responseTypeAccuracy] },
      { label: 'Response-type accuracy (original)', values: [m.v1Original.llm.responseTypeAccuracy, m.v2Original.llm.responseTypeAccuracy] },
      { label: 'False misconception rate (original)', values: [m.v1Original.robustness.llm.falseMisconceptionRate, m.v2Original.robustness.llm.falseMisconceptionRate] },
    ],
    series: [{ name: 'LLM, prompt v1', color: COLORS.v1 }, { name: 'LLM, prompt v2', color: COLORS.v2 }],
  }));

  fs.writeFileSync(path.join(OUT, 'summary.md'), renderSummary(m));
  fs.writeFileSync(path.join(OUT, 'final_metrics.json'), JSON.stringify(compactMetrics(m), null, 2));
  console.log(`Final tables and figures written to ${OUT}`);
}

const SERIES3 = [
  { name: 'Baseline (right/wrong)', color: COLORS.baseline },
  { name: 'LLM, prompt v1', color: COLORS.v1 },
  { name: 'LLM, prompt v2', color: COLORS.v2 },
];

// ---------- Tables ----------

function detectionRows(label, b, l1, l2) {
  return `| ${label} | ${b} | ${l1} | ${l2} |`;
}

function renderSummary(m) {
  const sets = [
    ['Original set (40 responses)', m.v1Original, m.v2Original],
    ['Robustness set (49 responses)', m.v1Robust, m.v2Robust],
  ];

  const detection = sets.map(([name, a, b]) => `### ${name}

| Measure | Baseline | LLM, prompt v1 | LLM, prompt v2 |
|---|---|---|---|
${[
  detectionRows('Response-type accuracy (4 classes)', pct(a.baseline.responseTypeAccuracy), pct(a.llm.responseTypeAccuracy), pct(b.llm.responseTypeAccuracy)),
  detectionRows('Knowledge-gap detection F1', f3(a.baseline.gapDetection.f1), f3(a.llm.gapDetection.f1), f3(b.llm.gapDetection.f1)),
  detectionRows('Knowledge-gap precision', pct(a.baseline.gapDetection.precision), pct(a.llm.gapDetection.precision), pct(b.llm.gapDetection.precision)),
  detectionRows('Hidden-gap recall (graded correct, but flawed)', pct(a.baseline.hiddenGapRecall), pct(a.llm.hiddenGapRecall), pct(b.llm.hiddenGapRecall)),
  detectionRows('Misconception identification F1 (catalog codes)', f3(a.baseline.misconception.f1), f3(a.llm.misconception.f1), f3(b.llm.misconception.f1)),
  detectionRows('Misconceptions recognized (any, incl. out-of-catalog)', pct(a.robustness.baseline.misconceptionTypeRecall), pct(a.robustness.llm.misconceptionTypeRecall), pct(b.robustness.llm.misconceptionTypeRecall)),
  detectionRows('False misconception rate', pct(a.robustness.baseline.falseMisconceptionRate), pct(a.robustness.llm.falseMisconceptionRate), pct(b.robustness.llm.falseMisconceptionRate)),
  detectionRows('Identical assessment across 3 runs', 'n/a', `${a.consistency.fullyConsistentItems} of ${a.consistency.itemsWithRepeats}`, `${b.consistency.fullyConsistentItems} of ${b.consistency.itemsWithRepeats}`),
  detectionRows('Median / max response time', '~0 s', `${sec(a.cost.medianLatencyMs)} / ${sec(a.cost.maxLatencyMs)}`, `${sec(b.cost.medianLatencyMs)} / ${sec(b.cost.maxLatencyMs)}`),
  detectionRows('Mean input / output tokens per call', '0', `${Math.round(a.cost.meanInputTokens)} / ${Math.round(a.cost.meanOutputTokens)}`, `${Math.round(b.cost.meanInputTokens)} / ${Math.round(b.cost.meanOutputTokens)}`),
  detectionRows('Failed calls / outputs needing correction', 'n/a', `${a.failedCalls} / ${a.outputWarnings}`, `${b.failedCalls} / ${b.outputWarnings}`),
].join('\n')}
`).join('\n');

  const stats = sets.map(([name, a, b]) => [[`${name}, prompt v1`, a], [`${name}, prompt v2`, b]]).flat()
    .map(([name, x]) => {
      const i = x.itemLevel;
      return `| ${name} | ${pct(i.baselineTypeAccuracy)}${ci(i.baselineTypeAccuracyCI)} | ${pct(i.llmTypeAccuracy)}${ci(i.llmTypeAccuracyCI)} | ${ci(i.typeAccuracyDifferenceCI).trim()} | ${pv(i.typeMcNemar.pValue)} | ${pct(i.baselineGapAccuracy)} → ${pct(i.llmGapAccuracy)} | ${pv(i.gapMcNemar.pValue)} |`;
    }).join('\n');

  const r1 = m.v1Robust, r2 = m.v2Robust;
  const cats = Object.keys(r1.byCategory.baseline);
  const categoryTable = cats.map((c) =>
    `| ${CATEGORY_NAMES[c] || c} | ${r1.byCategory.baseline[c].n} | ${pct(r1.byCategory.baseline[c].responseTypeAccuracy)} | ${pct(r1.byCategory.llm[c].responseTypeAccuracy)} | ${pct(r2.byCategory.llm[c].responseTypeAccuracy)} | ${pct(r1.byCategory.baseline[c].gapDetectionAccuracy)} | ${pct(r1.byCategory.llm[c].gapDetectionAccuracy)} | ${pct(r2.byCategory.llm[c].gapDetectionAccuracy)} |`
  ).join('\n');

  const robust = (label, key, invert = false) => {
    const f = (v) => pct(invert && v !== null ? 1 - v : v);
    return `| ${label} | ${f(r1.robustness.baseline[key])} | ${f(r1.robustness.llm[key])} | ${f(r2.robustness.llm[key])} |`;
  };

  const scen = sets.map(([name, a, b]) => `| ${name} (${a.scenarios.evaluated} learners) | ${pct(a.scenarios.baselineConceptHitRate)} | ${pct(a.scenarios.llmConceptHitRate)} | ${pct(b.scenarios.llmConceptHitRate)} | ${pct(a.scenarios.baselineProbeHitRate)} | ${pct(a.scenarios.llmProbeHitRate)} | ${pct(b.scenarios.llmProbeHitRate)} | ${pct(a.scenarios.llmFalseProbeRate)} | ${pct(b.scenarios.llmFalseProbeRate)} |`).join('\n');

  const audit = (x) => x.labelAudit;
  return `# Knowledge Debugger — Final Evaluation Tables (Weeks 10–12)

Generated: ${new Date().toISOString()} · Model: ${m.v2Robust.model}
Runs scored per response: ${m.v1Original.runsPerResponse} on the original set, ${m.v1Robust.runsPerResponse} on the robustness set (API rate limits). Consistency uses every response that has 3 saved runs. LLM numbers are pooled over scored runs.
Prompt v1 = prompt used in Progress Report 3. Prompt v2 = v1 plus rules for uncertainty, mixed answers, informal writing, and out-of-catalog misconceptions.

## Table A. Knowledge-gap and misconception detection

${detection}
## Table B. Statistical comparison (item level, majority vote over the scored runs)

95% percentile bootstrap intervals (2,000 resamples of responses); exact two-sided McNemar test on paired right/wrong outcomes (baseline vs LLM).

| Dataset / prompt | Baseline type acc. | LLM type acc. | Difference | McNemar p | Gap-detection acc. (baseline → LLM) | McNemar p |
|---|---|---|---|---|---|---|
${stats}

## Table C. Robustness set by response category (response-type accuracy | gap-detection accuracy)

| Category | n | Baseline | LLM v1 | LLM v2 | Baseline gap | LLM v1 gap | LLM v2 gap |
|---|---|---|---|---|---|---|---|
${categoryTable}

## Table D. Robustness set: misconception handling

| Measure | Baseline | LLM, prompt v1 | LLM, prompt v2 |
|---|---|---|---|
${robust(`Out-of-catalog misconceptions (n=${r1.robustness.baseline.outOfCatalogN}): gap detected`, 'outOfCatalogGapDetected')}
${robust('Out-of-catalog: recognized as a misconception', 'outOfCatalogFlaggedAsMisconception')}
${robust('Out-of-catalog: forced into a wrong catalog code (lower is better)', 'outOfCatalogForcedFit')}
${robust(`Hedged answers (n=${r1.robustness.baseline.hedgedN}): false misconception (lower is better)`, 'hedgedFalseMisconceptionRate')}
${robust('All non-misconception answers: false misconception (lower is better)', 'falseMisconceptionRate')}

## Table E. Follow-up question selection (simulated learners)

| Scenario set | Baseline concept hit | LLM v1 concept hit | LLM v2 concept hit | Baseline probe hit | LLM v1 probe hit | LLM v2 probe hit | LLM v1 false probe | LLM v2 false probe |
|---|---|---|---|---|---|---|---|---|
${scen}

## Table F. Label audit (original set)

Ambiguous items (labels unchanged): ${audit(m.v1Original).ambiguousItems.join(', ') || 'none'}.

| | Baseline | LLM v1 | LLM v2 |
|---|---|---|---|
| Response-type accuracy, all items | ${pct(m.v1Original.baseline.responseTypeAccuracy)} | ${pct(m.v1Original.llm.responseTypeAccuracy)} | ${pct(m.v2Original.llm.responseTypeAccuracy)} |
| Response-type accuracy, excluding ambiguous | ${pct(audit(m.v1Original).baselineTypeAccuracyExcludingAmbiguous)} | ${pct(audit(m.v1Original).llmTypeAccuracyExcludingAmbiguous)} | ${pct(audit(m.v2Original).llmTypeAccuracyExcludingAmbiguous)} |
| Misconception F1, excluding ambiguous | 0.000 | ${f3(audit(m.v1Original).llmMisconceptionF1ExcludingAmbiguous)} | ${f3(audit(m.v2Original).llmMisconceptionF1ExcludingAmbiguous)} |

## Figures

- \`figures/fig1_original_set.svg\`
- \`figures/fig2_robustness_by_category.svg\`
- \`figures/fig3_prompt_tradeoff.svg\`
`;
}

function compactMetrics(m) {
  return Object.fromEntries(Object.entries(m).map(([k, x]) => [k, {
    dataset: x.dataset, promptVersion: x.promptVersion, model: x.model, successfulCalls: x.successfulCalls,
    baseline: { responseTypeAccuracy: x.baseline.responseTypeAccuracy, gapF1: x.baseline.gapDetection.f1, hiddenGapRecall: x.baseline.hiddenGapRecall },
    llm: { responseTypeAccuracy: x.llm.responseTypeAccuracy, gapF1: x.llm.gapDetection.f1, hiddenGapRecall: x.llm.hiddenGapRecall, misconceptionF1: x.llm.misconception.f1 },
    itemLevel: x.itemLevel, robustness: x.robustness, scenarios: x.scenarios, consistency: x.consistency, cost: x.cost,
  }]));
}

// ---------- SVG grouped horizontal bar chart (0-100%) ----------

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function groupedBars({ title, groups, series }) {
  const width = 760;
  const labelW = 250;
  const plotW = width - labelW - 70;
  const barH = 14;
  const barGap = 2; // surface gap between adjacent bars
  const groupGap = 18;
  const top = 74;
  const groupH = series.length * (barH + barGap) - barGap;
  const height = top + groups.length * (groupH + groupGap) + 34;
  const x = (v) => labelW + v * plotW;

  const parts = [];
  parts.push(`<rect width="${width}" height="${height}" fill="${INK.surface}"/>`);
  parts.push(`<text x="16" y="28" font-size="16" font-weight="600" fill="${INK.primary}">${esc(title)}</text>`);

  // Legend (always present for >= 2 series)
  let lx = 16;
  for (const s of series) {
    parts.push(`<rect x="${lx}" y="44" width="12" height="12" rx="2" fill="${s.color}"/>`);
    parts.push(`<text x="${lx + 18}" y="54" font-size="12" fill="${INK.secondary}">${esc(s.name)}</text>`);
    lx += 30 + s.name.length * 6.6;
  }

  // Recessive grid + axis labels
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    parts.push(`<line x1="${x(t)}" x2="${x(t)}" y1="${top - 6}" y2="${height - 30}" stroke="${t === 0 ? INK.axis : INK.grid}" stroke-width="1"/>`);
    parts.push(`<text x="${x(t)}" y="${height - 14}" font-size="11" fill="${INK.muted}" text-anchor="middle">${Math.round(t * 100)}%</text>`);
  }

  groups.forEach((g, gi) => {
    const gy = top + gi * (groupH + groupGap);
    parts.push(`<text x="${labelW - 10}" y="${gy + groupH / 2 + 4}" font-size="12" fill="${INK.primary}" text-anchor="end">${esc(g.label)}</text>`);
    g.values.forEach((v, si) => {
      const y = gy + si * (barH + barGap);
      const value = v === null || v === undefined ? null : v;
      const w = value === null ? 0 : Math.max(value * plotW, 0);
      if (w > 0) {
        // Rounded data end, square at the baseline
        const r = Math.min(4, w);
        parts.push(`<path d="M${x(0)},${y} h${w - r} a${r},${r} 0 0 1 ${r},${r} v${barH - 2 * r} a${r},${r} 0 0 1 -${r},${r} h-${w - r} z" fill="${series[si].color}"><title>${esc(series[si].name)}: ${pct(value)}</title></path>`);
      }
      parts.push(`<text x="${x(0) + w + 5}" y="${y + barH - 3}" font-size="11" fill="${INK.secondary}">${value === null ? 'n/a' : pct(value)}</text>`);
    });
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Helvetica, Arial, sans-serif" role="img" aria-label="${esc(title)}">\n${parts.join('\n')}\n</svg>\n`;
}

function writeSvg(name, svg) {
  fs.writeFileSync(path.join(FIG, name), svg);
}

main();
