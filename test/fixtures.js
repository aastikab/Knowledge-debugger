// Small copy of the seeded curriculum (sql/seed.sql + sql/add_learner_model.sql)
const concepts = [
  { id: 1, name: 'Client and Server' },
  { id: 2, name: 'HTTP' },
  { id: 3, name: 'APIs' },
  { id: 4, name: 'Authentication' },
  { id: 5, name: 'Authorization' },
];

const prerequisites = [
  { concept_id: 2, prerequisite_id: 1 },
  { concept_id: 3, prerequisite_id: 2 },
  { concept_id: 4, prerequisite_id: 2 },
  { concept_id: 5, prerequisite_id: 4 },
];

const misconceptions = [
  { id: 3, concept_id: 2, code: 'HTTP_IS_LANGUAGE' },
  { id: 8, concept_id: 5, code: 'AUTHN_AUTHZ_CONFUSION' },
];

const questions = [
  { id: 1, concept_id: 1, difficulty: 'easy', probes_misconception_id: null },
  { id: 2, concept_id: 1, difficulty: 'easy', probes_misconception_id: null },
  { id: 3, concept_id: 2, difficulty: 'easy', probes_misconception_id: null },
  { id: 4, concept_id: 2, difficulty: 'easy', probes_misconception_id: null },
  { id: 5, concept_id: 3, difficulty: 'easy', probes_misconception_id: null },
  { id: 6, concept_id: 3, difficulty: 'medium', probes_misconception_id: null },
  { id: 7, concept_id: 4, difficulty: 'easy', probes_misconception_id: null },
  { id: 8, concept_id: 4, difficulty: 'easy', probes_misconception_id: null },
  { id: 9, concept_id: 5, difficulty: 'easy', probes_misconception_id: null },
  { id: 10, concept_id: 5, difficulty: 'medium', probes_misconception_id: null },
  { id: 13, concept_id: 2, difficulty: 'medium', probes_misconception_id: 3 },
  { id: 18, concept_id: 5, difficulty: 'medium', probes_misconception_id: 8 },
];

module.exports = { curriculum: { concepts, prerequisites, misconceptions, questions } };
