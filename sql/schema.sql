-- Knowledge Debugger — Progress Report 2 schema
-- Creates the three tables needed for concepts, questions, and attempts.

-- Drop tables in reverse dependency order if they already exist
DROP TABLE IF EXISTS attempts;
DROP TABLE IF EXISTS questions;
DROP TABLE IF EXISTS concepts;

-- 1. concepts: topics a learner can study
CREATE TABLE concepts (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 2. questions: each question belongs to one concept
CREATE TABLE questions (
  id              SERIAL PRIMARY KEY,
  concept_id      INTEGER NOT NULL REFERENCES concepts(id),
  question_text   TEXT NOT NULL,
  expected_answer TEXT NOT NULL,
  difficulty      TEXT NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 3. attempts: each attempt belongs to one question
-- learner_id is plain TEXT (no auth/users table in Progress Report 2)
CREATE TABLE attempts (
  id               SERIAL PRIMARY KEY,
  learner_id       TEXT NOT NULL,
  question_id      INTEGER NOT NULL REFERENCES questions(id),
  submitted_answer TEXT NOT NULL,
  is_correct       BOOLEAN NOT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);
