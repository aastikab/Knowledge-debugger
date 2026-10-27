/**
 * Database loaders shared by the API (server.js) and the evaluation script.
 */

// Load everything the learner models need to know about the learning domain
async function loadCurriculum(pool) {
  const [concepts, prerequisites, questions, misconceptions] = await Promise.all([
    pool.query('SELECT id, name, description FROM concepts ORDER BY id'),
    pool.query('SELECT concept_id, prerequisite_id FROM concept_prerequisites ORDER BY concept_id, prerequisite_id'),
    pool.query(
      `SELECT id, concept_id, question_text, expected_answer, difficulty, probes_misconception_id
       FROM questions
       ORDER BY id`
    ),
    pool.query(
      `SELECT m.id, m.concept_id, m.code, m.description, c.name AS concept_name
       FROM misconceptions m
       JOIN concepts c ON m.concept_id = c.id
       ORDER BY m.id`
    ),
  ]);

  return {
    concepts: concepts.rows,
    prerequisites: prerequisites.rows,
    questions: questions.rows,
    misconceptions: misconceptions.rows,
  };
}

// Load a learner's baseline attempts and LLM analyses (oldest first)
async function loadLearnerEvidence(pool, learnerId) {
  const [attempts, analyses] = await Promise.all([
    pool.query(
      `SELECT a.id, a.question_id, q.concept_id, a.is_correct
       FROM attempts a
       JOIN questions q ON a.question_id = q.id
       WHERE a.learner_id = $1
       ORDER BY a.id`,
      [learnerId]
    ),
    pool.query(
      `SELECT an.id, an.question_id, q.concept_id, an.understanding_level,
              an.misconception_code, an.response_type, an.llm_seems_correct
       FROM analyses an
       JOIN questions q ON an.question_id = q.id
       WHERE an.learner_id = $1
       ORDER BY an.id`,
      [learnerId]
    ),
  ]);

  return { attempts: attempts.rows, analyses: analyses.rows };
}

// Shape the catalog the way the LLM prompt expects it
function toPromptCatalog(misconceptions) {
  return misconceptions.map((m) => ({
    code: m.code,
    conceptName: m.concept_name,
    description: m.description,
  }));
}

module.exports = { loadCurriculum, loadLearnerEvidence, toPromptCatalog };
