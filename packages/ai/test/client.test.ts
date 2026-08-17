/**
 * The provider client — doc 04 §8.
 *
 * > No secret API keys embedded in the shipped `apps/web` bundle. Any key `packages/ai` uses is
 * > supplied by the user at runtime [...] and sent directly from the client to the provider the
 * > user configured — never relayed through infrastructure PandaLog operates, because none exists.
 *
 * So the key is a per-call argument that is never stored, and `fetch` is injected so these tests
 * reach no network at all. Most of what is checked here is what the client *does not* do.
 */
import { describe, expect, it, vi } from 'vitest';

import { AiError, createProviderClient, DEFAULT_MODEL } from '@pandalog/ai';

/**
 * A `fetch` that answers from memory.
 *
 * Typed as the real signature so the spy records its arguments: the assertion that the request went
 * to the configured endpoint *and nowhere else* is the whole reason `fetch` is injected.
 */
function stubFetch(body: unknown, ok = true) {
  return vi.fn<typeof globalThis.fetch>(() =>
    Promise.resolve({
      ok,
      status: ok ? 200 : 401,
      text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    } as Response),
  );
}

const config = {
  apiKey: 'sk-test-key',
  endpoint: 'https://provider.example/v1/messages',
};

const completion = { content: [{ type: 'text', text: '{"facts":["a fact"]}' }] };

const clientWith = (body: unknown, ok = true) =>
  createProviderClient({ ...config, fetch: stubFetch(body, ok) });

describe('createProviderClient', () => {
  it('sends the prompt to the endpoint the user configured, and nowhere else', async () => {
    const fetch = stubFetch(completion);
    const client = createProviderClient({ ...config, fetch });

    await client.complete('Explain this flight.');

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(config.endpoint);
  });

  it('refuses to be constructed without a key, rather than calling anonymously', () => {
    expect(() =>
      createProviderClient({ ...config, apiKey: '   ', fetch: stubFetch(completion) }),
    ).toThrow(AiError);
  });

  it('refuses a plaintext endpoint, so a key is never sent in the clear', () => {
    expect(() =>
      createProviderClient({
        ...config,
        endpoint: 'http://provider.example/v1',
        fetch: stubFetch(completion),
      }),
    ).toThrow(/https/i);
  });

  it('refuses an endpoint that is not a URL at all', () => {
    expect(() =>
      createProviderClient({ ...config, endpoint: 'not-a-url', fetch: stubFetch(completion) }),
    ).toThrow(AiError);
  });

  it('keeps the key out of the object it returns', () => {
    // A client carrying the key as a property would put it into any structured log, error report
    // or devtools inspection of that object.
    const client = clientWith(completion);

    expect(JSON.stringify(client)).not.toContain(config.apiKey);
    expect(Object.values(client)).not.toContain(config.apiKey);
  });

  it('keeps the key out of the error it raises when a call fails', async () => {
    // Asserted on the message and context directly, so what is checked is exactly "the key is not
    // in the text somebody will paste into an issue".
    const client = clientWith('unauthorized', false);

    const raised = await client.complete('Explain.').catch((error: unknown) => error);

    expect(raised).toBeInstanceOf(AiError);
    expect((raised as AiError).message).not.toContain(config.apiKey);
    expect(JSON.stringify((raised as AiError).context)).not.toContain(config.apiKey);
  });

  it('reports a provider failure as a provider failure', async () => {
    const raised = await clientWith('unauthorized', false)
      .complete('Explain.')
      .catch((error: unknown) => error);

    expect((raised as AiError).code).toBe('PROVIDER_FAILED');
  });

  it('reports an unreadable response rather than returning empty text', async () => {
    await expect(clientWith({ unexpected: true }).complete('Explain.')).rejects.toThrow(AiError);
  });

  it('reports a non-JSON response as a provider failure', async () => {
    await expect(clientWith('<html>gateway timeout</html>').complete('Explain.')).rejects.toThrow(
      /not JSON/i,
    );
  });

  it('reads a text block that omits its type, which some responses do', async () => {
    const client = clientWith({ content: [{ text: '{"facts":["a fact"]}' }] });

    expect(await client.complete('Explain.')).toBe('{"facts":["a fact"]}');
  });

  it('treats a response with only empty text as a failure, not as an empty answer', async () => {
    const client = clientWith({ content: [{ type: 'text', text: '   ' }] });

    await expect(client.complete('Explain.')).rejects.toThrow(/no text/i);
  });

  it('defaults to a current model and lets the user name another', () => {
    expect(clientWith(completion).model).toBe(DEFAULT_MODEL);
    expect(
      createProviderClient({ ...config, fetch: stubFetch(completion), model: 'claude-sonnet-5' })
        .model,
    ).toBe('claude-sonnet-5');
  });
});
