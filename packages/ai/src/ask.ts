/**
 * One question, one grounded answer.
 *
 * The whole flow in one place: build the prompt from the evidence view, ask, parse, and ground.
 * Grounding is not optional and is not a flag — a caller cannot obtain an ungrounded answer from
 * this package, because an ungrounded answer is the thing doc 04 §1 rule 10 forbids.
 *
 * A provider failure propagates rather than becoming an empty answer. An empty answer is a
 * legitimate model response ("I have nothing to add that the results do not already say"), and
 * returning one for an outage would make a broken integration look like a modest one.
 */
import { parseAnswer } from './answer.js';
import type { AiClient } from './client.js';
import { renderContext, type AiContext } from './context.js';
import { groundAnswer, type GroundedAnswer } from './grounding.js';

/**
 * Ask a question about one flight's results.
 *
 * @param question the engineer's question; appended to the evidence and the standing instructions.
 * @throws {AiError} PROVIDER_FAILED from the client, or UNPARSEABLE_ANSWER when the response is not
 * a well-formed answer. Never throws for an answer that merely overreached — that is reported as
 * `rejected`, alongside whatever survived.
 */
export async function askAi(
  context: AiContext,
  question: string,
  client: AiClient,
): Promise<GroundedAnswer> {
  const prompt = `${renderContext(context)}\nQUESTION\n${question}\n`;
  const response = await client.complete(prompt);

  return groundAnswer(parseAnswer(response), context, client.model);
}
