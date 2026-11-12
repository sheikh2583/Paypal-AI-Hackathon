// LLM abstraction layer. All LLM calls go through this module so the provider
// can be swapped without touching caller code. Hard rule 4: never log apiKey.
import type { ToolCallRecord } from './types';
import { getLlmEnv } from './env';
import type Anthropic from '@anthropic-ai/sdk';
import { getNow } from './clock';
import { wrapClientMessage } from './agent/prompt';
import { toJSONSchema as zodToJsonSchema } from 'zod';
import { KeyPool, nextPacificMidnight, parseRateLimit, PER_MINUTE_COOLDOWN_MS, type PoolCombo } from './llm-pool';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema object
}

export interface ToolCallRequest {
  id: string;
  name: string;
  input: unknown;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | Array<{ type: string; [k: string]: unknown }> | null;
  tool_call_id?: string;
  tool_calls?: OpenAiToolCall[];
}

interface OpenAiToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }

export interface RunToolLoopOptions {
  system: string;
  messages: LlmMessage[];
  tools: ToolDefinition[];
  maxIterations: number;
  signal?: AbortSignal;
  toolChoiceName?: string;
  /** Called for each tool the model wants to invoke; must return a JSON string. */
  onToolCall: (call: ToolCallRequest) => Promise<string>;
  /** Called after every provider request with the key number, model and latency (never the key). */
  onProviderCall?: (record: ProviderCallRecord) => void;
}

export interface StructuredOptions<T> {
  system: string;
  input: string;
  schema: import('zod').ZodType<T>;
  onProviderCall?: (record: ProviderCallRecord) => void;
}

export interface LLM {
  runToolLoop(opts: RunToolLoopOptions): Promise<{ summary: string; toolCalls: ToolCallRecord[] }>;
  structured<T>(opts: StructuredOptions<T>): Promise<T>;
}

/** One provider call, described without the key itself (D75). */
export interface ProviderCallRecord {
  keyNumber: number;
  model: string;
  latencyMs: number;
  /** HTTP status, or 0 for a timeout or network failure. */
  status: number;
  ok: boolean;
}

type Attempt =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; kind: 'rate'; error: LlmRequestError; untilMs: number; retryAfterMs: number | null; perDay: boolean }
  | { ok: false; kind: 'transient'; error: LlmRequestError }
  | { ok: false; kind: 'auth'; error: LlmRequestError }
  | { ok: false; kind: 'fatal'; error: LlmRequestError };

/** Failed key + model combinations for one agent run or one structured call; each is tried at most once. */
interface PoolRun { failed: Set<string> }

/** Plain-fetch OpenAI Chat Completions adapter over a pool of keys. Provider errors never include response bodies. */
export class OpenAICompatibleLLM implements LLM {
  private readonly keys: readonly string[];
  private readonly models: readonly string[];
  private readonly timeoutMs: number;
  readonly pool: KeyPool;

  // Free-tier providers regularly take 6-10 s per call; 20 s keeps one slow call from aborting a run.
  constructor(
    private readonly baseUrl: string,
    apiKeys: string | readonly string[],
    model: string,
    options: { fallbackModel?: string; timeoutMs?: number; pool?: KeyPool } = {},
  ) {
    this.keys = typeof apiKeys === 'string' ? [apiKeys] : [...apiKeys];
    this.models = [...new Set([model, options.fallbackModel].filter((value): value is string => Boolean(value)))];
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.pool = options.pool ?? new KeyPool(this.keys.length, this.models);
  }

  private async attempt(combo: PoolCombo, body: Record<string, unknown>, outerSignal: AbortSignal | undefined, onCall?: (record: ProviderCallRecord) => void): Promise<Attempt> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const started = Date.now();
    const report = (status: number, ok: boolean) => onCall?.({ keyNumber: combo.keyIndex + 1, model: combo.model, latencyMs: Date.now() - started, status, ok });
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.keys[combo.keyIndex]}` },
        body: JSON.stringify({ model: combo.model, ...body }),
        signal: outerSignal ? AbortSignal.any([controller.signal, outerSignal]) : controller.signal,
      });
      if (response.ok) {
        const data = await response.json() as Record<string, unknown>;
        report(response.status, true);
        return { ok: true, data };
      }
      report(response.status, false);
      // The body is read only to classify the failure; it is never logged or returned.
      const text = await response.text().catch(() => '');
      const error = new LlmRequestError(`LLM_HTTP_${response.status}`, response.status);
      if (response.status === 401 || response.status === 403 || /API key not valid|API_KEY_INVALID/i.test(text)) return { ok: false, kind: 'auth', error };
      if (response.status === 429) {
        const { perDay, retryAfterMs } = parseRateLimit(text, response.headers);
        const now = Date.now();
        return { ok: false, kind: 'rate', error, perDay, retryAfterMs, untilMs: perDay ? nextPacificMidnight(now) : now + (retryAfterMs ?? PER_MINUTE_COOLDOWN_MS) };
      }
      if (response.status >= 500) return { ok: false, kind: 'transient', error };
      return { ok: false, kind: 'fatal', error };
    } catch (error) {
      if (outerSignal?.aborted) throw new LlmRequestError('LLM_TIMEOUT');
      report(0, false);
      if (error instanceof LlmRequestError) return { ok: false, kind: 'fatal', error };
      return { ok: false, kind: 'transient', error: new LlmRequestError(controller.signal.aborted ? 'LLM_TIMEOUT' : 'LLM_NETWORK_ERROR') };
    } finally { clearTimeout(timeout); }
  }

  /**
   * Sends one request, rotating keys round-robin. A rate-limited model moves on to the fallback model on the
   * same key, then to the next key; server errors and timeouts move straight to the next key. A 429 means the
   * request never ran, so retrying it elsewhere is safe even after a side-effecting tool (D75).
   */
  private async request(body: Record<string, unknown>, run: PoolRun, outerSignal?: AbortSignal, onCall?: (record: ProviderCallRecord) => void): Promise<Record<string, unknown>> {
    // A single key has nowhere else to go, so it keeps the earlier single-key behaviour (D70): a short pause and
    // one more try after a 503 or a short rate limit, and no 30 s cooldown that would fail the next requests at once.
    const single = this.keys.length === 1;
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
    let last: LlmRequestError | undefined;
    let retry: { combo: PoolCombo; waitMs: number } | undefined;
    let waited = false;
    for (const keyIndex of this.pool.nextKeyOrder()) {
      for (const model of this.models) {
        const combo = { keyIndex, model };
        const id = `${keyIndex}|${model}`;
        if (run.failed.has(id)) continue;
        if (!this.pool.isUsable(combo)) {
          const cooling = this.pool.coolingFor(combo);
          if (!single || waited || cooling === null || cooling > MAX_RATE_LIMIT_WAIT_MS) continue;
          waited = true;
          await pause(cooling);
        }
        if (outerSignal?.aborted) throw new LlmRequestError('LLM_TIMEOUT');
        const outcome = await this.attempt(combo, body, outerSignal, onCall);
        if (outcome.ok) return outcome.data;
        run.failed.add(id);
        last = outcome.error;
        if (outcome.kind === 'fatal') throw outcome.error;
        if (outcome.kind === 'auth') { this.pool.disableKey(keyIndex, outcome.error.status ?? 0); break; }
        if (outcome.kind === 'transient') {
          if (single) retry ??= { combo, waitMs: 350 };
          else this.pool.coolDownKey(keyIndex);
          break;
        }
        this.pool.coolDown(combo, outcome.untilMs);
        if (single && !outcome.perDay) {
          const waitMs = outcome.retryAfterMs ?? 350;
          if (!retry || waitMs < retry.waitMs) retry = { combo, waitMs };
        }
      }
    }
    if (single && !waited && retry && retry.waitMs <= MAX_RATE_LIMIT_WAIT_MS) {
      waited = true;
      await pause(retry.waitMs);
      if (outerSignal?.aborted) throw new LlmRequestError('LLM_TIMEOUT');
      const outcome = await this.attempt(retry.combo, body, outerSignal, onCall);
      // A key that answers on the retry is healthy again for the rest of the run.
      if (outcome.ok) { run.failed.delete(`${retry.combo.keyIndex}|${retry.combo.model}`); return outcome.data; }
      last = outcome.error;
      if (outcome.kind === 'rate') this.pool.coolDown(retry.combo, outcome.untilMs);
      if (outcome.kind === 'auth') this.pool.disableKey(retry.combo.keyIndex, outcome.error.status ?? 0);
    }
    throw last ?? new LlmRequestError('LLM_POOL_EXHAUSTED', 429);
  }

  async runToolLoop(opts: RunToolLoopOptions): Promise<{ summary: string; toolCalls: ToolCallRecord[] }> {
    // The full message array is rebuilt for every request, so whichever key answers sees the same conversation.
    const messages: LlmMessage[] = [{ role: 'system', content: opts.system }, ...opts.messages.slice(-getLlmEnv().maxHistory)];
    const tools = opts.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }));
    const toolCalls: ToolCallRecord[] = [];
    const run: PoolRun = { failed: new Set() };
    for (let iteration = 0; iteration < opts.maxIterations; iteration++) {
      if (opts.signal?.aborted) throw new LlmRequestError('LLM_TIMEOUT');
      const data = await this.request({ messages, tools, ...(opts.toolChoiceName ? { tool_choice: { type: 'function', function: { name: opts.toolChoiceName } } } : {}) }, run, opts.signal, opts.onProviderCall);
      const choices = data.choices as Array<{ message?: { content?: string | null; tool_calls?: OpenAiToolCall[] } }> | undefined;
      const message = choices?.[0]?.message;
      if (!message?.tool_calls?.length) return { summary: message?.content ?? '', toolCalls };
      messages.push({ role: 'assistant', content: message.content, tool_calls: message.tool_calls });
      for (const call of message.tool_calls) {
        let input: unknown;
        let result: string;
        let ok = true;
        try {
          input = JSON.parse(call.function.arguments) as unknown;
          result = await opts.onToolCall({ id: call.id, name: call.function.name, input });
        } catch {
          input = input ?? {};
          result = JSON.stringify({ ok: false, error: 'INVALID_TOOL_ARGUMENTS' });
          ok = false;
        }
        toolCalls.push({ tool: call.function.name, input, ok, result: safeParse(result), at: getNow().toISOString() });
        messages.push({ role: 'tool', tool_call_id: call.id, content: result });
      }
    }
    return { summary: 'Tool iteration limit reached.', toolCalls };
  }

  async structured<T>(opts: StructuredOptions<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const data = await this.request({
          messages: [{ role: 'system', content: `${opts.system}\nReturn only JSON matching this schema: ${JSON.stringify(zodJsonSchema(opts.schema))}` }, { role: 'user', content: opts.input }],
          response_format: { type: 'json_object' },
        }, { failed: new Set() }, undefined, opts.onProviderCall);
        const choices = data.choices as Array<{ message?: { content?: string | null } }> | undefined;
        return opts.schema.parse(JSON.parse(choices?.[0]?.message?.content ?? ''));
      } catch (error) {
        lastError = error;
        // Only malformed JSON earns a second try here; provider errors were already handled by the pool.
        if (error instanceof LlmRequestError || attempt === 1) throw sanitizeLlmError(error);
      }
    }
    throw sanitizeLlmError(lastError);
  }
}

export class LlmRequestError extends Error {
  constructor(public readonly code: string, public readonly status?: number) { super(code); this.name = 'LlmRequestError'; }
}
const MAX_RATE_LIMIT_WAIT_MS = 15_000;
/** Parses "12", "10.5s", "2m59.56s" or "1h2m" style durations into milliseconds. */
export function parseResetDuration(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed) * 1000;
  let total = 0;
  let matched = false;
  for (const [, amount, unit] of trimmed.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    matched = true;
    total += Number(amount) * (unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : unit === 's' ? 1000 : 1);
  }
  return matched ? total : null;
}
/** Wait suggested by a 429 response, bounded so a UI request still finishes promptly. */
export function rateLimitWaitMs(headers: Headers): number {
  const hints = [headers.get('retry-after'), headers.get('x-ratelimit-reset-tokens'), headers.get('x-ratelimit-reset-requests')]
    .map(parseResetDuration).filter((ms): ms is number => ms !== null && ms > 0);
  return hints.length ? Math.min(Math.max(...hints) + 250, MAX_RATE_LIMIT_WAIT_MS) : 350;
}
export function isRetryableLlmError(error: unknown): boolean {
  if (error instanceof LlmRequestError) return error.code === 'LLM_TIMEOUT' || error.code === 'LLM_NETWORK_ERROR' || error.status === 429 || (error.status ?? 0) >= 500;
  const status = typeof error === 'object' && error !== null ? Number((error as { status?: unknown }).status) : 0;
  return status === 429 || status >= 500 || (error instanceof Error && ['AbortError', 'TimeoutError', 'APIConnectionError'].includes(error.name));
}
function sanitizeLlmError(error: unknown): Error { return error instanceof LlmRequestError ? error : new LlmRequestError('LLM_INVALID_RESPONSE'); }
function safeParse(value: string): unknown { try { return JSON.parse(value) as unknown; } catch { return value; } }
function zodJsonSchema(schema: import('zod').ZodType): unknown {
  try { return zodToJsonSchema(schema); } catch { return {}; }
}
// ---------------------------------------------------------------------------
// AnthropicLLM — live implementation
// ---------------------------------------------------------------------------

// Per-call budget. Current Claude models think before answering, so 10 s was too tight; the agent
// run still enforces its own 60 s overall timeout.
const ANTHROPIC_CALL_TIMEOUT_MS = 25_000;
// Effort is accepted by the Claude 4.6+ and 5.x families; older models reject the field.
export function supportsEffort(model: string): boolean {
  return /^claude-(fable|mythos|opus|sonnet|haiku)-(5|4-[6-9])(-|$)/.test(model);
}

class AnthropicLLM implements LLM {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  private async createClient() {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    // Never log apiKey (hard rule 4). The SDK retries 429/5xx once with backoff; callWithRetry adds one more.
    return new Anthropic({ apiKey: this.apiKey, timeout: ANTHROPIC_CALL_TIMEOUT_MS, maxRetries: 1 });
  }

  /** Keep answers short and fast: collections replies are a few sentences plus tool calls. */
  private outputConfig() {
    return supportsEffort(this.model) ? { output_config: { effort: 'low' as const } } : {};
  }

  private async callWithRetry<T>(fn: (signal: AbortSignal) => Promise<T>, outerSignal?: AbortSignal): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (outerSignal?.aborted) throw outerSignal.reason ?? new Error('LLM call aborted');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), ANTHROPIC_CALL_TIMEOUT_MS);
      try {
        return await fn(outerSignal ? AbortSignal.any([controller.signal, outerSignal]) : controller.signal);
      } catch (err: unknown) {
        clearTimeout(timeout);
        if (attempt === 1 || !isRetryableLlmError(err)) throw err;
        // one retry
        await new Promise((r) => setTimeout(r, 500));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error('unreachable');
  }

  async runToolLoop(opts: RunToolLoopOptions): Promise<{ summary: string; toolCalls: ToolCallRecord[] }> {
    const client = await this.createClient();
    const toolCalls: ToolCallRecord[] = [];
    let messages = [...opts.messages] as Anthropic.Messages.MessageParam[];

    const sdkTools = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Messages.Tool['input_schema'],
    }));

    let summary = '';
    let iterations = 0;
    // Current Claude models reject a forced tool_choice, so a required tool is requested in the
    // prompt and the loop stays on `auto` with parallel calls disabled.
    const system = opts.toolChoiceName
      ? `${opts.system}\n\nCall the ${opts.toolChoiceName} tool now, before anything else.`
      : opts.system;

    while (iterations < opts.maxIterations) {
      if (opts.signal?.aborted) throw opts.signal.reason ?? new Error('LLM call aborted');
      const response = await this.callWithRetry((signal) =>
        client.messages.create(
          {
            model: this.model,
            max_tokens: 4096,
            system,
            messages,
            tools: sdkTools,
            tool_choice: { type: 'auto', disable_parallel_tool_use: Boolean(opts.toolChoiceName) },
            ...this.outputConfig(),
          },
          { signal },
        ),
      opts.signal);

      if (response.stop_reason !== 'tool_use') {
        // Extract text summary from final response.
        const textBlock = response.content.find((b) => b.type === 'text');
        summary = textBlock && 'text' in textBlock ? (textBlock.text as string) : '';
        break;
      }

      // Append assistant message.
      messages = [
        ...messages,
        { role: 'assistant', content: response.content },
      ];

      // Process tool calls.
      const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

      for (const block of toolUseBlocks) {
        if (block.type !== 'tool_use') continue;
        const at = getNow().toISOString();
        let resultStr: string;
        let ok = true;
        try {
          resultStr = await opts.onToolCall({ id: block.id, name: block.name, input: block.input });
        } catch (err) {
          resultStr = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
          ok = false;
        }
        toolCalls.push({
          tool: block.name,
          input: block.input,
          ok,
          result: (() => { try { return JSON.parse(resultStr) as unknown; } catch { return resultStr; } })(),
          at,
        });
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: resultStr });
      }

      messages = [...messages, { role: 'user', content: toolResults }];
      iterations++;
    }

    return { summary, toolCalls };
  }

  async structured<T>(opts: StructuredOptions<T>): Promise<T> {
    const client = await this.createClient();
    const { zodOutputFormat } = await import('@anthropic-ai/sdk/helpers/zod');

    const response = await this.callWithRetry((signal) =>
      client.messages.parse(
        {
          model: this.model,
          max_tokens: 2048,
          system: opts.system,
          messages: [{ role: 'user', content: opts.input }],
          output_config: { format: zodOutputFormat(opts.schema), ...(supportsEffort(this.model) ? { effort: 'low' as const } : {}) },
        },
        { signal },
      ),
    );

    return response.parsed_output as T;
  }
}

// ---------------------------------------------------------------------------
// ScriptedLLM — deterministic replay for tests and CI
// ---------------------------------------------------------------------------

export class ScriptedLLM implements LLM {
  /** Persona key for looking up scripts. */
  private readonly persona: string;
  /** Mutable turn counter per instance. */
  private turn = 0;
  private context: Record<string, unknown> | null = null;
  private lastPlanId: string | null = null;

  constructor(persona = 'dana', initialTurn = 0, planId?: string | null) {
    this.persona = persona;
    this.turn = initialTurn;
    this.lastPlanId = planId ?? null;
  }

  async runToolLoop(opts: RunToolLoopOptions): Promise<{ summary: string; toolCalls: ToolCallRecord[] }> {
    if (opts.signal?.aborted) throw opts.signal.reason ?? new Error('LLM call aborted');
    const { scripts } = await import('./agent/scripts');
    const script = scripts[this.persona];
    const agentTurns = script?.agentTurns;
    const currentTurn = this.turn++;

    if (!agentTurns || currentTurn >= agentTurns.length) {
      // Fallback: call get_invoice_context from the user messages if available.
      const tool = opts.tools.find((t) => t.name === 'get_invoice_context');
      if (tool) {
        // Try to extract invoiceId from the first user message.
        const firstMsg = opts.messages.find((m) => m.role === 'user');
        const body = typeof firstMsg?.content === 'string' ? firstMsg.content : JSON.stringify(firstMsg?.content ?? '');
        const match = /invoiceId[": ]+([a-z0-9-]+)/i.exec(body);
        const invoiceId = match?.[1] ?? 'unknown';
        const at = new Date().toISOString();
        let resultStr = '{}';
        let ok = true;
        try {
          resultStr = await opts.onToolCall({ id: 'fallback-ctx', name: 'get_invoice_context', input: { invoiceId } });
        } catch (err) {
          resultStr = JSON.stringify({ error: String(err) });
          ok = false;
        }
        return {
          summary: 'Scripted fallback: retrieved invoice context.',
          toolCalls: [{
            tool: 'get_invoice_context',
            input: { invoiceId },
            ok,
            result: (() => { try { return JSON.parse(resultStr) as unknown; } catch { return resultStr; } })(),
            at,
          }],
        };
      }
      return { summary: 'Scripted fallback: no action.', toolCalls: [] };
    }

    const turnScript = agentTurns[currentTurn]!;
    const toolCalls: ToolCallRecord[] = [];

    for (const tc of turnScript.toolCalls) {
      const at = getNow().toISOString();
      let resultStr: string;
      let ok = true;
      const firstMessage = opts.messages.find((m) => m.role === 'user');
      const messageBody = typeof firstMessage?.content === 'string' ? firstMessage.content : JSON.stringify(firstMessage?.content ?? '');
      const invoiceId = /invoiceId[" :]+([a-z0-9-]+)/i.exec(messageBody)?.[1] ?? 'unknown';
      const input = JSON.parse(JSON.stringify(tc.input)) as Record<string, unknown>;
      const invoice = this.context?.invoice as Record<string, unknown> | undefined;
      const invoiceNumber = String(invoice?.number ?? 'invoice');
      const replace = (value: unknown): unknown => {
        if (typeof value === 'string') {
          let resolved = value.replaceAll('__INVOICE_ID__', invoiceId).replaceAll('__INVOICE_NUMBER__', invoiceNumber);
          if (this.lastPlanId) resolved = resolved.replaceAll('__PLAN_ID__', this.lastPlanId);
          const dateTokens: Record<string, number> = { __DEPOSIT_DATE__: 3, __INSTALLMENT2_DATE__: 33, __INSTALLMENT3_DATE__: 63 };
          for (const [token, days] of Object.entries(dateTokens)) {
            if (resolved.includes(token)) resolved = resolved.replaceAll(token, new Date(getNow().getTime() + days * 86_400_000).toISOString().slice(0, 10));
          }
          return resolved;
        }
        if (Array.isArray(value)) return value.map(replace);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replace(child)]));
        return value;
      };
      const resolvedInput = replace(input) as Record<string, unknown>;
      if (tc.name === 'propose_payment_plan' && invoice) {
        const policy = this.context?.policySummary as Record<string, unknown> | undefined;
        const installments = resolvedInput.installments as Record<string, unknown>[];
        const amount = Number(invoice.amountCents) - Number(invoice.paidCents ?? 0);
        const discount = Number(resolvedInput.discountPercent ?? 0);
        const total = Math.floor((amount * (100 - discount) + 50) / 100);
        const count = installments.length;
        const deposit = Math.ceil(total * Number(policy?.minDepositPercent ?? 30) / 100);
        const each = Math.floor((total - deposit) / Math.max(1, count - 1));
        resolvedInput.installments = installments.map((inst, index) => ({
          ...inst,
          no: index + 1,
          amountCents: index === 0 ? deposit : index === count - 1 ? total - deposit - each * (count - 2) : each,
        }));
      }
      try {
        resultStr = await opts.onToolCall({ id: crypto.randomUUID(), name: tc.name, input: resolvedInput });
        const parsed = JSON.parse(resultStr) as Record<string, unknown>;
        if (tc.name === 'get_invoice_context' && parsed.invoice && typeof parsed.invoice === 'object') this.context = parsed;
        if (tc.name === 'propose_payment_plan' && typeof parsed.planId === 'string') this.lastPlanId = parsed.planId;
      } catch (err) {
        resultStr = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
        ok = false;
      }
      toolCalls.push({
        tool: tc.name,
        input: resolvedInput,
        ok,
        result: (() => { try { return JSON.parse(resultStr) as unknown; } catch { return resultStr; } })(),
        at,
      });
    }

    return { summary: turnScript.summary, toolCalls };
  }

  async structured<T>(opts: StructuredOptions<T>): Promise<T> {
    const { scripts } = await import('./agent/scripts');
    const script = scripts[this.persona];
    if (script?.classifications && script.classifications.length > 0) {
      try {
        const input = JSON.parse(opts.input) as { clientMessage?: unknown };
        const index = script.clientReplies.findIndex((reply) => reply && wrapClientMessage(reply) === input?.clientMessage);
        const classification = script.classifications[index];
        if (classification) return classification as unknown as T;
      } catch {
        // Only recognized, delimited persona replies have a scripted classification.
      }
    }
    // Fallback: return a minimal 'unclear' classification.
    return {
      intent: 'unclear',
      confidence: 0.5,
    } as unknown as T;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

// One pool per process and configuration, so cooldowns learned by one request protect the next.
const poolScope = globalThis as typeof globalThis & { chaserKeyPools?: Map<string, KeyPool> };
function sharedPool(env: ReturnType<typeof getLlmEnv>): KeyPool {
  const models = [...new Set([env.model, env.fallbackModel].filter((value): value is string => Boolean(value)))];
  // The signature is a non-reversible fingerprint; keys themselves are never stored outside env.
  let fingerprint = 2166136261;
  for (const char of env.apiKeys.join('\n')) fingerprint = Math.imul(fingerprint ^ char.charCodeAt(0), 16777619) >>> 0;
  const id = `${env.baseUrl}|${models.join(',')}|${env.apiKeys.length}|${fingerprint}`;
  const pools = poolScope.chaserKeyPools ??= new Map();
  let pool = pools.get(id);
  if (!pool) {
    pool = new KeyPool(env.apiKeys.length, models);
    for (const combo of env.poolExclude) pool.exclude(combo, 'it failed the format check in pnpm llm:smoke --all (LLM_POOL_EXCLUDE)');
    pools.set(id, pool);
  }
  return pool;
}

function openAICompatibleFromEnv(env: ReturnType<typeof getLlmEnv>): OpenAICompatibleLLM {
  return new OpenAICompatibleLLM(env.baseUrl!, env.apiKeys, env.model, { fallbackModel: env.fallbackModel, pool: sharedPool(env) });
}

export function getLLM(persona = 'dana'): LLM {
  const env = getLlmEnv();
  if (env.mode === 'live') {
    if (!env.apiKey) throw new Error(`${env.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'LLM_API_KEYS'} is required for live LLM mode`);
    if (env.provider === 'openai-compatible') return openAICompatibleFromEnv(env);
    return new AnthropicLLM(env.apiKey, env.model);
  }
  const existing = scriptedInstances.get(persona);
  if (existing) return existing;
  const created = new ScriptedLLM(persona);
  scriptedInstances.set(persona, created);
  return created;
}

export function createLiveLLM(env = getLlmEnv()): LLM {
  if (!env.apiKey) throw new Error(`${env.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'LLM_API_KEYS'} is required for live LLM mode`);
  if (env.provider === 'openai-compatible') return openAICompatibleFromEnv(env);
  return new AnthropicLLM(env.apiKey, env.model);
}

const scriptedInstances = new Map<string, ScriptedLLM>();
