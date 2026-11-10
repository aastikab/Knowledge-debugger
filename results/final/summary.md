# Knowledge Debugger — Final Evaluation Tables (Weeks 10–12)

Generated: 2026-11-10T17:32:04.620Z · Model: gemini-3.5-flash-lite
Runs scored per response: 3 on the original set, 1 on the robustness set (API rate limits). Consistency uses every response that has 3 saved runs. LLM numbers are pooled over scored runs.
Prompt v1 = prompt used in Progress Report 3. Prompt v2 = v1 plus rules for uncertainty, mixed answers, informal writing, and out-of-catalog misconceptions.

## Table A. Knowledge-gap and misconception detection

### Original set (40 responses)

| Measure | Baseline | LLM, prompt v1 | LLM, prompt v2 |
|---|---|---|---|
| Response-type accuracy (4 classes) | 50.0% | 96.7% | 93.3% |
| Knowledge-gap detection F1 | 0.846 | 1.000 | 1.000 |
| Knowledge-gap precision | 100.0% | 100.0% | 100.0% |
| Hidden-gap recall (graded correct, but flawed) | 0.0% | 100.0% | 100.0% |
| Misconception identification F1 (catalog codes) | 0.000 | 0.923 | 0.938 |
| Misconceptions recognized (any, incl. out-of-catalog) | 0.0% | 100.0% | 100.0% |
| False misconception rate | 0.0% | 5.6% | 8.9% |
| Identical assessment across 3 runs | n/a | 39 of 40 | 38 of 40 |
| Median / max response time | ~0 s | 3.2 s / 71.4 s | 1.0 s / 44.7 s |
| Mean input / output tokens per call | 0 | 626 / 106 | 833 / 106 |
| Failed calls / outputs needing correction | n/a | 0 / 0 | 2 / 0 |

### Robustness set (49 responses)

| Measure | Baseline | LLM, prompt v1 | LLM, prompt v2 |
|---|---|---|---|
| Response-type accuracy (4 classes) | 40.8% | 85.7% | 93.9% |
| Knowledge-gap detection F1 | 0.605 | 0.968 | 0.968 |
| Knowledge-gap precision | 100.0% | 93.8% | 93.8% |
| Hidden-gap recall (graded correct, but flawed) | 0.0% | 100.0% | 100.0% |
| Misconception identification F1 (catalog codes) | 0.000 | 0.968 | 0.968 |
| Misconceptions recognized (any, incl. out-of-catalog) | 0.0% | 79.2% | 95.8% |
| False misconception rate | 0.0% | 0.0% | 0.0% |
| Identical assessment across 3 runs | n/a | 11 of 11 | 17 of 17 |
| Median / max response time | ~0 s | 1.0 s / 37.6 s | 1.0 s / 62.7 s |
| Mean input / output tokens per call | 0 | 648 / 110 | 855 / 110 |
| Failed calls / outputs needing correction | n/a | 0 / 0 | 0 / 0 |

## Table B. Statistical comparison (item level, majority vote over the scored runs)

95% percentile bootstrap intervals (2,000 resamples of responses); exact two-sided McNemar test on paired right/wrong outcomes (baseline vs LLM).

| Dataset / prompt | Baseline type acc. | LLM type acc. | Difference | McNemar p | Gap-detection acc. (baseline → LLM) | McNemar p |
|---|---|---|---|---|---|---|
| Original set (40 responses), prompt v1 | 50.0% [35.0, 65.0] | 97.5% [92.5, 100.0] | [30.0, 65.0] | < 0.001 | 80.0% → 100.0% | 0.008 |
| Original set (40 responses), prompt v2 | 50.0% [35.0, 65.0] | 95.0% [87.5, 100.0] | [27.5, 62.5] | < 0.001 | 80.0% → 100.0% | 0.008 |
| Robustness set (49 responses), prompt v1 | 40.8% [26.5, 53.1] | 85.7% [75.5, 93.9] | [28.6, 61.2] | < 0.001 | 65.3% → 95.9% | < 0.001 |
| Robustness set (49 responses), prompt v2 | 40.8% [26.5, 53.1] | 93.9% [85.7, 100.0] | [36.7, 69.4] | < 0.001 | 65.3% → 95.9% | < 0.001 |

## Table C. Robustness set by response category (response-type accuracy | gap-detection accuracy)

| Category | n | Baseline | LLM v1 | LLM v2 | Baseline gap | LLM v1 gap | LLM v2 gap |
|---|---|---|---|---|---|---|---|
| Long | 10 | 60.0% | 100.0% | 100.0% | 60.0% | 100.0% | 100.0% |
| Mixed | 6 | 16.7% | 100.0% | 100.0% | 16.7% | 100.0% | 100.0% |
| Hedged | 9 | 55.6% | 77.8% | 77.8% | 77.8% | 77.8% | 77.8% |
| Out-of-catalog | 8 | 0.0% | 37.5% | 87.5% | 37.5% | 100.0% | 100.0% |
| Informal | 6 | 50.0% | 100.0% | 100.0% | 83.3% | 100.0% | 100.0% |
| Probe answers | 10 | 50.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |

## Table D. Robustness set: misconception handling

| Measure | Baseline | LLM, prompt v1 | LLM, prompt v2 |
|---|---|---|---|
| Out-of-catalog misconceptions (n=8): gap detected | 37.5% | 100.0% | 100.0% |
| Out-of-catalog: recognized as a misconception | 0.0% | 37.5% | 87.5% |
| Out-of-catalog: forced into a wrong catalog code (lower is better) | 0.0% | 0.0% | 0.0% |
| Hedged answers (n=9): false misconception (lower is better) | 0.0% | 0.0% | 0.0% |
| All non-misconception answers: false misconception (lower is better) | 0.0% | 0.0% | 0.0% |

## Table E. Follow-up question selection (simulated learners)

| Scenario set | Baseline concept hit | LLM v1 concept hit | LLM v2 concept hit | Baseline probe hit | LLM v1 probe hit | LLM v2 probe hit | LLM v1 false probe | LLM v2 false probe |
|---|---|---|---|---|---|---|---|---|
| Original set (40 responses) (13 learners) | 76.9% | 100.0% | 100.0% | 0.0% | 100.0% | 100.0% | 0.0% | 0.0% |
| Robustness set (49 responses) (12 learners) | 41.7% | 100.0% | 100.0% | 0.0% | 100.0% | 100.0% | 0.0% | 0.0% |

## Table F. Label audit (original set)

Ambiguous items (labels unchanged): r14, r15.

| | Baseline | LLM v1 | LLM v2 |
|---|---|---|---|
| Response-type accuracy, all items | 50.0% | 96.7% | 93.3% |
| Response-type accuracy, excluding ambiguous | 50.0% | 100.0% | 95.6% |
| Misconception F1, excluding ambiguous | 0.000 | 1.000 | 0.984 |

## Figures

- `figures/fig1_original_set.svg`
- `figures/fig2_robustness_by_category.svg`
- `figures/fig3_prompt_tradeoff.svg`
