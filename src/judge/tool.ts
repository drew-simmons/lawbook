import { CliError, errorMessage } from "../errors.ts";
import { answerJsonSchema, type Decision, parseAnswer } from "./judge.ts";

/**
 * The tool a model calls to answer, for endpoints that refuse structured
 * output but accept a plain tool, such as Bedrock's. Its input is the answer.
 */
export const ANSWER_TOOL = "answer";

export const ANSWER_TOOL_DESCRIPTION =
  "Records the probability that the files meet the standard and the evidence for it. Call it exactly once; its input is the whole answer.";

/** Appended to the system prompt, so a model that may choose not to call the tool still does. */
export const TOOL_INSTRUCTION = `Give your answer by calling the ${ANSWER_TOOL} tool once, with the probability and the reason as its input. Do not answer in text.`;

export const ANSWER_TOOL_SCHEMA = answerJsonSchema();

/** A function call's JSON arguments as a decision and reason; text that is not JSON is an error. */
export function toolArguments(text: string, label: string): { decision: Decision; reason: string } {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (error) {
    throw new CliError(`the judge gave no verdict for ${label} (${errorMessage(error)})`);
  }
  return parseAnswer(input, label);
}
