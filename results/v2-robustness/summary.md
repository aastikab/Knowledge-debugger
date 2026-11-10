# Knowledge Debugger — Evaluation Results

Generated: 2026-11-10T17:31:15.783Z
Dataset: `data/robustness_responses.json` (sha256 1f845fd28a2e) · Prompt: v2
Model: gemini-3.5-flash-lite · Responses: 49 · Runs per response: 1 · Successful LLM calls: 49 · Failed calls: 0 · Outputs needing correction: 0

## 1. Knowledge-gap and misconception detection

LLM figures are pooled over all runs (equivalent to the mean over runs).

| Metric | Baseline (correct/incorrect) | LLM-assisted |
|---|---|---|
| Response-type accuracy (4 classes) | 40.8% | 93.9% |
| Knowledge-gap detection accuracy | 65.3% | 95.9% |
| Knowledge-gap precision | 100.0% | 93.8% |
| Knowledge-gap recall | 43.3% | 100.0% |
| Knowledge-gap F1 | 0.605 | 0.968 |
| Hidden-gap recall (graded correct, but flawed) | 0.0% | 100.0% |
| Misconception identification precision | n/a | 100.0% |
| Misconception identification recall | 0.0% | 93.8% |
| Misconception identification F1 | 0.000 | 0.968 |

The baseline can only output "correct" or "incorrect" and cannot name a misconception, so its misconception scores are zero by design.

### LLM confusion matrix (rows = true label, columns = LLM prediction)

| True \ Predicted | correct | partial | incorrect | misconception |
|---|---|---|---|---|
| correct | 17 | 2 | 0 | 0 |
| partial | 0 | 5 | 0 | 0 |
| incorrect | 0 | 0 | 1 | 0 |
| misconception | 0 | 1 | 0 | 23 |

### Item-level comparison with 95% confidence intervals

One LLM prediction per response (majority vote over runs). Intervals are percentile bootstrap (2,000 resamples of responses, seed 42). p-values are from an exact two-sided McNemar test on the paired right/wrong outcomes.

| Measure | Baseline | LLM-assisted | Difference (LLM − baseline) | McNemar p |
|---|---|---|---|---|
| Response-type accuracy | 40.8% [26.5, 53.1] | 93.9% [85.7, 100.0] | [36.7, 69.4] | < 0.001 |
| Knowledge-gap detection accuracy | 65.3% [51.0, 77.6] | 95.9% [89.8, 100.0] | [16.3, 46.9] | < 0.001 |

### Misconception handling

| Measure | Baseline | LLM-assisted |
|---|---|---|
| Misconception responses recognized as misconceptions (any, incl. out-of-catalog) | 0.0% | 95.8% |
| False misconception rate (no false belief, but one reported) | 0.0% | 0.0% |
| False misconception rate on hedged answers (n=9) | 0.0% | 0.0% |
| Out-of-catalog (n=8): gap detected | 37.5% | 100.0% |
| Out-of-catalog: flagged as misconception | 0.0% | 87.5% |
| Out-of-catalog: forced into a wrong catalog code | 0.0% | 0.0% |

### Results by response category

| Category | n | Baseline type acc. | LLM type acc. | Baseline gap acc. | LLM gap acc. |
|---|---|---|---|---|---|
| long | 10 | 60.0% | 100.0% | 60.0% | 100.0% |
| mixed | 6 | 16.7% | 100.0% | 16.7% | 100.0% |
| hedged | 9 | 55.6% | 77.8% | 77.8% | 77.8% |
| out_of_catalog | 8 | 0.0% | 87.5% | 37.5% | 100.0% |
| informal | 6 | 50.0% | 100.0% | 83.3% | 100.0% |
| probe | 10 | 50.0% | 100.0% | 100.0% | 100.0% |

LLM columns are pooled over runs.


## 2. Consistency of LLM assessments

| Metric | Value |
|---|---|
| Responses analyzed more than once | 17 |
| Mean agreement on response type | 100.0% |
| Mean agreement on misconception code | 100.0% |
| Fully consistent responses | 17 / 17 |
| Mean std. dev. of understanding level (0-100) | 2.2 |

## 3. Response time and cost

| Metric | Baseline | LLM-assisted |
|---|---|---|
| Mean latency per response | ~0 ms (no external call) | 3424 ms |
| Median latency | ~0 ms | 975 ms |
| Max latency | ~0 ms | 62696 ms |
| Mean input tokens per call | 0 | 855 |
| Mean output tokens per call | 0 | 110 |
| Total tokens for the whole experiment | 0 | 47304 |

## 4. Follow-up question selection (learner scenarios)

A concept hit means the selected question targets the learner's real gap. A probe hit means it is the probe question for the learner's actual misconception.

| Scenario | Score | Target | Baseline pick | Concept hit | LLM pick | Concept hit | Probe hit / false probe |
|---|---|---|---|---|---|---|---|
| R01: Long answer with a buried 'API is a database' belief (graded correct) | 100% | APIs / API_IS_DATABASE | Q2 (review) | no | Q15 (misconception-probe) | yes | yes |
| R02: Mixed answer: GET named, but POST believed to retrieve data (graded correct) | 100% | HTTP / GET_POST_CONFUSION | Q1 (review) | no | Q14 (misconception-probe) | yes | yes |
| R03: Mixed answer: password plus 'HTTPS proves identity' (graded correct) | 100% | Authentication / ENCRYPTION_IS_AUTHENTICATION | Q1 (review) | no | Q17 (misconception-probe) | yes | yes |
| R04: Hedged: can't remember which term is which (no misconception) | 80% | Authorization | Q9 (weakest-concept) | yes | Q9 (review) | yes | – |
| R05: Out-of-catalog: 'HTTP is the internet' (graded correct) | 100% | HTTP | Q1 (review) | no | Q4 (review) | yes | – |
| R06: Out-of-catalog: 'authorization only applies to admins' (graded correct) | 100% | Authorization | Q1 (review) | no | Q10 (weakest-concept) | yes | – |
| R07: Out-of-catalog near-miss: 'GET can't have parameters' (graded correct) | 100% | HTTP | Q2 (review) | no | Q3 (review) | yes | – |
| R08: Informal writing hiding 'server must be hardware' (graded correct) | 100% | Client and Server / SERVER_IS_HARDWARE_ONLY | Q1 (review) | yes | Q12 (misconception-probe) | yes | yes |
| R09: Long answer with client/server roles reversed (graded correct) | 100% | Client and Server / CLIENT_SERVER_REVERSED | Q2 (review) | yes | Q11 (misconception-probe) | yes | yes |
| R10: Long but shallow authentication answer (graded correct, no misconception) | 100% | Authentication | Q1 (review) | no | Q8 (weakest-concept) | yes | – |
| R11: Misconception confirmed by its probe answer; stay on Authentication | 83% | Authentication | Q7 (weakest-concept) | yes | Q7 (weakest-concept) | yes | – |
| R12: Informal 'API is the database' (graded wrong) | 80% | APIs / API_IS_DATABASE | Q6 (weakest-concept) | yes | Q15 (misconception-probe) | yes | yes |

| Metric | Baseline | LLM-assisted |
|---|---|---|
| Concept hit rate | 41.7% | 100.0% |
| Misconception probe hit rate | 0.0% | 100.0% |
| False probe rate (probe asked, learner has no catalog misconception) | 0.0% | 0.0% |

Scenarios evaluated: 12 (skipped because of failed calls: 0)

## 5. Failure cases

See `failure_cases.csv` for every run where the LLM's response type or misconception code disagreed with the label.
