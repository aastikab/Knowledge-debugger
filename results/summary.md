# Knowledge Debugger — Evaluation Results

Generated: 2026-10-27T16:58:54.102Z
Model: gemini-3.5-flash-lite · Responses: 40 · Runs per response: 3 · Successful LLM calls: 120 · Failed calls: 0 · Outputs needing correction: 0

## 1. Knowledge-gap and misconception detection

LLM figures are pooled over all runs (equivalent to the mean over runs).

| Metric | Baseline (correct/incorrect) | LLM-assisted |
|---|---|---|
| Response-type accuracy (4 classes) | 50.0% | 96.7% |
| Knowledge-gap detection accuracy | 80.0% | 100.0% |
| Knowledge-gap precision | 100.0% | 100.0% |
| Knowledge-gap recall | 73.3% | 100.0% |
| Knowledge-gap F1 | 0.846 | 1.000 |
| Hidden-gap recall (graded correct, but flawed) | 0.0% | 100.0% |
| Misconception identification precision | n/a | 85.7% |
| Misconception identification recall | 0.0% | 100.0% |
| Misconception identification F1 | 0.000 | 0.923 |

The baseline can only output "correct" or "incorrect" and cannot name a misconception, so its misconception scores are zero by design.

### LLM confusion matrix (rows = true label, columns = LLM prediction)

| True \ Predicted | correct | partial | incorrect | misconception |
|---|---|---|---|---|
| correct | 30 | 0 | 0 | 0 |
| partial | 0 | 29 | 0 | 1 |
| incorrect | 0 | 0 | 27 | 3 |
| misconception | 0 | 0 | 0 | 30 |

## 2. Consistency of LLM assessments

| Metric | Value |
|---|---|
| Responses analyzed more than once | 40 |
| Mean agreement on response type | 99.2% |
| Mean agreement on misconception code | 99.2% |
| Fully consistent responses | 39 / 40 |
| Mean std. dev. of understanding level (0-100) | 1.4 |

## 3. Response time and cost

| Metric | Baseline | LLM-assisted |
|---|---|---|
| Mean latency per response | ~0 ms (no external call) | 6907 ms |
| Median latency | ~0 ms | 3219 ms |
| Max latency | ~0 ms | 71433 ms |
| Mean input tokens per call | 0 | 626 |
| Mean output tokens per call | 0 | 106 |
| Total tokens for the whole experiment | 0 | 87835 |

## 4. Follow-up question selection (learner scenarios)

A concept hit means the selected question targets the learner's real gap. A probe hit means it is the probe question for the learner's actual misconception.

| Scenario | Score | Target | Baseline pick | Concept hit | LLM pick | Concept hit | Probe hit |
|---|---|---|---|---|---|---|---|
| S01: Hidden authn/authz confusion: every answer graded correct | 100% | Authorization / AUTHN_AUTHZ_CONFUSION | Q2 (review) | no | Q18 (misconception-probe) | yes | yes |
| S02: Hidden 'HTTP is a language' belief inside a correct acronym | 100% | HTTP / HTTP_IS_LANGUAGE | Q2 (review) | no | Q13 (misconception-probe) | yes | yes |
| S03: Hidden 'server must be hardware' belief, graded correct | 100% | Client and Server / SERVER_IS_HARDWARE_ONLY | Q1 (review) | yes | Q12 (misconception-probe) | yes | yes |
| S04: Shallow API answer graded correct (no misconception) | 100% | APIs | Q2 (review) | no | Q6 (weakest-concept) | yes | – |
| S05: Visible GET/POST confusion (graded wrong) | 80% | HTTP / GET_POST_CONFUSION | Q3 (weakest-concept) | yes | Q14 (misconception-probe) | yes | yes |
| S06: Visible 'API is a database' belief (graded wrong) | 80% | APIs / API_IS_DATABASE | Q6 (weakest-concept) | yes | Q15 (misconception-probe) | yes | yes |
| S07: Visible 'API is the UI' belief (graded wrong) | 80% | APIs / API_IS_UI | Q5 (weakest-concept) | yes | Q16 (misconception-probe) | yes | yes |
| S08: Visible 'encryption is authentication' belief (graded wrong) | 80% | Authentication / ENCRYPTION_IS_AUTHENTICATION | Q7 (weakest-concept) | yes | Q17 (misconception-probe) | yes | yes |
| S09: Visible client/server role reversal (graded wrong) | 80% | Client and Server / CLIENT_SERVER_REVERSED | Q2 (weakest-concept) | yes | Q11 (misconception-probe) | yes | yes |
| S10: Same score as S11: authorization wrong because of a misconception | 80% | Authorization / AUTHN_AUTHZ_CONFUSION | Q10 (weakest-concept) | yes | Q18 (misconception-probe) | yes | yes |
| S11: Same score as S10: authorization wrong because of no knowledge | 80% | Authorization | Q10 (weakest-concept) | yes | Q10 (weakest-concept) | yes | – |
| S12: Plain HTTP gap with no misconception | 80% | HTTP | Q4 (weakest-concept) | yes | Q4 (weakest-concept) | yes | – |
| S13: Plain foundation gap (Client and Server) | 80% | Client and Server | Q2 (weakest-concept) | yes | Q2 (weakest-concept) | yes | – |

| Metric | Baseline | LLM-assisted |
|---|---|---|
| Concept hit rate | 76.9% | 100.0% |
| Misconception probe hit rate | 0.0% | 100.0% |

Scenarios evaluated: 13 (skipped because of failed calls: 0)

## 5. Failure cases

See `failure_cases.csv` for every run where the LLM's response type or misconception code disagreed with the label.
