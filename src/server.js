require('dotenv').config();
const express = require('express');
const pool = require('./db');
const { analyzeWrittenAnswer } = require('./llm');

const app = express();

// Allow Express to read JSON request bodies (needed for POST /attempts)
app.use(express.json());

// --------------------------------------------------
// GET /
// Confirms that the backend is running
// --------------------------------------------------
app.get('/', (req, res) => {
  res.send('Knowledge Debugger Backend is running!');
});

// --------------------------------------------------
// GET /questions
// Retrieve all questions from PostgreSQL
// --------------------------------------------------
app.get('/questions', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, concept_id, question_text, expected_answer, difficulty
       FROM questions
       ORDER BY id`
    );
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching questions:', error.message);
    res.status(500).json({ error: 'Failed to retrieve questions' });
  }
});

// --------------------------------------------------
// GET /questions/:id
// Retrieve one question by ID from PostgreSQL
// --------------------------------------------------
app.get('/questions/:id', async (req, res) => {
  const questionId = Number(req.params.id);

  // Invalid ID (not a number) -> 400
  if (!Number.isInteger(questionId) || questionId < 1) {
    return res.status(400).json({ error: 'Invalid question ID. Must be a positive integer.' });
  }

  try {
    const result = await pool.query(
      `SELECT id, concept_id, question_text, expected_answer, difficulty
       FROM questions
       WHERE id = $1`,
      [questionId]
    );

    // Nonexistent question -> 404
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }

    // Valid question -> 200
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching question:', error.message);
    res.status(500).json({ error: 'Failed to retrieve question' });
  }
});

// --------------------------------------------------
// POST /attempts
// Record a student attempt
// Body example:
// {
//   "learnerId": "demo-student",
//   "questionId": 3,
//   "answer": "Authentication verifies a user's identity.",
//   "correct": true
// }
// --------------------------------------------------
app.post('/attempts', async (req, res) => {
  const { learnerId, questionId, answer, correct } = req.body;

  // Validate required fields
  if (
    learnerId === undefined ||
    questionId === undefined ||
    answer === undefined ||
    correct === undefined
  ) {
    return res.status(400).json({
      error: 'Missing required fields. Need: learnerId, questionId, answer, correct',
    });
  }

  if (typeof learnerId !== 'string' || learnerId.trim() === '') {
    return res.status(400).json({ error: 'learnerId must be a non-empty string' });
  }

  const parsedQuestionId = Number(questionId);
  if (!Number.isInteger(parsedQuestionId) || parsedQuestionId < 1) {
    return res.status(400).json({ error: 'questionId must be a positive integer' });
  }

  if (typeof answer !== 'string' || answer.trim() === '') {
    return res.status(400).json({ error: 'answer must be a non-empty string' });
  }

  if (typeof correct !== 'boolean') {
    return res.status(400).json({ error: 'correct must be true or false' });
  }

  try {
    // Verify the referenced question exists
    const questionCheck = await pool.query(
      'SELECT id FROM questions WHERE id = $1',
      [parsedQuestionId]
    );

    if (questionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }

    // Store the attempt in PostgreSQL
    const result = await pool.query(
      `INSERT INTO attempts (learner_id, question_id, submitted_answer, is_correct)
       VALUES ($1, $2, $3, $4)
       RETURNING id, learner_id, question_id, submitted_answer, is_correct`,
      [learnerId.trim(), parsedQuestionId, answer.trim(), correct]
    );

    // 201 Created
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error recording attempt:', error.message);
    res.status(500).json({ error: 'Failed to record attempt' });
  }
});

// --------------------------------------------------
// GET /attempts?learnerId=demo-student
// Return attempt history for a learner
// --------------------------------------------------
app.get('/attempts', async (req, res) => {
  const { learnerId } = req.query;

  if (!learnerId || typeof learnerId !== 'string' || learnerId.trim() === '') {
    return res.status(400).json({
      error: 'Missing or invalid learnerId query parameter. Example: /attempts?learnerId=demo-student',
    });
  }

  try {
    const result = await pool.query(
      `SELECT id, learner_id, question_id, submitted_answer, is_correct
       FROM attempts
       WHERE learner_id = $1
       ORDER BY id`,
      [learnerId.trim()]
    );

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching attempts:', error.message);
    res.status(500).json({ error: 'Failed to retrieve attempts' });
  }
});

// --------------------------------------------------
// GET /progress/:learnerId
// Baseline learner model: correctness-based concept mastery
// masteryPercentage = (correct attempts / total attempts) * 100
// --------------------------------------------------
app.get('/progress/:learnerId', async (req, res) => {
  const learnerId = req.params.learnerId;

  if (!learnerId || learnerId.trim() === '') {
    return res.status(400).json({ error: 'learnerId is required' });
  }

  try {
    // Join attempts -> questions -> concepts, then group by concept
    const result = await pool.query(
      `SELECT
         c.id AS concept_id,
         c.name AS concept,
         COUNT(a.id)::INTEGER AS attempts,
         COUNT(a.id) FILTER (WHERE a.is_correct = TRUE)::INTEGER AS correct,
         COUNT(a.id) FILTER (WHERE a.is_correct = FALSE)::INTEGER AS incorrect,
         ROUND(
           (COUNT(a.id) FILTER (WHERE a.is_correct = TRUE)::NUMERIC / COUNT(a.id)) * 100
         )::INTEGER AS mastery_percentage
       FROM attempts a
       JOIN questions q ON a.question_id = q.id
       JOIN concepts c ON q.concept_id = c.id
       WHERE a.learner_id = $1
       GROUP BY c.id, c.name
       ORDER BY c.id`,
      [learnerId.trim()]
    );

    // Shape the JSON to match the Progress Report 2 example
    const concepts = result.rows.map((row) => ({
      conceptId: row.concept_id,
      concept: row.concept,
      attempts: row.attempts,
      correct: row.correct,
      incorrect: row.incorrect,
      masteryPercentage: row.mastery_percentage,
    }));

    res.status(200).json({
      learnerId: learnerId.trim(),
      concepts,
    });
  } catch (error) {
    console.error('Error calculating progress:', error.message);
    res.status(500).json({ error: 'Failed to calculate progress' });
  }
});

// --------------------------------------------------
// POST /analyze  (Week 7 — LLM-assisted learner model)
// Accept a written answer, send it to the LLM, store the analysis.
// Body example:
// {
//   "learnerId": "demo-student",
//   "questionId": 3,
//   "answer": "HTTP is the protocol browsers use to talk to servers."
// }
// --------------------------------------------------
app.post('/analyze', async (req, res) => {
  const { learnerId, questionId, answer } = req.body;

  if (learnerId === undefined || questionId === undefined || answer === undefined) {
    return res.status(400).json({
      error: 'Missing required fields. Need: learnerId, questionId, answer',
    });
  }

  if (typeof learnerId !== 'string' || learnerId.trim() === '') {
    return res.status(400).json({ error: 'learnerId must be a non-empty string' });
  }

  const parsedQuestionId = Number(questionId);
  if (!Number.isInteger(parsedQuestionId) || parsedQuestionId < 1) {
    return res.status(400).json({ error: 'questionId must be a positive integer' });
  }

  if (typeof answer !== 'string' || answer.trim() === '') {
    return res.status(400).json({ error: 'answer must be a non-empty string' });
  }

  try {
    // Load the question and its concept from PostgreSQL
    const questionResult = await pool.query(
      `SELECT
         q.id,
         q.question_text,
         q.expected_answer,
         c.name AS concept_name
       FROM questions q
       JOIN concepts c ON q.concept_id = c.id
       WHERE q.id = $1`,
      [parsedQuestionId]
    );

    if (questionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }

    const question = questionResult.rows[0];

    // Call the LLM for semantic analysis
    const analysis = await analyzeWrittenAnswer({
      conceptName: question.concept_name,
      questionText: question.question_text,
      expectedAnswer: question.expected_answer,
      submittedAnswer: answer.trim(),
    });

    // Store the LLM analysis in PostgreSQL
    const insertResult = await pool.query(
      `INSERT INTO analyses (
         learner_id,
         question_id,
         submitted_answer,
         understanding_summary,
         knowledge_gap,
         misconception,
         llm_seems_correct
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING
         id,
         learner_id,
         question_id,
         submitted_answer,
         understanding_summary,
         knowledge_gap,
         misconception,
         llm_seems_correct`,
      [
        learnerId.trim(),
        parsedQuestionId,
        answer.trim(),
        analysis.understandingSummary,
        analysis.knowledgeGap,
        analysis.misconception,
        analysis.seemsCorrect,
      ]
    );

    const row = insertResult.rows[0];

    // Shape a clear beginner-friendly JSON response
    res.status(201).json({
      id: row.id,
      learnerId: row.learner_id,
      questionId: row.question_id,
      answer: row.submitted_answer,
      concept: question.concept_name,
      understandingSummary: row.understanding_summary,
      knowledgeGap: row.knowledge_gap,
      misconception: row.misconception,
      llmSeemsCorrect: row.llm_seems_correct,
    });
  } catch (error) {
    console.error('Error analyzing answer:', error.message);
    res.status(500).json({
      error: 'Failed to analyze answer',
      details: error.message,
    });
  }
});

// --------------------------------------------------
// GET /analyses?learnerId=demo-student
// Return LLM analysis history for a learner (Week 7)
// --------------------------------------------------
app.get('/analyses', async (req, res) => {
  const { learnerId } = req.query;

  if (!learnerId || typeof learnerId !== 'string' || learnerId.trim() === '') {
    return res.status(400).json({
      error: 'Missing or invalid learnerId query parameter. Example: /analyses?learnerId=demo-student',
    });
  }

  try {
    const result = await pool.query(
      `SELECT
         id,
         learner_id,
         question_id,
         submitted_answer,
         understanding_summary,
         knowledge_gap,
         misconception,
         llm_seems_correct
       FROM analyses
       WHERE learner_id = $1
       ORDER BY id`,
      [learnerId.trim()]
    );

    const analyses = result.rows.map((row) => ({
      id: row.id,
      learnerId: row.learner_id,
      questionId: row.question_id,
      answer: row.submitted_answer,
      understandingSummary: row.understanding_summary,
      knowledgeGap: row.knowledge_gap,
      misconception: row.misconception,
      llmSeemsCorrect: row.llm_seems_correct,
    }));

    res.status(200).json(analyses);
  } catch (error) {
    console.error('Error fetching analyses:', error.message);
    res.status(500).json({ error: 'Failed to retrieve analyses' });
  }
});

// --------------------------------------------------
// Start the server
// --------------------------------------------------
app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
