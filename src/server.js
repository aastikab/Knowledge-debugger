require('dotenv').config();
const express = require('express');
const pool = require('./db');
const { analyzeWrittenAnswer } = require('./llm');
const { loadCurriculum, loadLearnerEvidence, toPromptCatalog } = require('./curriculum');
const { baselineMastery, llmLearnerState, selectNextQuestion } = require('./learnerModel');

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
      `SELECT id, concept_id, question_text, expected_answer, difficulty, probes_misconception_id
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
      `SELECT id, concept_id, question_text, expected_answer, difficulty, probes_misconception_id
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

    // Shape the JSON response
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
// POST /analyze  (LLM-assisted learner model)
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

    // The misconception catalog lets the LLM name a known misconception
    const catalogResult = await pool.query(
      `SELECT m.code, m.description, c.name AS concept_name
       FROM misconceptions m
       JOIN concepts c ON m.concept_id = c.id
       ORDER BY m.id`
    );

    // Call the LLM for semantic analysis
    const analysis = await analyzeWrittenAnswer({
      conceptName: question.concept_name,
      questionText: question.question_text,
      expectedAnswer: question.expected_answer,
      submittedAnswer: answer.trim(),
      misconceptionCatalog: toPromptCatalog(catalogResult.rows),
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
         llm_seems_correct,
         response_type,
         understanding_level,
         misconception_code,
         model,
         latency_ms,
         input_tokens,
         output_tokens
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING
         id,
         learner_id,
         question_id,
         submitted_answer,
         understanding_summary,
         knowledge_gap,
         misconception,
         llm_seems_correct,
         response_type,
         understanding_level,
         misconception_code,
         latency_ms`,
      [
        learnerId.trim(),
        parsedQuestionId,
        answer.trim(),
        analysis.understandingSummary,
        analysis.knowledgeGap,
        analysis.misconception,
        analysis.seemsCorrect,
        analysis.responseType,
        analysis.understandingLevel,
        analysis.misconceptionCode,
        analysis.model,
        analysis.latencyMs,
        analysis.inputTokens,
        analysis.outputTokens,
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
      misconceptionCode: row.misconception_code,
      responseType: row.response_type,
      understandingLevel: row.understanding_level,
      llmSeemsCorrect: row.llm_seems_correct,
      latencyMs: row.latency_ms,
      warnings: analysis.warnings,
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
// Return LLM analysis history for a learner
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
         llm_seems_correct,
         response_type,
         understanding_level,
         misconception_code
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
      misconceptionCode: row.misconception_code,
      responseType: row.response_type,
      understandingLevel: row.understanding_level,
      llmSeemsCorrect: row.llm_seems_correct,
    }));

    res.status(200).json(analyses);
  } catch (error) {
    console.error('Error fetching analyses:', error.message);
    res.status(500).json({ error: 'Failed to retrieve analyses' });
  }
});

// --------------------------------------------------
// GET /concepts
// Concepts with their prerequisites and known misconceptions
// --------------------------------------------------
app.get('/concepts', async (req, res) => {
  try {
    const { concepts, prerequisites, misconceptions } = await loadCurriculum(pool);

    const result = concepts.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      prerequisites: prerequisites
        .filter((p) => p.concept_id === c.id)
        .map((p) => p.prerequisite_id),
      misconceptions: misconceptions
        .filter((m) => m.concept_id === c.id)
        .map((m) => ({ code: m.code, description: m.description })),
    }));

    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching concepts:', error.message);
    res.status(500).json({ error: 'Failed to retrieve concepts' });
  }
});

// --------------------------------------------------
// GET /learner-model/:learnerId
// Side-by-side view of both learner models for one learner
// --------------------------------------------------
app.get('/learner-model/:learnerId', async (req, res) => {
  const learnerId = req.params.learnerId.trim();

  try {
    const curriculum = await loadCurriculum(pool);
    const evidence = await loadLearnerEvidence(pool, learnerId);
    const llmState = llmLearnerState(evidence.analyses, curriculum.misconceptions, curriculum.questions);

    res.status(200).json({
      learnerId,
      baseline: {
        evidenceCount: evidence.attempts.length,
        mastery: baselineMastery(evidence.attempts),
      },
      llm: {
        evidenceCount: evidence.analyses.length,
        mastery: llmState.mastery,
        activeMisconceptions: llmState.activeMisconceptions,
      },
    });
  } catch (error) {
    console.error('Error building learner model:', error.message);
    res.status(500).json({ error: 'Failed to build learner model' });
  }
});

// --------------------------------------------------
// GET /next-question/:learnerId?method=baseline|llm
// Adaptive next-question selection.
// Both methods use the same selection rule; only the evidence differs.
// --------------------------------------------------
app.get('/next-question/:learnerId', async (req, res) => {
  const learnerId = req.params.learnerId.trim();
  const method = req.query.method || 'llm';

  if (method !== 'baseline' && method !== 'llm') {
    return res.status(400).json({ error: 'method must be "baseline" or "llm"' });
  }

  try {
    const curriculum = await loadCurriculum(pool);
    const evidence = await loadLearnerEvidence(pool, learnerId);

    let mastery;
    let activeMisconceptions = [];
    let answeredQuestionIds;

    if (method === 'baseline') {
      mastery = baselineMastery(evidence.attempts);
      answeredQuestionIds = evidence.attempts.map((a) => a.question_id);
    } else {
      const llmState = llmLearnerState(evidence.analyses, curriculum.misconceptions, curriculum.questions);
      mastery = llmState.mastery;
      activeMisconceptions = llmState.activeMisconceptions;
      answeredQuestionIds = evidence.analyses.map((a) => a.question_id);
    }

    const selection = selectNextQuestion({
      ...curriculum,
      answeredQuestionIds,
      mastery,
      activeMisconceptions,
    });

    if (!selection) {
      return res.status(404).json({ error: 'No questions available' });
    }

    res.status(200).json({
      learnerId,
      method,
      question: {
        id: selection.question.id,
        conceptId: selection.question.concept_id,
        questionText: selection.question.question_text,
        difficulty: selection.question.difficulty,
      },
      rule: selection.rule,
      reason: selection.reason,
      mastery,
      activeMisconceptions,
    });
  } catch (error) {
    console.error('Error selecting next question:', error.message);
    res.status(500).json({ error: 'Failed to select next question' });
  }
});

// --------------------------------------------------
// Start the server
// --------------------------------------------------
const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
