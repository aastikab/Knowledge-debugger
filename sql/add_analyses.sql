-- Knowledge Debugger — analyses table migration
-- Adds LLM analysis storage WITHOUT dropping the existing baseline tables.
-- Safe to run on an existing knowledge_debugger database.

CREATE TABLE IF NOT EXISTS analyses (
  id                 SERIAL PRIMARY KEY,
  learner_id         TEXT NOT NULL,
  question_id        INTEGER NOT NULL REFERENCES questions(id),
  submitted_answer   TEXT NOT NULL,
  understanding_summary TEXT NOT NULL,
  knowledge_gap      TEXT,
  misconception      TEXT,
  llm_seems_correct  BOOLEAN NOT NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW()
);
