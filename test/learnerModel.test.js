const test = require('node:test');
const assert = require('node:assert');
const { baselineMastery, llmLearnerState, selectNextQuestion } = require('../src/learnerModel');
const { curriculum } = require('./fixtures');

test('baselineMastery is correct / total * 100 per concept', () => {
  const mastery = baselineMastery([
    { concept_id: 2, is_correct: true },
    { concept_id: 2, is_correct: true },
    { concept_id: 2, is_correct: true },
    { concept_id: 2, is_correct: false },
    { concept_id: 5, is_correct: false },
  ]);
  assert.deepStrictEqual(mastery, { 2: 75, 5: 0 });
});

test('llmLearnerState averages levels and gives cross-concept misconception evidence', () => {
  const state = llmLearnerState(
    [
      { question_id: 7, concept_id: 4, understanding_level: 60, misconception_code: 'AUTHN_AUTHZ_CONFUSION', response_type: 'misconception' },
      { question_id: 9, concept_id: 5, understanding_level: 95, misconception_code: null, response_type: 'correct' },
    ],
    curriculum.misconceptions,
    curriculum.questions
  );
  assert.strictEqual(state.mastery[4], 60);
  assert.strictEqual(state.mastery[5], 60); // (25 + 95) / 2
  assert.deepStrictEqual(state.activeMisconceptions, [{ code: 'AUTHN_AUTHZ_CONFUSION', conceptId: 5 }]);
});

test('a correct answer to the probe question clears the misconception', () => {
  const state = llmLearnerState(
    [
      { question_id: 3, concept_id: 2, understanding_level: 40, misconception_code: 'HTTP_IS_LANGUAGE', response_type: 'misconception' },
      { question_id: 13, concept_id: 2, understanding_level: 90, misconception_code: null, response_type: 'correct' },
    ],
    curriculum.misconceptions,
    curriculum.questions
  );
  assert.deepStrictEqual(state.activeMisconceptions, []);
});

test('older analyses without a level fall back to the correct/incorrect flag', () => {
  const state = llmLearnerState(
    [{ question_id: 3, concept_id: 2, understanding_level: null, llm_seems_correct: false }],
    curriculum.misconceptions,
    curriculum.questions
  );
  assert.strictEqual(state.mastery[2], 25);
});

test('selection probes a suspected misconception first', () => {
  const selection = selectNextQuestion({
    ...curriculum,
    answeredQuestionIds: [1, 3, 5, 7, 9],
    mastery: { 1: 100, 2: 100, 3: 100, 4: 100, 5: 100 },
    activeMisconceptions: [{ code: 'AUTHN_AUTHZ_CONFUSION', conceptId: 5 }],
  });
  assert.strictEqual(selection.question.id, 18);
  assert.strictEqual(selection.rule, 'misconception-probe');
});

test('selection targets the weakest concept and skips answered questions', () => {
  const selection = selectNextQuestion({
    ...curriculum,
    answeredQuestionIds: [1, 3, 5, 7, 9],
    mastery: { 1: 100, 2: 100, 3: 50, 4: 100, 5: 0 },
  });
  assert.strictEqual(selection.conceptId, 5);
  assert.strictEqual(selection.question.id, 10);
  assert.strictEqual(selection.rule, 'weakest-concept');
});

test('selection checks a weak prerequisite before the target concept', () => {
  const selection = selectNextQuestion({
    ...curriculum,
    answeredQuestionIds: [1, 3, 7, 9],
    mastery: { 1: 100, 2: 100, 4: 50, 5: 0 },
  });
  assert.strictEqual(selection.conceptId, 4);
  assert.strictEqual(selection.rule, 'prerequisite');
});

test('selection reviews the lowest concept when everything is mastered', () => {
  const selection = selectNextQuestion({
    ...curriculum,
    answeredQuestionIds: [],
    mastery: { 1: 100, 2: 90, 3: 100, 4: 100, 5: 100 },
  });
  assert.strictEqual(selection.conceptId, 2);
  assert.strictEqual(selection.rule, 'review');
});

test('a brand-new learner starts with the first concept', () => {
  const selection = selectNextQuestion({ ...curriculum });
  assert.strictEqual(selection.question.id, 1);
  assert.strictEqual(selection.rule, 'unseen-concept');
});
