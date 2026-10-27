/**
 * Learner models and adaptive next-question selection.
 *
 * These are plain functions (no database access) so that the API and the
 * evaluation script use exactly the same logic.
 *
 * Both learner models feed the SAME selection rule. The only difference is
 * the evidence they provide:
 *   - baseline: mastery from correct/incorrect attempts only
 *   - llm:      mastery from LLM understanding levels + suspected misconceptions
 * This keeps the comparison controlled.
 */

// A concept below this mastery percentage is treated as a knowledge gap
const MASTERY_THRESHOLD = 70;

// When an answer to one concept's question reveals a misconception that
// belongs to a DIFFERENT concept, that other concept receives this much
// mastery evidence (e.g. an authentication answer showing authn/authz confusion
// counts as weak evidence about Authorization).
const MISCONCEPTION_EVIDENCE_LEVEL = 25;

const DIFFICULTY_ORDER = { easy: 0, medium: 1, hard: 2 };

// --------------------------------------------------
// Baseline learner model
// attemptRows: [{ concept_id, is_correct }]
// Returns { [conceptId]: masteryPercentage }
// masteryPercentage = (correct attempts / total attempts) * 100
// --------------------------------------------------
function baselineMastery(attemptRows) {
  const counts = {};

  for (const row of attemptRows) {
    if (!counts[row.concept_id]) {
      counts[row.concept_id] = { total: 0, correct: 0 };
    }
    counts[row.concept_id].total += 1;
    if (row.is_correct) counts[row.concept_id].correct += 1;
  }

  const mastery = {};
  for (const [conceptId, c] of Object.entries(counts)) {
    mastery[conceptId] = Math.round((c.correct / c.total) * 100);
  }
  return mastery;
}

// --------------------------------------------------
// LLM-assisted learner model
// analysisRows (oldest first): [{ question_id, concept_id, understanding_level,
//   misconception_code, response_type, llm_seems_correct }]
// misconceptions: [{ id, code, concept_id }]
// questions: [{ id, probes_misconception_id }]
// Returns { mastery: { [conceptId]: 0-100 }, activeMisconceptions: [{ code, conceptId }] }
// --------------------------------------------------
function llmLearnerState(analysisRows, misconceptions, questions) {
  const misconceptionByCode = Object.fromEntries(misconceptions.map((m) => [m.code, m]));
  const misconceptionById = Object.fromEntries(misconceptions.map((m) => [m.id, m]));
  const questionById = Object.fromEntries(questions.map((q) => [q.id, q]));

  const evidence = {};
  const addEvidence = (conceptId, level) => {
    if (!evidence[conceptId]) evidence[conceptId] = [];
    evidence[conceptId].push(level);
  };

  // Ordered list; most recently detected misconception is last
  let active = [];

  for (const row of analysisRows) {
    // Older analyses have no understanding_level, so fall back to the correct/incorrect flag
    const level = row.understanding_level ?? (row.llm_seems_correct ? 75 : 25);
    addEvidence(row.concept_id, level);

    const detected = misconceptionByCode[row.misconception_code];
    if (detected) {
      if (detected.concept_id !== row.concept_id) {
        addEvidence(detected.concept_id, MISCONCEPTION_EVIDENCE_LEVEL);
      }
      active = active.filter((code) => code !== detected.code);
      active.push(detected.code);
    }

    // A correct answer to a probe question clears the misconception it probes
    const question = questionById[row.question_id];
    const probed = question && misconceptionById[question.probes_misconception_id];
    if (probed && row.response_type === 'correct' && row.misconception_code !== probed.code) {
      active = active.filter((code) => code !== probed.code);
    }
  }

  const mastery = {};
  for (const [conceptId, levels] of Object.entries(evidence)) {
    mastery[conceptId] = Math.round(levels.reduce((sum, l) => sum + l, 0) / levels.length);
  }

  return {
    mastery,
    activeMisconceptions: active.map((code) => ({
      code,
      conceptId: misconceptionByCode[code].concept_id,
    })),
  };
}

// --------------------------------------------------
// Adaptive next-question selection (shared by both methods)
//
// Rules, in order:
//   1. If a misconception is suspected, ask an unanswered probe question for
//      the most recently suspected one (only the LLM model can suspect these).
//   2. Otherwise target the weakest concept below the threshold; if there is
//      none, the first concept without evidence; if all are mastered, the
//      lowest-mastery concept (review).
//   3. If the target has a prerequisite that is weak or untested, move to the
//      prerequisite first (repeat until the foundation is solid).
//   4. Inside the target concept, ask the easiest unanswered question.
// --------------------------------------------------
function selectNextQuestion({
  concepts,
  prerequisites,
  questions,
  misconceptions,
  answeredQuestionIds = [],
  mastery = {},
  activeMisconceptions = [],
  threshold = MASTERY_THRESHOLD,
}) {
  const answered = new Set(answeredQuestionIds.map(Number));
  const conceptById = Object.fromEntries(concepts.map((c) => [c.id, c]));
  const masteryOf = (conceptId) => mastery[conceptId];
  const isWeakOrUnseen = (conceptId) =>
    masteryOf(conceptId) === undefined || masteryOf(conceptId) < threshold;

  // Rule 1: probe the most recent suspected misconception
  for (const suspected of [...activeMisconceptions].reverse()) {
    const misconception = misconceptions.find((m) => m.code === suspected.code);
    const probe = misconception && questions.find(
      (q) => q.probes_misconception_id === misconception.id && !answered.has(q.id)
    );
    if (probe) {
      return {
        question: probe,
        conceptId: probe.concept_id,
        rule: 'misconception-probe',
        reason: `Suspected misconception ${suspected.code}; asking a probe question to confirm it.`,
      };
    }
  }

  // Rule 2: choose a target concept
  const byId = (a, b) => a.id - b.id;
  const weak = concepts
    .filter((c) => masteryOf(c.id) !== undefined && masteryOf(c.id) < threshold)
    .sort((a, b) => masteryOf(a.id) - masteryOf(b.id) || byId(a, b));
  const unseen = concepts.filter((c) => masteryOf(c.id) === undefined).sort(byId);

  let target;
  let rule;
  if (weak.length > 0) {
    target = weak[0];
    rule = 'weakest-concept';
  } else if (unseen.length > 0) {
    target = unseen[0];
    rule = 'unseen-concept';
  } else {
    target = [...concepts].sort((a, b) => masteryOf(a.id) - masteryOf(b.id) || byId(a, b))[0];
    rule = 'review';
  }
  if (!target) return null;

  let reason = describeTarget(target, rule, masteryOf(target.id));

  // Rule 3: walk down to a weak or untested prerequisite
  const visited = new Set([target.id]);
  while (rule !== 'review') {
    const weakPrereq = prerequisites
      .filter((p) => p.concept_id === target.id && !visited.has(p.prerequisite_id))
      .map((p) => conceptById[p.prerequisite_id])
      .filter((c) => c && isWeakOrUnseen(c.id))
      .sort((a, b) => (masteryOf(a.id) ?? -1) - (masteryOf(b.id) ?? -1) || byId(a, b))[0];

    if (!weakPrereq) break;
    reason += ` Its prerequisite ${weakPrereq.name} is ${
      masteryOf(weakPrereq.id) === undefined ? 'untested' : `weak (${masteryOf(weakPrereq.id)}%)`
    }, so it is checked first.`;
    target = weakPrereq;
    rule = 'prerequisite';
    visited.add(target.id);
  }

  // Rule 4: easiest unanswered regular question, then probes, then allow a repeat
  const inConcept = questions
    .filter((q) => q.concept_id === target.id)
    .sort(
      (a, b) =>
        (DIFFICULTY_ORDER[a.difficulty] ?? 9) - (DIFFICULTY_ORDER[b.difficulty] ?? 9) || a.id - b.id
    );
  const question =
    inConcept.find((q) => !answered.has(q.id) && !q.probes_misconception_id) ||
    inConcept.find((q) => !answered.has(q.id)) ||
    inConcept[0];

  if (!question) return null;

  return { question, conceptId: target.id, rule, reason };
}

function describeTarget(concept, rule, mastery) {
  if (rule === 'weakest-concept') return `${concept.name} is the weakest concept (${mastery}%).`;
  if (rule === 'unseen-concept') return `${concept.name} has no evidence yet.`;
  return `All concepts are at or above the threshold; reviewing ${concept.name} (${mastery}%).`;
}

module.exports = {
  MASTERY_THRESHOLD,
  MISCONCEPTION_EVIDENCE_LEVEL,
  baselineMastery,
  llmLearnerState,
  selectNextQuestion,
};
