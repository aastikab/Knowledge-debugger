-- Knowledge Debugger — Week 7 addition
-- Adds LLM analysis storage WITHOUT dropping Progress Report 2 tables.
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
