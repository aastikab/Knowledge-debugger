const test = require('node:test');
const assert = require('node:assert');
const { normalizeAnalysis, parseJson, buildPrompt } = require('../src/llm');

test('parseJson accepts fenced JSON', () => {
  assert.deepStrictEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
});

test('normalizeAnalysis keeps valid output', () => {
  const a = normalizeAnalysis(
    { responseType: 'misconception', understandingLevel: 40, misconceptionCode: 'X', seemsCorrect: false },
    ['X']
  );
  assert.strictEqual(a.responseType, 'misconception');
  assert.strictEqual(a.misconceptionCode, 'X');
  assert.deepStrictEqual(a.warnings, []);
});

test('normalizeAnalysis corrects invalid output and records warnings', () => {
  const a = normalizeAnalysis(
    { responseType: 'great', understandingLevel: 250, misconceptionCode: 'MADE_UP', seemsCorrect: true },
    ['X']
  );
  assert.strictEqual(a.responseType, 'correct');
  assert.strictEqual(a.understandingLevel, 100);
  assert.strictEqual(a.misconceptionCode, null);
  assert.strictEqual(a.warnings.length, 2);
});

test('prompt includes the misconception catalog', () => {
  const prompt = buildPrompt({
    conceptName: 'HTTP',
    questionText: 'Q',
    expectedAnswer: 'E',
    submittedAnswer: 'S',
    misconceptionCatalog: [{ code: 'HTTP_IS_LANGUAGE', conceptName: 'HTTP', description: 'D' }],
  });
  assert.match(prompt, /HTTP_IS_LANGUAGE \(concept: HTTP\): D/);
});

test('prompt v2 adds the uncertainty and out-of-catalog rules; v1 does not', () => {
  const input = { conceptName: 'HTTP', questionText: 'Q', expectedAnswer: 'E', submittedAnswer: 'S', misconceptionCatalog: [] };
  const v1 = buildPrompt({ ...input, promptVersion: 'v1' });
  const v2 = buildPrompt({ ...input, promptVersion: 'v2' });
  assert.doesNotMatch(v1, /Uncertainty is not a misconception/);
  assert.match(v2, /Uncertainty is not a misconception/);
  assert.match(v2, /does NOT match any code/);
  assert.ok(v2.startsWith(v1.slice(0, 200)));
  assert.throws(() => buildPrompt({ ...input, promptVersion: 'v9' }), /Unknown prompt version/);
});
