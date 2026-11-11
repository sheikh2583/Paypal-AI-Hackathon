// LLM abstraction layer. All LLM calls go through this module so the provider
// can be swapped without touching caller code. Hard rule 4: never log apiKey.
import type { ToolCallRecord } from './types';
import { getLlmEnv } from './env';
import type Anthropic from '@anthropic-ai/sdk';
import { getNow } from './clock';
import { wrapClientMessage } from './agent/prompt';
import { toJSONSchema as zodToJsonSchema } from 'zod';

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
}

export interface StructuredOptions<T> {
  system: string;
  input: string;
  schema: import('zod').ZodType<T>;
}

export interface LLM {
  runToolLoop(opts: RunToolLoopOptions): Promise<{ summary: string; toolCalls: ToolCallRecord[] }>;
  structured<T>(opts: StructuredOptions<T>): Promise<T>;
}

/** Plain-fetch OpenAI Chat Completions adapter. Provider errors deliberately omit response bodies. */
export class OpenAICompatibleLLM implements LLM {
  // Free-tier providers regularly take 6-10 s per call; 20 s keeps one slow call from aborting a run.
  constructor(private readonly baseUrl: string, private readonly apiKey: string, private readonly model: string, private readonly timeoutMs = 20_000) {}

  private async request(body: Record<string, unknown>, outerSignal?: AbortSignal): Promise<Record<string, unknown>> {
    let last: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({ model: this.model, ...body }),
          signal: outerSignal ? AbortSignal.any([controller.signal, outerSignal]) : controller.signal,
        });
        if (!response.ok) {
          const error = new LlmRequestError(`LLM_HTTP_${response.status}`, response.status);
          if (attempt === 0 && retryableStatus(response.status)) {
            last = error;
            // Honour the provider's retry-after (seconds) on 429. Each attempt has its own timeout,
            // so the wait is bounded separately to keep a UI request under about half a minute.
            const retryAfter = Number(response.headers.get('retry-after'));
            const waitMs = response.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 15_000) : 350;
            await new Promise((resolve) => setTimeout(resolve, waitMs));
            continue;
          }
          throw error;
        }
        return await response.json() as Record<string, unknown>;
      } catch (error) {
        const safe = error instanceof LlmRequestError ? error : new LlmRequestError(controller.signal.aborted || outerSignal?.aborted ? 'LLM_TIMEOUT' : 'LLM_NETWORK_ERROR');
        last = safe;
        if (attempt === 1 || !isRetryableLlmError(safe)) throw safe;
        await new Promise((resolve) => setTimeout(resolve, 350));
      } finally { clearTimeout(timeout); }
    }
    throw last instanceof Error ? last : new LlmRequestError('LLM_REQUEST_FAILED');
  }

  async runToolLoop(opts: RunToolLoopOptions): Promise<{ summary: string; toolCalls: ToolCallRecord[] }> {
    const messages: LlmMessage[] = [{ role: 'system', content: opts.system }, ...opts.messages.slice(-getLlmEnv().maxHistory)];
    const tools = opts.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }));
    const toolCalls: ToolCallRecord[] = [];
    for (let iteration = 0; iteration < opts.maxIterations; iteration++) {
      if (opts.signal?.aborted) throw new LlmRequestError('LLM_TIMEOUT');
      const data = await this.request({ messages, tools, ...(opts.toolChoiceName ? { tool_choice: { type: 'function', function: { name: opts.toolChoiceName } } } : {}) }, opts.signal);
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
        });
        const choices = data.choices as Array<{ message?: { content?: string | null } }> | undefined;
        return opts.schema.parse(JSON.parse(choices?.[0]?.message?.content ?? ''));
      } catch (error) {
        lastError = error;
        if (isRetryableLlmError(error) || attempt === 1) throw sanitizeLlmError(error);
      }
    }
    throw sanitizeLlmError(lastError);
  }
}

export class LlmRequestError extends Error {
  constructor(public readonly code: string, public readonly status?: number) { super(code); this.name = 'LlmRequestError'; }
}
function retryableStatus(status: number): boolean { return status === 429 || status >= 500; }
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

class AnthropicLLM implements LLM {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  private async createClient() {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    // Never log apiKey (hard rule 4).
    return new Anthropic({ apiKey: this.apiKey });
  }

  private async callWithRetry<T>(fn: (signal: AbortSignal) => Promise<T>, outerSignal?: AbortSignal): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (outerSignal?.aborted) throw outerSignal.reason ?? new Error('LLM call aborted');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
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

    while (iterations < opts.maxIterations) {
      if (opts.signal?.aborted) throw opts.signal.reason ?? new Error('LLM call aborted');
      const response = await this.callWithRetry((signal) =>
        client.messages.create(
          {
            model: this.model,
            max_tokens: 1024,
            system: opts.system,
            messages,
            tools: sdkTools,
            ...(opts.toolChoiceName ? { tool_choice: { type: 'tool' as const, name: opts.toolChoiceName } } : {}),
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
          max_tokens: 512,
          system: opts.system,
          messages: [{ role: 'user', content: opts.input }],
          output_config: { format: zodOutputFormat(opts.schema) },
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

export function getLLM(persona = 'dana'): LLM {
  const env = getLlmEnv();
  if (env.mode === 'live') {
    if (!env.apiKey) throw new Error(`${env.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'LLM_API_KEY'} is required for live LLM mode`);
    if (env.provider === 'openai-compatible') return new OpenAICompatibleLLM(env.baseUrl!, env.apiKey, env.model);
    return new AnthropicLLM(env.apiKey, env.model);
  }
  const existing = scriptedInstances.get(persona);
  if (existing) return existing;
  const created = new ScriptedLLM(persona);
  scriptedInstances.set(persona, created);
  return created;
}

export function createLiveLLM(env = getLlmEnv()): LLM {
  if (!env.apiKey) throw new Error(`${env.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'LLM_API_KEY'} is required for live LLM mode`);
  if (env.provider === 'openai-compatible') return new OpenAICompatibleLLM(env.baseUrl!, env.apiKey, env.model);
  return new AnthropicLLM(env.apiKey, env.model);
}

const scriptedInstances = new Map<string, ScriptedLLM>();
