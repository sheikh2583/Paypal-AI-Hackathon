import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { getLlmEnv, parseKeyPool } from './env';
import { OpenAICompatibleLLM } from './llm';
import { KeyPool, nextPacificMidnight, parseRateLimit, scrubSecrets } from './llm-pool';

vi.mock('./clock', () => ({ getNow: () => new Date('2026-11-12T00:00:00.000Z') }));

// Fake keys shaped like Google keys, so scrubbing is tested against realistic text. Never real values.
const KEYS = ['AIzaTESTkeyNumberOne000000000000000', 'AIzaTESTkeyNumberTwo000000000000000', 'AIzaTESTkeyNumberThree0000000000000'];
const url = 'https://provider.test/v1';
const ok = (message: unknown) => new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
const keyOf = (init?: RequestInit) => KEYS.indexOf(String(new Headers(init?.headers).get('authorization')).replace('Bearer ', '')) + 1;
const bodyOf = (init?: RequestInit) => JSON.parse(String(init?.body)) as { model: string; messages: unknown[] };
const perMinute429 = () => new Response(JSON.stringify([{ error: { code: 429, status: 'RESOURCE_EXHAUSTED', details: [
  { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] },
  { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '23s' },
] } }]), { status: 429 });
const perDay429 = () => new Response(JSON.stringify([{ error: { code: 429, message: 'Generate content requests per day limit exceeded on Free Tier.', details: [
  { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
] } }]), { status: 429 });
const structuredCall = (llm: OpenAICompatibleLLM) => llm.structured({ system: 's', input: 'i', schema: z.object({ ok: z.boolean() }) });
const quietPool = (keys: number, models: string[]) => new KeyPool(keys, models, Date.now, () => undefined);

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('key pool configuration', () => {
  it('trims items, ignores blanks and repeats, caps the pool at 8 and falls back to LLM_API_KEY', () => {
    expect(parseKeyPool(' a , ,b,a,, c ', undefined)).toEqual(['a', 'b', 'c']);
    expect(parseKeyPool(Array.from({ length: 10 }, (_, i) => `k${i}`).join(','), undefined)).toHaveLength(8);
    expect(parseKeyPool(undefined, ' single ')).toEqual(['single']);
    expect(parseKeyPool('', undefined)).toEqual([]);
    const env = getLlmEnv({ LLM_API_KEYS: 'x,y', LLM_BASE_URL: url, LLM_MODEL: 'm', LLM_MODEL_FALLBACK: 'lite', LLM_POOL_EXCLUDE: '2:lite, junk', LLM_MODE: 'live' });
    expect(env).toMatchObject({ provider: 'openai-compatible', apiKeys: ['x', 'y'], fallbackModel: 'lite', mode: 'live', poolExclude: [{ keyIndex: 1, model: 'lite' }] });
  });
});

describe('OpenAICompatibleLLM key pool', () => {
  it('hands out keys round-robin', async () => {
    const used: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => { used.push(keyOf(init)); return ok({ content: '{"ok":true}' }); }));
    const llm = new OpenAICompatibleLLM(url, KEYS, 'model-a', { pool: quietPool(3, ['model-a']) });
    for (let i = 0; i < 4; i++) await structuredCall(llm);
    expect(used).toEqual([1, 2, 3, 1]);
  });

  it('retries a 429 on the next key with the identical message array', async () => {
    const calls: { key: number; body: ReturnType<typeof bodyOf> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ key: keyOf(init), body: bodyOf(init) });
      return calls.length === 1 ? perMinute429() : ok({ content: 'done' });
    }));
    const llm = new OpenAICompatibleLLM(url, KEYS, 'model-a', { pool: quietPool(3, ['model-a']) });
    const result = await llm.runToolLoop({ system: 'policy', messages: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'earlier reply' }, { role: 'user', content: 'latest' }], tools: [], maxIterations: 2, onToolCall: async () => '{}' });
    expect(result.summary).toBe('done');
    expect(calls.map(({ key }) => key)).toEqual([1, 2]);
    expect(calls[1].body.messages).toEqual(calls[0].body.messages);
  });

  it('cools a per-minute limit for the suggested delay', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-12T10:00:00Z'), toFake: ['Date'] });
    const used: number[] = [];
    let first = true;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      used.push(keyOf(init));
      if (first) { first = false; return perMinute429(); }
      return ok({ content: '{"ok":true}' });
    }));
    const llm = new OpenAICompatibleLLM(url, KEYS.slice(0, 2), 'model-a', { pool: quietPool(2, ['model-a']) });
    for (let i = 0; i < 3; i++) await structuredCall(llm); // key 1 is limited for 23 s, so key 2 answers all three
    expect(used).toEqual([1, 2, 2, 2]);
    vi.setSystemTime(new Date('2026-11-12T10:00:24Z'));
    used.length = 0;
    for (let i = 0; i < 2; i++) await structuredCall(llm);
    expect([...used].sort()).toEqual([1, 2]); // the cooldown is over and both keys share the load again
  });

  it('cools a per-day limit until the next midnight Pacific', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-12T10:00:00Z'), toFake: ['Date'] });
    const used: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const key = keyOf(init);
      used.push(key);
      // Key 2's daily quota runs out until 08:00 UTC on Nov 13 (midnight in Los Angeles).
      return key === 2 && Date.now() < Date.parse('2026-11-13T08:00:00Z') ? perDay429() : ok({ content: '{"ok":true}' });
    }));
    const pool = quietPool(2, ['model-a']);
    const llm = new OpenAICompatibleLLM(url, KEYS.slice(0, 2), 'model-a', { pool });
    for (let i = 0; i < 2; i++) await structuredCall(llm);
    expect(used).toEqual([1, 2, 1]);
    expect(new Date(pool.readyAt({ keyIndex: 1, model: 'model-a' })).toISOString()).toBe('2026-11-13T08:00:00.000Z');
    vi.setSystemTime(new Date('2026-11-13T07:59:00Z')); // a minute short of the reset: still skipped
    used.length = 0;
    for (let i = 0; i < 2; i++) await structuredCall(llm);
    expect(used).toEqual([1, 1]);
    vi.setSystemTime(new Date('2026-11-13T08:00:01Z'));
    used.length = 0;
    for (let i = 0; i < 2; i++) await structuredCall(llm);
    expect([...used].sort()).toEqual([1, 2]);
  });

  it('tries the fallback model on the same key before moving to the next key', async () => {
    const calls: { key: number; model: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ key: keyOf(init), model: bodyOf(init).model });
      return calls.length === 1 ? perDay429() : ok({ content: '{"ok":true}' });
    }));
    const llm = new OpenAICompatibleLLM(url, KEYS, 'flash', { fallbackModel: 'flash-lite', pool: quietPool(3, ['flash', 'flash-lite']) });
    await structuredCall(llm);
    expect(calls).toEqual([{ key: 1, model: 'flash' }, { key: 1, model: 'flash-lite' }]);
  });

  it('disables only a rejected key, warns once by number and never prints the key', async () => {
    const warn = vi.fn();
    const used: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const key = keyOf(init);
      used.push(key);
      return key === 2 ? new Response(JSON.stringify({ error: { message: `API key not valid: ${KEYS[1]}` } }), { status: 400 }) : ok({ content: '{"ok":true}' });
    }));
    const pool = new KeyPool(3, ['model-a'], Date.now, warn);
    const llm = new OpenAICompatibleLLM(url, KEYS, 'model-a', { pool });
    for (let i = 0; i < 6; i++) await structuredCall(llm);
    expect(used.filter((key) => key === 2)).toHaveLength(1);
    expect(new Set(used)).toEqual(new Set([1, 2, 3]));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('key #2');
    for (const key of KEYS) expect(String(warn.mock.calls[0][0])).not.toContain(key);
  });

  it('keeps keys out of thrown errors even when the provider echoes them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`Bad request for ${url}?key=${KEYS[0]} (${KEYS[0]})`, { status: 400 })));
    const llm = new OpenAICompatibleLLM(url, KEYS[0], 'model-a', { pool: quietPool(1, ['model-a']) });
    const error = await structuredCall(llm).catch((caught: unknown) => caught);
    expect(String(error)).toMatch(/LLM_HTTP_400/);
    for (const key of KEYS) expect(JSON.stringify({ error: String(error), stack: (error as Error).stack })).not.toContain(key);
  });
});

describe('pool helpers', () => {
  it('reads Gemini retry hints and daily quotas', async () => {
    expect(parseRateLimit(await perMinute429().text(), new Headers())).toEqual({ perDay: false, retryAfterMs: 23_000 });
    expect(parseRateLimit(await perDay429().text(), new Headers())).toMatchObject({ perDay: true });
    expect(parseRateLimit('rate limited', new Headers({ 'retry-after': '7' }))).toEqual({ perDay: false, retryAfterMs: 7_000 });
  });

  it('finds the next midnight in Los Angeles, across daylight saving time', () => {
    expect(new Date(nextPacificMidnight(Date.parse('2026-11-12T10:00:00Z'))).toISOString()).toBe('2026-11-13T08:00:00.000Z');
    expect(new Date(nextPacificMidnight(Date.parse('2026-07-01T10:00:00Z'))).toISOString()).toBe('2026-07-02T07:00:00.000Z');
  });

  it('scrubs pool keys, Google-shaped keys and key URL parameters', () => {
    const text = `failed ${KEYS[1]} at https://x.test/v1?alt=sse&key=${KEYS[2]} other AIzaSomeOtherKeyLooking1234567890`;
    const scrubbed = scrubSecrets(text, KEYS);
    for (const key of KEYS) expect(scrubbed).not.toContain(key);
    expect(scrubbed).toContain('[key #2]');
    expect(scrubbed).not.toContain('AIzaSomeOther');
  });
});
