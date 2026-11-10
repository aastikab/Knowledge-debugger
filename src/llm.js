require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const RESPONSE_TYPES = ['correct', 'partial', 'incorrect', 'misconception'];

// v1 = prompt used in Progress Report 3.
// v2 = adds rules for the failure cases found in v1 (uncertainty read as a
//      misconception) and for answers that are long, mixed, informal, or show
//      a misconception outside the catalog.
const PROMPT_VERSIONS = ['v1', 'v2'];
const DEFAULT_PROMPT_VERSION = 'v1';

function resolvePromptVersion(version) {
  const v = version || process.env.PROMPT_VERSION || DEFAULT_PROMPT_VERSION;
  if (!PROMPT_VERSIONS.includes(v)) throw new Error(`Unknown prompt version: ${v}`);
  return v;
}

/**
 * LLM helper using Google Gemini.
 * Sends a written student answer and asks for a structured JSON analysis:
 * - short understanding summary
 * - possible knowledge gap
 * - possible misconception (free text + a code from the fixed catalog)
 * - response type (correct / partial / incorrect / misconception)
 * - estimated understanding level (0-100)
 * - whether the answer seems mostly correct
 * Also returns latency and token usage so cost can be measured.
 */
async function analyzeWrittenAnswer({
  conceptName,
  questionText,
  expectedAnswer,
  submittedAnswer,
  misconceptionCatalog = [],
  promptVersion,
}) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is missing. Add it to your .env file.');
  }

  const modelName = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const version = resolvePromptVersion(promptVersion);
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: 'application/json',
    },
  });

  const prompt = buildPrompt({
    conceptName,
    questionText,
    expectedAnswer,
    submittedAnswer,
    misconceptionCatalog,
    promptVersion: version,
  });

  const startTime = Date.now();
  const result = await model.generateContent(prompt);
  const latencyMs = Date.now() - startTime;

  const parsed = parseJson(result.response.text());
  const usage = result.response.usageMetadata || {};

  return {
    ...normalizeAnalysis(parsed, misconceptionCatalog.map((m) => m.code)),
    model: modelName,
    promptVersion: version,
    latencyMs,
    inputTokens: usage.promptTokenCount ?? null,
    outputTokens: usage.candidatesTokenCount ?? null,
  };
}

// Build the prompt. The catalog lets the LLM pick a known misconception code,
// which makes its answer checkable against the labeled evaluation set.
function buildPrompt({
  conceptName,
  questionText,
  expectedAnswer,
  submittedAnswer,
  misconceptionCatalog,
  promptVersion,
}) {
  const version = resolvePromptVersion(promptVersion);
  const catalogText = misconceptionCatalog.length
    ? misconceptionCatalog
        .map((m) => `- ${m.code} (concept: ${m.conceptName}): ${m.description}`)
        .join('\n')
    : '- (none)';

  return `
You are helping analyze a student's written answer for a backend/web learning research project.

Concept: ${conceptName}
Question: ${questionText}
Expected answer (reference only): ${expectedAnswer}
Student's written answer: ${submittedAnswer}

Known misconceptions (the student's answer may show one of these, possibly from a different concept):
${catalogText}

Return ONLY valid JSON with these exact keys:
{
  "understandingSummary": "1-2 sentence summary of what the student seems to understand",
  "knowledgeGap": "one likely missing idea, or null if none is clear",
  "misconception": "one likely incorrect belief, or null if none is clear",
  "misconceptionCode": "one code from the known misconceptions list, or null",
  "responseType": "correct" | "partial" | "incorrect" | "misconception",
  "understandingLevel": integer from 0 (no understanding) to 100 (full understanding),
  "seemsCorrect": true or false
}

Rules:
- Be concise and beginner-friendly.
- Use null (not empty string) when there is no clear gap or misconception.
- Do not invent unrelated topics.
- responseType meanings:
  correct = right and complete; partial = right idea but incomplete or vague;
  incorrect = wrong or missing understanding without a specific false belief;
  misconception = states a specific false belief (even if part of the answer is right).
- Only use a misconceptionCode from the list above; use null if none of them fits.
- seemsCorrect should be true only if the written answer is mostly right for the question.
${version === 'v2' ? V2_RULES : ''}`.trim();
}

// Extra rules added in v2 (Weeks 10-12)
const V2_RULES = `
Additional rules:
- Uncertainty is not a misconception. If the student hedges ("I think", "maybe"), says they cannot remember,
  or guesses between options, judge only what they actually claim. A hedged but right answer can be correct;
  not remembering is partial or incorrect. Use "misconception" only when the student asserts something false.
- Do not read a specific false belief into a very short answer unless the answer itself clearly states it.
- Judge the whole answer. If correct statements are followed by a false claim, it is a misconception.
  If the student corrects themselves, judge their final answer.
- If the answer states a false belief that does NOT match any code in the list, still use responseType
  "misconception", describe the belief in "misconception", and set misconceptionCode to null.
  Do not force a code that only partly fits.
- Ignore spelling, grammar, abbreviations, and informal language; judge the meaning.
`;

// Some models wrap JSON in ```json fences even when asked not to.
function parseJson(rawText) {
  const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

// Validate the LLM output so bad values never reach the database.
// The LLM is not trusted: unknown codes and out-of-range numbers are corrected
// and flagged in `warnings` so they can be counted as failure cases.
function normalizeAnalysis(parsed, allowedCodes = []) {
  const warnings = [];

  let responseType = typeof parsed.responseType === 'string' ? parsed.responseType.toLowerCase() : null;
  if (!RESPONSE_TYPES.includes(responseType)) {
    warnings.push(`invalid responseType: ${parsed.responseType}`);
    responseType = parsed.seemsCorrect ? 'correct' : 'incorrect';
  }

  let understandingLevel = Math.round(Number(parsed.understandingLevel));
  if (!Number.isFinite(understandingLevel)) {
    warnings.push(`invalid understandingLevel: ${parsed.understandingLevel}`);
    understandingLevel = parsed.seemsCorrect ? 75 : 25;
  }
  understandingLevel = Math.min(100, Math.max(0, understandingLevel));

  let misconceptionCode = parsed.misconceptionCode || null;
  if (misconceptionCode && !allowedCodes.includes(misconceptionCode)) {
    warnings.push(`unknown misconceptionCode: ${misconceptionCode}`);
    misconceptionCode = null;
  }

  return {
    understandingSummary: parsed.understandingSummary || 'No summary provided.',
    knowledgeGap: parsed.knowledgeGap || null,
    misconception: parsed.misconception || null,
    misconceptionCode,
    responseType,
    understandingLevel,
    seemsCorrect: Boolean(parsed.seemsCorrect),
    warnings,
  };
}

module.exports = {
  analyzeWrittenAnswer,
  buildPrompt,
  normalizeAnalysis,
  parseJson,
  resolvePromptVersion,
  RESPONSE_TYPES,
  PROMPT_VERSIONS,
};
