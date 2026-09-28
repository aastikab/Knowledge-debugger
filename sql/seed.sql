-- Knowledge Debugger — Progress Report 2 seed data
-- Small controlled dataset for demonstrating the project.

-- Clear existing data (safe to re-run after schema.sql)
TRUNCATE attempts, questions, concepts RESTART IDENTITY CASCADE;

-- ----- Concepts (5) -----
INSERT INTO concepts (name, description) VALUES
  ('Client and Server', 'Basic roles of clients and servers in networked applications.'),
  ('HTTP', 'How HTTP requests and responses work on the web.'),
  ('APIs', 'Application Programming Interfaces that let systems communicate.'),
  ('Authentication', 'Verifying who a user is.'),
  ('Authorization', 'Controlling what an authenticated user is allowed to do.');

-- ----- Questions (2 per concept = 10 total) -----

-- Client and Server (concept_id = 1)
INSERT INTO questions (concept_id, question_text, expected_answer, difficulty) VALUES
  (1, 'What is a client in a networked application?', 'A client is a program or device that requests resources or services from a server.', 'easy'),
  (1, 'What is a server in a networked application?', 'A server is a program or computer that listens for requests and provides responses or resources to clients.', 'easy');

-- HTTP (concept_id = 2)
INSERT INTO questions (concept_id, question_text, expected_answer, difficulty) VALUES
  (2, 'What does HTTP stand for?', 'HyperText Transfer Protocol.', 'easy'),
  (2, 'Name one common HTTP method used to retrieve data.', 'GET', 'easy');

-- APIs (concept_id = 3)
INSERT INTO questions (concept_id, question_text, expected_answer, difficulty) VALUES
  (3, 'What is an API?', 'An API is an interface that lets one software system request and exchange data with another in a defined way.', 'easy'),
  (3, 'What does REST commonly use to identify resources?', 'URLs (or URIs).', 'medium');

-- Authentication (concept_id = 4)
INSERT INTO questions (concept_id, question_text, expected_answer, difficulty) VALUES
  (4, 'What is authentication?', 'Authentication verifies a user''s identity.', 'easy'),
  (4, 'Give one common way a user can authenticate.', 'Username and password.', 'easy');

-- Authorization (concept_id = 5)
INSERT INTO questions (concept_id, question_text, expected_answer, difficulty) VALUES
  (5, 'What is authorization?', 'Authorization determines what actions or resources an authenticated user is allowed to access.', 'easy'),
  (5, 'How is authorization different from authentication?', 'Authentication checks who you are; authorization checks what you are allowed to do.', 'medium');
