/**
 * The provider client — doc 04 §8.
 *
 * > No secret API keys embedded in the shipped `apps/web` bundle. Any key `packages/ai` uses is
 * > supplied by the user at runtime [...] and sent directly from the client to the provider the
 * > user configured — never relayed through infrastructure PandaLog operates, because none exists.
 *
 * So: the key arrives as an argument, is captured in a closure rather than stored on the returned
 * object, and never appears in an error message. There is no default endpoint that would send a
 * flight's findings somewhere before the user named where — the endpoint is required, and it must
 * be `https`, because a key in a plaintext request is a leaked key.
 *
 * `AiClient` is an interface first and this implementation second. A caller with its own transport,
 * its own proxy or its own provider supplies one, and `askAi` neither knows nor cares — which is
 * also why every test in this package runs without a network.
 */
import { AiError } from './errors.js';

/** Latest Claude model at the time of writing; a caller may name another. */
export const DEFAULT_MODEL = 'claude-opus-5';

export interface AiClient {
  /** Identifies what produced an answer, so it is attributable. */
  readonly model: string;
  complete(prompt: string): Promise<string>;
}

export interface ProviderClientConfig {
  /** Supplied by the user at runtime. Never stored by this package (doc 04 §8). */
  readonly apiKey: string;
  /** The provider the user configured. Required: there is no default destination. */
  readonly endpoint: string;
  readonly model?: string;
  readonly maxTokens?: number;
  /** Injected so this package holds no ambient dependency on a global, and tests reach no network. */
  readonly fetch?: typeof globalThis.fetch;
}

const DEFAULT_MAX_TOKENS = 2048;

interface ProviderResponse {
  readonly content?: readonly { readonly type?: string; readonly text?: string }[];
}

/** Pull the text out of a Messages-API response without trusting its shape. */
function textFrom(body: string): string {
  let parsed: ProviderResponse;
  try {
    parsed = JSON.parse(body) as ProviderResponse;
  } catch {
    throw new AiError('PROVIDER_FAILED', 'The provider returned a response that is not JSON.');
  }

  const text = (parsed.content ?? [])
    .filter((block) => block.type === undefined || block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
    .trim();

  if (text.length === 0) {
    throw new AiError(
      'PROVIDER_FAILED',
      'The provider returned no text. Reporting that as an empty answer would make an outage look ' +
        'like a model with nothing to add.',
    );
  }

  return text;
}

/**
 * Build a client that talks directly to the provider the user named.
 *
 * @throws {AiError} INVALID_CONFIGURATION when no key is supplied or the endpoint is not https.
 */
export function createProviderClient(config: ProviderClientConfig): AiClient {
  if (config.apiKey.trim().length === 0) {
    throw new AiError(
      'INVALID_CONFIGURATION',
      'No API key was supplied. This package never ships one and never stores one; the user ' +
        'provides it per session (doc 04 §8).',
    );
  }

  let endpoint: URL;
  try {
    endpoint = new URL(config.endpoint);
  } catch {
    throw new AiError('INVALID_CONFIGURATION', `${config.endpoint} is not a usable endpoint.`);
  }
  if (endpoint.protocol !== 'https:') {
    throw new AiError(
      'INVALID_CONFIGURATION',
      `The endpoint ${endpoint.origin} is not https. A key sent over a plaintext connection is a ` +
        'leaked key, and the request carries the flight’s findings as well.',
    );
  }

  const model = config.model ?? DEFAULT_MODEL;
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  const call = config.fetch ?? globalThis.fetch;
  // Captured, never a property: a key on the returned object would end up in any structured log,
  // error report or devtools inspection of it.
  const { apiKey } = config;

  return Object.freeze({
    model,
    async complete(prompt: string): Promise<string> {
      const response = await call(config.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        // The status and origin, never the body or the key: a provider's error body can echo the
        // request, and this message may well end up in a log.
        throw new AiError(
          'PROVIDER_FAILED',
          `The provider at ${endpoint.origin} refused the request (HTTP ${String(response.status)}).`,
          { status: response.status },
        );
      }

      return textFrom(await response.text());
    },
  });
}
