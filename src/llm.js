require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Week 7 LLM helper using Google Gemini.
 * Sends a written student answer and asks for a simple JSON analysis:
 * - short understanding summary
 * - possible knowledge gap
 * - possible misconception
 * - whether the answer seems mostly correct
 */
async function analyzeWrittenAnswer({
  conceptName,
  questionText,
  expectedAnswer,
  submittedAnswer,
}) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is missing. Add it to your .env file.');
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-3.5-flash-lite',
    generationConfig: {
      responseMimeType: 'application/json',
    },
  });

  const prompt = `
You are helping analyze a student's written answer for a backend/web learning research project.

Concept: ${conceptName}
Question: ${questionText}
Expected answer (reference only): ${expectedAnswer}
Student's written answer: ${submittedAnswer}

Return ONLY valid JSON with these exact keys:
{
  "understandingSummary": "1-2 sentence summary of what the student seems to understand",
  "knowledgeGap": "one likely missing idea, or null if none is clear",
  "misconception": "one likely incorrect belief, or null if none is clear",
  "seemsCorrect": true or false
}

Rules:
- Be concise and beginner-friendly.
- Use null (not empty string) when there is no clear gap or misconception.
- Do not invent unrelated topics.
- seemsCorrect should be true only if the written answer is mostly right for the question.
`.trim();

  const result = await model.generateContent(prompt);
  const rawText = result.response.text();
  const parsed = JSON.parse(rawText);

  return {
    understandingSummary: parsed.understandingSummary || 'No summary provided.',
    knowledgeGap: parsed.knowledgeGap || null,
    misconception: parsed.misconception || null,
    seemsCorrect: Boolean(parsed.seemsCorrect),
  };
}

module.exports = { analyzeWrittenAnswer };
