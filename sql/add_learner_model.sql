-- Knowledge Debugger — learner model migration
-- Adds the learner-model structure needed for adaptive question selection
-- and for scoring the LLM against a labeled evaluation set:
--   * concept_prerequisites  (which concepts build on which)
--   * misconceptions         (fixed catalog of known misconceptions)
--   * questions.probes_misconception_id (targeted follow-up questions)
--   * extra analyses columns (response type, understanding level, cost data)
-- Safe to run on an existing database that already has the analyses table (does not drop anything).

-- 1. Prerequisite relationships between concepts
CREATE TABLE IF NOT EXISTS concept_prerequisites (
  concept_id      INTEGER NOT NULL REFERENCES concepts(id),
  prerequisite_id INTEGER NOT NULL REFERENCES concepts(id),
  PRIMARY KEY (concept_id, prerequisite_id)
);

-- 2. Known misconceptions. Giving the LLM a fixed list lets us check
--    whether it picked the right one, instead of comparing free text.
CREATE TABLE IF NOT EXISTS misconceptions (
  id          SERIAL PRIMARY KEY,
  concept_id  INTEGER NOT NULL REFERENCES concepts(id),
  code        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL
);

-- 3. A probe question is designed to confirm one specific misconception
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS probes_misconception_id INTEGER REFERENCES misconceptions(id);

-- 4. Richer LLM analysis + data needed to measure latency and cost
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS response_type       TEXT;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS understanding_level INTEGER;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS misconception_code  TEXT;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS model               TEXT;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS latency_ms          INTEGER;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS input_tokens        INTEGER;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS output_tokens       INTEGER;

-- ----- Data (only inserted if not already present) -----

INSERT INTO concept_prerequisites (concept_id, prerequisite_id) VALUES
  (2, 1),  -- HTTP builds on Client and Server
  (3, 2),  -- APIs build on HTTP
  (4, 2),  -- Authentication builds on HTTP
  (5, 4)   -- Authorization builds on Authentication
ON CONFLICT DO NOTHING;

INSERT INTO misconceptions (id, concept_id, code, description) VALUES
  (1, 1, 'CLIENT_SERVER_REVERSED',       'Believes the server starts the conversation / mixes up client and server roles.'),
  (2, 1, 'SERVER_IS_HARDWARE_ONLY',      'Believes a server must be a special physical machine rather than a role any program can play.'),
  (3, 2, 'HTTP_IS_LANGUAGE',             'Believes HTTP is a programming or markup language instead of a communication protocol.'),
  (4, 2, 'GET_POST_CONFUSION',           'Believes POST (or another method) is used to retrieve data, or that GET is meant to change data.'),
  (5, 3, 'API_IS_DATABASE',              'Believes an API is where data is stored, i.e. confuses an API with a database.'),
  (6, 3, 'API_IS_UI',                    'Believes an API is the visual user interface / website that people click on.'),
  (7, 4, 'ENCRYPTION_IS_AUTHENTICATION', 'Believes encryption/HTTPS by itself verifies who the user is.'),
  (8, 5, 'AUTHN_AUTHZ_CONFUSION',        'Believes authentication (logging in) decides what a user is allowed to access.')
ON CONFLICT DO NOTHING;

SELECT setval('misconceptions_id_seq', (SELECT MAX(id) FROM misconceptions));

-- Probe questions (one per misconception). Only added once.
INSERT INTO questions (concept_id, question_text, expected_answer, difficulty, probes_misconception_id)
SELECT v.concept_id, v.question_text, v.expected_answer, v.difficulty, v.probes_misconception_id
FROM (VALUES
  (1, 'True or false: the server usually sends the first message to start a conversation with a client. Explain.',
      'False. The client starts by sending a request; the server listens and responds.', 'medium', 1),
  (1, 'Can a program running on your own laptop be a server, or must a server be a special machine? Explain.',
      'Yes. "Server" is a role: any program that listens for and answers requests is a server, even on a laptop.', 'medium', 2),
  (2, 'Do developers write programs in HTTP? Explain what kind of thing HTTP is.',
      'No. HTTP is a protocol: a set of rules for how clients and servers format and exchange requests and responses.', 'medium', 3),
  (2, 'Which HTTP method should a client use to read a user profile without changing anything, and why?',
      'GET, because it retrieves data and should not change anything on the server.', 'medium', 4),
  (3, 'Does an API store an application''s data? Explain what an API does.',
      'No. An API defines how software can request data or actions; the data is usually stored in a database behind it.', 'medium', 5),
  (3, 'Is an API the same thing as a website''s user interface? Explain.',
      'No. An API is how programs talk to each other; a user interface is what people see and click on.', 'medium', 6),
  (4, 'If a website uses HTTPS encryption, does that by itself prove who the user is? Explain.',
      'No. HTTPS protects data while it travels; authentication is a separate step that verifies the user''s identity.', 'medium', 7),
  (5, 'A user has logged in successfully. Does that mean they can delete other users'' accounts? Explain which concept decides this.',
      'No. Logging in is authentication; authorization separately decides which actions that user is permitted to perform.', 'medium', 8)
) AS v(concept_id, question_text, expected_answer, difficulty, probes_misconception_id)
WHERE NOT EXISTS (SELECT 1 FROM questions WHERE probes_misconception_id IS NOT NULL);
