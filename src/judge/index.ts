import { claudeCodeJudge } from "./claude-code.ts";
import { codexJudge } from "./codex.ts";
import type { Judges } from "./judge.ts";
import { kiroJudge } from "./kiro.ts";

/** The real providers. `run` takes these unless a caller injects its own. */
export const defaultJudges: Judges = {
  "claude-code": async (llm) => claudeCodeJudge(llm.model),
  codex: async (llm) => codexJudge(llm.model),
  kiro: async (llm) => kiroJudge(llm.model),
};
