import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createLiveLLM, OpenAICompatibleLLM, parseResetDuration, rateLimitWaitMs, supportsEffort } from './llm';

vi.mock('./clock', () => ({ getNow: () => new Date('2026-11-10T00:00:00.000Z') }));

const anthropicCalls = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async (params: Record<string, unknown>) => { anthropicCalls.push(params); return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] }; },
      parse: async (params: Record<string, unknown>) => { anthropicCalls.push(params); return { parsed_output: { ok: true } }; },
    };
  },
}));

const anthropicEnv = (model: string) => ({ provider: 'anthropic' as const, apiKey: 'test-secret-123', apiKeys: [], fallbackModel: undefined, poolExclude: [], model, baseUrl: undefined, maxHistory: 20, configuredMode: 'live' as const, mode: 'live' as const });

describe('AnthropicLLM request shape', () => {
  afterEach(() => { anthropicCalls.length = 0; });

  it('never forces tool_choice, asks for the required tool in the prompt and keeps effort low on current models', async () => {
    const llm = createLiveLLM(anthropicEnv('claude-sonnet-5-5'));
    await llm.runToolLoop({ system: 'base prompt', messages: [{ role: 'user', content: 'go' }], tools: [{ name: 'lookup', description: 'lookup', inputSchema: { type: 'object' } }], maxIterations: 1, toolChoiceName: 'lookup', onToolCall: async () => '{}' });
    const [params] = anthropicCalls;
    expect(params.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
    expect(String(params.system)).toContain('Call the lookup tool now');
    expect(params.max_tokens).toBe(4096);
    expect(params.output_config).toEqual({ effort: 'low' });
  });

  it('omits effort on models that reject it and passes the structured output format', async () => {
    const llm = createLiveLLM(anthropicEnv('claude-haiku-4-5'));
    await llm.runToolLoop({ system: 's', messages: [{ role: 'user', content: 'go' }], tools: [], maxIterations: 1, onToolCall: async () => '{}' });
    expect(anthropicCalls[0]).not.toHaveProperty('output_config');
    expect(anthropicCalls[0].tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: false });
    await expect(createLiveLLM(anthropicEnv('claude-opus-5-5')).structured({ system: 'classify', input: 'hi', schema: z.object({ ok: z.boolean() }) })).resolves.toEqual({ ok: true });
    const parseParams = anthropicCalls[1].output_config as { format: unknown; effort?: string };
    expect(parseParams.format).toBeTruthy();
    expect(parseParams.effort).toBe('low');
  });
});

describe('rate-limit helpers', () => {
  it('recognises the current Claude families for effort', () => {
    expect(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-sonnet-4-6', 'claude-fable-5-1'].every(supportsEffort)).toBe(true);
    expect(['claude-haiku-4-5', 'claude-sonnet-4-5', 'gpt-oss-20b'].some(supportsEffort)).toBe(false);
  });

  it('parses provider reset hints and bounds the wait', () => {
    expect(parseResetDuration('12')).toBe(12_000);
    expect(parseResetDuration('10.057s')).toBeCloseTo(10_057);
    expect(parseResetDuration('2m59.56s')).toBeCloseTo(179_560);
    expect(parseResetDuration('garbage')).toBeNull();
    expect(rateLimitWaitMs(new Headers({ 'x-ratelimit-reset-tokens': '3s' }))).toBe(3_250);
    expect(rateLimitWaitMs(new Headers({ 'retry-after': '120' }))).toBe(15_000);
    expect(rateLimitWaitMs(new Headers())).toBe(350);
  });
});

const url = 'https://provider.test/v1';
const key = 'test-secret-123';
const model = 'unit-model';
const response = (message: unknown) => new Response(JSON.stringify({ choices: [{ message }] }), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('OpenAICompatibleLLM', () => {
  it('retains Anthropic as the live provider when selected', () => {
    const previous = { LLM_MODE: process.env.LLM_MODE, LLM_PROVIDER: process.env.LLM_PROVIDER, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };
    Object.assign(process.env, { LLM_MODE: 'live', LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: key });
    try { expect(createLiveLLM()).not.toBeInstanceOf(OpenAICompatibleLLM); }
    finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it('sends tool definitions and bearer auth without exposing the key in errors', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.tools[0].function.name).toBe('example');
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${key}`);
      return response({ content: 'done' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const llm = new OpenAICompatibleLLM(url, key, model);
    await llm.runToolLoop({ system: 'private prompt', messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'example', description: 'safe tool', inputSchema: { type: 'object' } }], maxIterations: 2, onToolCall: async () => '{}' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain(key);
  });

  it('parses tool_calls, returns tool messages and stops when the model has no more calls', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{"id":"a"}' } }] }))
      .mockResolvedValueOnce(response({ content: 'complete' }));
    vi.stubGlobal('fetch', fetchMock);
    const llm = new OpenAICompatibleLLM(url, key, model);
    const onToolCall = vi.fn(async () => '{"ok":true}');
    const result = await llm.runToolLoop({ system: 'system', messages: [{ role: 'user', content: 'do it' }], tools: [{ name: 'lookup', description: 'lookup', inputSchema: { type: 'object' } }], maxIterations: 6, onToolCall });
    expect(onToolCall).toHaveBeenCalledWith({ id: 'call-1', name: 'lookup', input: { id: 'a' } });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call-1', content: '{"ok":true}' });
    expect(result.summary).toBe('complete');
    expect(result.toolCalls).toHaveLength(1);
  });

  it('stops at maxIterations even if the model keeps returning tool calls', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ tool_calls: [{ id: 'x', type: 'function', function: { name: 'lookup', arguments: '{}' } }] })));
    const result = await new OpenAICompatibleLLM(url, key, model).runToolLoop({ system: '', messages: [], tools: [], maxIterations: 2, onToolCall: async () => 'ok' });
    expect(result.toolCalls).toHaveLength(2);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('limits prior context by LLM_MAX_HISTORY', async () => {
    const old = process.env.LLM_MAX_HISTORY;
    process.env.LLM_MAX_HISTORY = '2';
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const messages = JSON.parse(String(init?.body)).messages as Array<{ role: string; content: string }>;
      expect(messages.map((message) => message.content)).toEqual(['system', 'two', 'three']);
      return response({ content: 'ok' });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await new OpenAICompatibleLLM(url, key, model).runToolLoop({ system: 'system', messages: ['one', 'two', 'three'].map((content) => ({ role: 'user' as const, content })), tools: [], maxIterations: 1, onToolCall: async () => '{}' });
    } finally {
      if (old === undefined) delete process.env.LLM_MAX_HISTORY;
      else process.env.LLM_MAX_HISTORY = old;
    }
  });

  it('retries invalid structured JSON once, then validates it with Zod', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ content: 'not json' })).mockResolvedValueOnce(response({ content: '{"value":7}' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new OpenAICompatibleLLM(url, key, model).structured({ system: 'extract', input: 'value', schema: z.object({ value: z.number() }) })).resolves.toEqual({ value: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('redacts key and provider response text from errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(key, { status: 401 })));
    await expect(new OpenAICompatibleLLM(url, key, model).structured({ system: '', input: '', schema: z.object({}) })).rejects.toThrow(/LLM_HTTP_401/);
    try { await new OpenAICompatibleLLM(url, key, model).structured({ system: '', input: '', schema: z.object({}) }); } catch (error) { expect(String(error)).not.toContain(key); }
  });
});
