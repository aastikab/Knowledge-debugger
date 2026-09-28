# Knowledge Debugger

Adaptive-learning research prototype that studies how student knowledge gaps can be detected from learning attempts.

## Research Objective

This project will eventually compare two learner models:

1. **Baseline model (Progress Report 2 — implemented now):** simple correctness-based concept mastery using correct/incorrect answers.
2. **Future LLM-assisted model (FUTURE WORK — not implemented yet):** analyze written explanations for knowledge gaps and misconceptions.

Progress Report 2 only builds the database foundation, question/attempt APIs, and the simple baseline mastery calculation.

## Technologies Currently Used

- JavaScript
- Node.js
- Express
- PostgreSQL
- `pg` (PostgreSQL client for Node.js)
- `dotenv` (loads environment variables from `.env`)

## Project Structure

```
Knowledge-debugger/
├── .env.example          # Example database settings (no real password)
├── .gitignore            # Ignores node_modules/ and .env
├── package.json
├── README.md
├── sql/
│   ├── schema.sql        # Creates concepts, questions, attempts tables
│   └── seed.sql          # Sample concepts and questions
└── src/
    ├── db.js             # PostgreSQL connection pool
    └── server.js         # Express routes / API
```

## Database Tables

### 1. `concepts`
Stores the learning topics (for example: HTTP, APIs, Authentication).

| Column        | Purpose                          |
|---------------|----------------------------------|
| id            | Primary key                      |
| name          | Concept name                     |
| description   | Short description of the concept |
| created_at    | When the row was created         |

### 2. `questions`
Stores quiz questions. Each question belongs to one concept (`concept_id` foreign key).

| Column          | Purpose                              |
|-----------------|--------------------------------------|
| id              | Primary key                          |
| concept_id      | Foreign key → concepts(id)           |
| question_text   | The question shown to the learner    |
| expected_answer | Reference answer (for later use)     |
| difficulty      | easy / medium / etc.                 |
| created_at      | When the row was created             |

### 3. `attempts`
Stores each learner's submitted answer. Each attempt belongs to one question (`question_id` foreign key).

| Column           | Purpose                                    |
|------------------|--------------------------------------------|
| id               | Primary key                                |
| learner_id       | Simple text ID (no auth in this milestone) |
| question_id      | Foreign key → questions(id)                |
| submitted_answer | What the learner wrote                     |
| is_correct       | true / false (provided by the client)      |
| created_at       | When the attempt was recorded              |

## How to Install Dependencies

```bash
npm install
```

This installs Express, `pg`, and `dotenv`.

## How to Configure `.env`

1. Copy the example file:

```bash
cp .env.example .env
```

2. Edit `.env` and replace the placeholders with your local PostgreSQL values:

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=knowledge_debugger
DB_USER=your_postgres_username
DB_PASSWORD=your_postgres_password
```

Never commit `.env` (it is listed in `.gitignore`).

## How to Create / Configure the PostgreSQL Database

1. Make sure PostgreSQL is installed and running on your machine.
2. Create the database (example using `psql`):

```bash
psql -U postgres
```

Inside `psql`:

```sql
CREATE DATABASE knowledge_debugger;
\q
```

3. Put your real username and password into `.env`.

## How to Run `schema.sql`

From the project root:

```bash
psql -U your_postgres_username -d knowledge_debugger -f sql/schema.sql
```

This creates the `concepts`, `questions`, and `attempts` tables.

## How to Run `seed.sql`

```bash
psql -U your_postgres_username -d knowledge_debugger -f sql/seed.sql
```

This inserts 5 concepts and 10 sample questions (2 per concept).

## How to Start the Server

```bash
node src/server.js
```

You should see:

```
Server running on http://localhost:3000
```

## Current API Endpoints

| Method | Endpoint                    | Description                                      |
|--------|-----------------------------|--------------------------------------------------|
| GET    | `/`                         | Confirms the backend is running                  |
| GET    | `/questions`                | Returns all questions from PostgreSQL            |
| GET    | `/questions/:id`            | Returns one question by ID                       |
| POST   | `/attempts`                 | Records a student attempt                        |
| GET    | `/attempts?learnerId=...`   | Returns attempt history for a learner            |
| GET    | `/progress/:learnerId`      | Baseline concept mastery for a learner           |

## Example Requests

### 1. Confirm the server is running

```bash
curl http://localhost:3000/
```

### 2. Get all questions

```bash
curl http://localhost:3000/questions
```

### 3. Get one question

```bash
curl http://localhost:3000/questions/1
```

### 4. Record an attempt

```bash
curl -X POST http://localhost:3000/attempts \
  -H "Content-Type: application/json" \
  -d '{
    "learnerId": "demo-student",
    "questionId": 3,
    "answer": "HyperText Transfer Protocol.",
    "correct": true
  }'
```

### 5. Get attempt history

```bash
curl "http://localhost:3000/attempts?learnerId=demo-student"
```

### 6. Get baseline mastery progress

```bash
curl http://localhost:3000/progress/demo-student
```

## Baseline Mastery Calculation

For every concept the learner has attempted:

- **total attempts** = number of attempts linked to that concept
- **correct attempts** = attempts where `is_correct = true`
- **incorrect attempts** = attempts where `is_correct = false`
- **mastery percentage** = `(correct attempts / total attempts) * 100`

This is intentionally simple and interpretable. It is the research **baseline** model.

Example response:

```json
{
  "learnerId": "demo-student",
  "concepts": [
    {
      "conceptId": 2,
      "concept": "HTTP",
      "attempts": 4,
      "correct": 3,
      "incorrect": 1,
      "masteryPercentage": 75
    }
  ]
}
```

## FUTURE WORK (Not Implemented Yet)

The following belong to later progress reports and are **not** part of this codebase yet:

- LLM / OpenAI integration
- Semantic analysis of written explanations
- Misconception detection
- Adaptive next-question selection
- Authentication / authorization
- Frontend application
- Deployment

## Data Flow (Progress Report 2)

```
CLIENT
  ↓ HTTP
EXPRESS
  ↓ SQL
POSTGRESQL
  ↓ DATA
EXPRESS
  ↓ JSON
CLIENT
```
