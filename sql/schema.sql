-- Knowledge Debugger — database schema
-- Baseline model: concepts, questions, attempts
-- LLM-assisted model: analyses
-- Learner model structure: concept_prerequisites, misconceptions, probe questions
-- Fresh install order: schema.sql -> seed.sql -> add_learner_model.sql

-- Drop tables in reverse dependency order if they already exist
DROP TABLE IF EXISTS analyses;
DROP TABLE IF EXISTS attempts;
DROP TABLE IF EXISTS questions;
DROP TABLE IF EXISTS misconceptions;
DROP TABLE IF EXISTS concept_prerequisites;
DROP TABLE IF EXISTS concepts;

-- 1. concepts: topics a learner can study
CREATE TABLE concepts (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- concept_prerequisites: which concepts build on which
CREATE TABLE concept_prerequisites (
  concept_id      INTEGER NOT NULL REFERENCES concepts(id),
  prerequisite_id INTEGER NOT NULL REFERENCES concepts(id),
  PRIMARY KEY (concept_id, prerequisite_id)
);

-- misconceptions: fixed catalog of known misconceptions
CREATE TABLE misconceptions (
  id          SERIAL PRIMARY KEY,
  concept_id  INTEGER NOT NULL REFERENCES concepts(id),
  code        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL
);

-- 2. questions: each question belongs to one concept
-- probes_misconception_id is set on targeted follow-up questions
CREATE TABLE questions (
  id                      SERIAL PRIMARY KEY,
  concept_id              INTEGER NOT NULL REFERENCES concepts(id),
  question_text           TEXT NOT NULL,
  expected_answer         TEXT NOT NULL,
  difficulty              TEXT NOT NULL,
  probes_misconception_id INTEGER REFERENCES misconceptions(id),
  created_at              TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 3. attempts: each attempt belongs to one question
-- learner_id is plain TEXT (no auth/users table yet)
CREATE TABLE attempts (
  id               SERIAL PRIMARY KEY,
  learner_id       TEXT NOT NULL,
  question_id      INTEGER NOT NULL REFERENCES questions(id),
  submitted_answer TEXT NOT NULL,
  is_correct       BOOLEAN NOT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 4. analyses: LLM analysis of a written student answer
-- Separate from attempts so we can compare baseline vs LLM models
CREATE TABLE analyses (
  id                    SERIAL PRIMARY KEY,
  learner_id            TEXT NOT NULL,
  question_id           INTEGER NOT NULL REFERENCES questions(id),
  submitted_answer      TEXT NOT NULL,
  understanding_summary TEXT NOT NULL,
  knowledge_gap         TEXT,
  misconception         TEXT,
  llm_seems_correct     BOOLEAN NOT NULL,
  -- learner-model and cost fields
  response_type         TEXT,     -- correct | partial | incorrect | misconception
  understanding_level   INTEGER,  -- 0-100 estimate from the LLM
  misconception_code    TEXT,     -- code from the misconceptions catalog, or null
  model                 TEXT,
  latency_ms            INTEGER,
  input_tokens          INTEGER,
  output_tokens         INTEGER,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW()
);
