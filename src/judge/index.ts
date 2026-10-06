import { bifrostJudge } from "./bifrost.ts";
import { claudeCodeJudge } from "./claude-code.ts";
import { codexJudge } from "./codex.ts";
import type { Judges } from "./judge.ts";
import { openaiJudge } from "./openai.ts";

/** The real providers. `run` takes these unless a caller injects its own. */
export const defaultJudges: Judges = {
  bifrost: (llm) => bifrostJudge(llm, process.env),
  openai: (llm) => openaiJudge(llm, process.env),
  "claude-code": async (llm) => claudeCodeJudge(llm.model),
  codex: async (llm) => codexJudge(llm.model),
};
