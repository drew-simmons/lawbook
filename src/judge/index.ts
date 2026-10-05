import { anthropicJudge } from "./anthropic.ts";
import { bedrockJudge } from "./bedrock.ts";
import { claudeCodeJudge } from "./claude-code.ts";
import { codexJudge } from "./codex.ts";
import type { Judges } from "./judge.ts";
import { openaiJudge } from "./openai.ts";

/** The real providers. `run` takes these unless a caller injects its own. */
export const defaultJudges: Judges = {
  bedrock: (llm) => bedrockJudge(llm, process.env),
  anthropic: anthropicJudge,
  openai: (llm) => openaiJudge(llm, process.env),
  "claude-code": async (llm) => claudeCodeJudge(llm.model),
  codex: async (llm) => codexJudge(llm.model),
};
