import { anthropicJudge } from "./anthropic.ts";
import { bedrockJudge } from "./bedrock.ts";
import type { Judges } from "./judge.ts";
import { openaiJudge } from "./openai.ts";

/** The real providers. `run` takes these unless a caller injects its own. */
export const defaultJudges: Judges = {
  bedrock: (llm) => bedrockJudge(llm, process.env),
  anthropic: anthropicJudge,
  openai: openaiJudge,
};
