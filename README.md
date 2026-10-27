# Knowledge Debugger

Adaptive-learning research prototype that studies whether analyzing the meaning of a student's written answers detects knowledge gaps and misconceptions better than tracking only correct/incorrect answers.

## Research Question

Can an LLM-assisted learner model that analyzes the semantic content of student responses identify knowledge gaps and select appropriate follow-up questions more effectively than a simpler performance-based method that primarily uses correct and incorrect answers?

The project compares two learner models:

1. **Baseline model:** concept mastery from correct/incorrect answers only.
2. **LLM-assisted model:** Gemini analyzes written answers for understanding level, knowledge gaps, and misconceptions from a fixed catalog.

Both models feed the **same** adaptive question-selection rule, so the only difference between them is the evidence they use.

## Technologies

- JavaScript, Node.js, Express
- PostgreSQL with `pg`
- `dotenv` for configuration
- `@google/generative-ai` (Gemini API client)
- Node's built-in test runner (`node --test`)

## Project Structure

```
Knowledge-debugger/
├── .env.example
├── package.json
├── README.md
├── data/
│   ├── eval_responses.json    # 40 manually labeled student responses
│   └── eval_scenarios.json    # 13 simulated learners for follow-up selection
├── scripts/
│   └── evaluate.js            # Runs the baseline-vs-LLM experiment
├── sql/
│   ├── schema.sql             # Full schema (fresh install)
│   ├── seed.sql               # Concepts and base questions
│   ├── add_analyses.sql       # Migration: analyses table
│   └── add_learner_model.sql  # Migration: prerequisites, misconceptions, probe questions
├── src/
│   ├── db.js                  # PostgreSQL connection pool
│   ├── llm.js                 # Gemini analysis + output validation
│   ├── curriculum.js          # Loads concepts/questions/misconceptions and learner evidence
│   ├── learnerModel.js        # Baseline model, LLM model, next-question selection
│   ├── evaluation.js          # Scoring functions for the experiment
│   └── server.js              # Express routes / API
└── test/                      # Unit tests
```

## Database Tables

| Table | Purpose |
|---|---|
| `concepts` | Learning topics (Client and Server, HTTP, APIs, Authentication, Authorization) |
| `concept_prerequisites` | Which concept builds on which (e.g. Authorization → Authentication) |
| `misconceptions` | Fixed catalog of 8 known misconceptions, each tied to a concept |
| `questions` | Questions per concept. `probes_misconception_id` marks targeted follow-up questions |
| `attempts` | Baseline evidence: answer + correct/incorrect flag |
| `analyses` | LLM evidence: summary, gap, misconception (text + code), response type, understanding level (0–100), model, latency, token usage |

`attempts` and `analyses` are kept separate so the two learner models can be compared.

**Why a misconception catalog?** Free-text LLM output cannot be scored automatically. Asking the LLM to choose from a known list makes "did it find the right misconception?" a measurable question. The free-text fields are still stored for qualitative analysis.

## Setup

```bash
npm install
cp .env.example .env   # then fill in DB settings and GEMINI_API_KEY
```

Optional `.env` settings: `GEMINI_MODEL` (default `gemini-3.5-flash-lite`) and `PORT` (default `3000`).

### Fresh database

```bash
psql -U your_postgres_username -d postgres -c "CREATE DATABASE knowledge_debugger;"
psql -U your_postgres_username -d knowledge_debugger -f sql/schema.sql
psql -U your_postgres_username -d knowledge_debugger -f sql/seed.sql
psql -U your_postgres_username -d knowledge_debugger -f sql/add_learner_model.sql
```

### Existing database (keeps your data)

```bash
psql -U your_postgres_username -d knowledge_debugger -f sql/add_analyses.sql
psql -U your_postgres_username -d knowledge_debugger -f sql/add_learner_model.sql
```

Both migrations are safe to run more than once.

## Running

```bash
npm start        # API on http://localhost:3000
npm test         # unit tests (no database or API key needed)
```

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | Confirms the backend is running |
| GET | `/concepts` | Concepts with prerequisites and known misconceptions |
| GET | `/questions` | All questions |
| GET | `/questions/:id` | One question |
| POST | `/attempts` | Record a baseline attempt (`learnerId`, `questionId`, `answer`, `correct`) |
| GET | `/attempts?learnerId=...` | Baseline attempt history |
| GET | `/progress/:learnerId` | Baseline concept mastery |
| POST | `/analyze` | LLM analysis of a written answer (`learnerId`, `questionId`, `answer`) |
| GET | `/analyses?learnerId=...` | LLM analysis history |
| GET | `/learner-model/:learnerId` | Both learner models side by side |
| GET | `/next-question/:learnerId?method=baseline\|llm` | Adaptive next question, with the rule and reason used |

### Example: the same learner, two methods

```bash
curl "http://localhost:3000/next-question/demo-student?method=baseline"
curl "http://localhost:3000/next-question/demo-student?method=llm"
```

Example LLM-method response for a learner whose authentication answer mixed up authentication and authorization:

```json
{
  "method": "llm",
  "question": { "id": 18, "conceptId": 5, "questionText": "A user has logged in successfully. Does that mean they can delete other users' accounts? ..." },
  "rule": "misconception-probe",
  "reason": "Suspected misconception AUTHN_AUTHZ_CONFUSION; asking a probe question to confirm it.",
  "mastery": { "1": 95, "4": 55, "5": 25 },
  "activeMisconceptions": [{ "code": "AUTHN_AUTHZ_CONFUSION", "conceptId": 5 }]
}
```

## Learner Models

**Baseline:** `mastery = correct attempts / total attempts × 100` per concept.

**LLM-assisted:** mastery = average LLM understanding level per concept. If an answer reveals a misconception belonging to a *different* concept (e.g. an authentication answer showing authentication/authorization confusion), that other concept receives weak evidence (25). A misconception stays *active* until the learner answers its probe question correctly.

**Next-question selection** (same rule for both methods, `src/learnerModel.js`):

1. If a misconception is suspected, ask its probe question (only the LLM model can suspect one).
2. Otherwise target the weakest concept below 70%; if none, the first untested concept; if all are mastered, review the lowest one.
3. If the target has a weak or untested prerequisite, check the prerequisite first.
4. Ask the easiest unanswered question in that concept.

## Evaluation

The experiment uses a controlled dataset of 40 manually labeled responses: 4 per base question, labeled `correct`, `partial`, `incorrect`, or `misconception`. Each response also records the grade a binary right/wrong grader would give (`baselineCorrect`). Several responses are deliberately *correct-looking but flawed*, for example the right HTTP acronym followed by the claim that HTTP is a programming language.

```bash
npm run evaluate                    # 3 runs per response (120 API calls)
npm run evaluate -- --runs 1        # cheaper
npm run evaluate -- --resume        # continue after a rate limit / crash
npm run evaluate -- --mock          # no API calls; tests the pipeline only
```

Outputs in `results/`:

| File | Contents |
|---|---|
| `summary.md` | Report-ready tables |
| `metrics.json` | All numbers |
| `item_results.csv` | Every LLM run on every response |
| `failure_cases.csv` | Runs where the LLM disagreed with the label (qualitative analysis) |
| `scenario_results.csv` | Follow-up question chosen by each method for each simulated learner |
| `raw_runs.json` | Raw LLM outputs (used by `--resume`) |

Measures:

- Response-type accuracy (4 classes)
- Knowledge-gap detection accuracy, precision, recall, and F1
- Hidden-gap recall: gaps the binary grader marks correct
- Misconception identification precision, recall, and F1
- Consistency across repeated runs
- Latency and token cost
- Follow-up relevance: concept hit rate and misconception probe hit rate over 13 simulated learners

## Limitations

- The labels and scenarios are written by the researcher, not collected from real students.
- The baseline's correctness flag comes from a simulated binary grader.
- The misconception catalog is small and fixed; misconceptions outside it can only appear in the free-text field.
- LLM output is non-deterministic, which is why consistency is measured.

## Future Work

- Volunteer learner sessions
- Frontend application
- Authentication / authorization for learners
- Deployment
