import { bedrockJudge } from "./bedrock.ts";
import { claudeCodeJudge } from "./claude-code.ts";
import type { Judges } from "./judge.ts";

/** The real providers. `run` takes these unless a caller injects its own. */
export const defaultJudges: Judges = {
  bedrock: (llm) => bedrockJudge(llm, process.env),
  "claude-code": async (llm) => claudeCodeJudge(llm.model),
};
