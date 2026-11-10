-- Knowledge Debugger — Weeks 10-12 migration
-- Records which LLM prompt version (v1 | v2) produced each analysis.
-- Safe to run more than once; does not drop anything.
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS prompt_version TEXT;
