# Knowledge Debugger

Adaptive-learning research prototype that studies how student knowledge gaps can be detected from learning attempts.

## Research Objective

This project compares two learner models:

1. **Baseline model (Progress Report 2):** simple correctness-based concept mastery using correct/incorrect answers.
2. **LLM-assisted model (Week 7 — midterm work):** analyze written explanations for possible knowledge gaps and misconceptions.

## Technologies Currently Used

- JavaScript
- Node.js
- Express
- PostgreSQL
- `pg` (PostgreSQL client for Node.js)
- `dotenv` (loads environment variables from `.env`)
- `@google/generative-ai` (Week 7 Gemini LLM API client)

## Project Structure

```
Knowledge-debugger/
├── .env.example          # Example settings (no real secrets)
├── .gitignore
├── package.json
├── README.md
├── sql/
│   ├── schema.sql        # Full schema (concepts, questions, attempts, analyses)
│   ├── seed.sql          # Sample concepts and questions
│   └── week7.sql         # Adds analyses table to an existing PR2 database
└── src/
    ├── db.js             # PostgreSQL connection pool
    ├── llm.js            # Gemini written-answer analysis helper
    └── server.js         # Express routes / API
```

## Database Tables

### 1. `concepts`
Learning topics (HTTP, APIs, Authentication, etc.).

### 2. `questions`
Quiz questions. Each question belongs to one concept.

### 3. `attempts` (baseline model)
Stores each learner’s submitted answer and a client-provided correct/incorrect flag.

### 4. `analyses` (Week 7 LLM model)
Stores LLM analysis of a written answer:

| Column                  | Purpose                                      |
|-------------------------|----------------------------------------------|
| id                      | Primary key                                  |
| learner_id              | Simple text learner ID                       |
| question_id             | Foreign key → questions(id)                  |
| submitted_answer        | Written student response                     |
| understanding_summary   | Short LLM summary of understanding           |
| knowledge_gap           | Possible missing idea (or null)              |
| misconception           | Possible incorrect belief (or null)          |
| llm_seems_correct       | Whether the LLM thinks the answer is mostly correct |
| created_at              | When the analysis was stored                 |

`attempts` and `analyses` are kept separate so the research can compare the baseline model with the LLM model.

## How to Install Dependencies

```bash
npm install
```

## How to Configure `.env`

```bash
cp .env.example .env
```

Then set:

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=knowledge_debugger
DB_USER=your_postgres_username
DB_PASSWORD=your_postgres_password
GEMINI_API_KEY=your_gemini_api_key_here
```

Never commit `.env`.

## Database Setup

Create the database (once):

```bash
psql -U your_postgres_username -d postgres -c "CREATE DATABASE knowledge_debugger;"
```

### Fresh install

```bash
psql -U your_postgres_username -d knowledge_debugger -f sql/schema.sql
psql -U your_postgres_username -d knowledge_debugger -f sql/seed.sql
```

### Existing Progress Report 2 database (recommended for Week 7)

```bash
psql -U your_postgres_username -d knowledge_debugger -f sql/week7.sql
```

## How to Start the Server

```bash
node src/server.js
```

## Current API Endpoints

| Method | Endpoint                    | Description                                      |
|--------|-----------------------------|--------------------------------------------------|
| GET    | `/`                         | Confirms the backend is running                  |
| GET    | `/questions`                | Returns all questions from PostgreSQL            |
| GET    | `/questions/:id`            | Returns one question by ID                       |
| POST   | `/attempts`                 | Records a baseline student attempt               |
| GET    | `/attempts?learnerId=...`   | Returns baseline attempt history                 |
| GET    | `/progress/:learnerId`      | Baseline concept mastery                         |
| POST   | `/analyze`                  | Week 7: LLM analysis of a written answer         |
| GET    | `/analyses?learnerId=...`   | Week 7: LLM analysis history                     |

## Example Requests

### Baseline (Progress Report 2)

```bash
curl http://localhost:3000/
curl http://localhost:3000/questions
curl http://localhost:3000/questions/1

curl -X POST http://localhost:3000/attempts \
  -H "Content-Type: application/json" \
  -d '{
    "learnerId": "demo-student",
    "questionId": 3,
    "answer": "HyperText Transfer Protocol.",
    "correct": true
  }'

curl "http://localhost:3000/attempts?learnerId=demo-student"
curl http://localhost:3000/progress/demo-student
```

### Week 7 LLM analysis

```bash
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "learnerId": "demo-student",
    "questionId": 3,
    "answer": "HTTP is just a programming language for websites."
  }'

curl "http://localhost:3000/analyses?learnerId=demo-student"
```

Example `/analyze` response shape:

```json
{
  "id": 1,
  "learnerId": "demo-student",
  "questionId": 3,
  "answer": "HTTP is just a programming language for websites.",
  "concept": "HTTP",
  "understandingSummary": "The student mentions websites but confuses what HTTP is.",
  "knowledgeGap": "Does not know that HTTP is a transfer protocol.",
  "misconception": "Believes HTTP is a programming language.",
  "llmSeemsCorrect": false
}
```

## Baseline Mastery Calculation

`masteryPercentage = (correct attempts / total attempts) * 100`

This remains the simple research baseline.

## Week 7 LLM Flow

```
CLIENT (written answer)
  ↓ HTTP POST /analyze
EXPRESS
  ↓ load question + concept (SQL)
POSTGRESQL
  ↓ question context
EXPRESS
  ↓ prompt
GEMINI API
  ↓ JSON analysis
EXPRESS
  ↓ save analysis (SQL)
POSTGRESQL
  ↓
EXPRESS
  ↓ JSON
CLIENT
```

## FUTURE WORK (Not Implemented Yet)

- Adaptive next-question selection
- Full comparison experiments / evaluation metrics
- Authentication / authorization
- Frontend application
- Deployment
- Vector databases / RAG
