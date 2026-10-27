require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const RESPONSE_TYPES = ['correct', 'partial', 'incorrect', 'misconception'];

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
}) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is missing. Add it to your .env file.');
  }

  const modelName = process.env.GEMINI_MODEL || DEFAULT_MODEL;
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
  });

  const startTime = Date.now();
  const result = await model.generateContent(prompt);
  const latencyMs = Date.now() - startTime;

  const parsed = parseJson(result.response.text());
  const usage = result.response.usageMetadata || {};

  return {
    ...normalizeAnalysis(parsed, misconceptionCatalog.map((m) => m.code)),
    model: modelName,
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
}) {
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
`.trim();
}

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

module.exports = { analyzeWrittenAnswer, buildPrompt, normalizeAnalysis, parseJson, RESPONSE_TYPES };
