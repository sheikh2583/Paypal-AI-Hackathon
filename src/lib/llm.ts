// LLM abstraction layer. All LLM calls go through this module so the provider
// can be swapped without touching caller code. Hard rule 4: never log apiKey.
import type { ToolCallRecord } from './types';
import { getLlmEnv } from './env';
import type Anthropic from '@anthropic-ai/sdk';
import { getNow } from './clock';

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
  role: 'user' | 'assistant';
  content: string | Array<{ type: string; [k: string]: unknown }>;
}

export interface RunToolLoopOptions {
  system: string;
  messages: LlmMessage[];
  tools: ToolDefinition[];
  maxIterations: number;
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

  private async callWithRetry<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        return await fn(controller.signal);
      } catch (err: unknown) {
        clearTimeout(timeout);
        const isRetryable =
          err instanceof Error &&
          err.name === 'AbortError' ||
          ((err as { status?: number }).status != null &&
            ((err as { status?: number }).status ?? 0) >= 500);
        if (attempt === 1 || !isRetryable) throw err;
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
      const response = await this.callWithRetry((signal) =>
        client.messages.create(
          {
            model: this.model,
            max_tokens: 1024,
            system: opts.system,
            messages,
            tools: sdkTools,
          },
          { signal },
        ),
      );

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

  constructor(persona = 'dana') {
    this.persona = persona;
  }

  async runToolLoop(opts: RunToolLoopOptions): Promise<{ summary: string; toolCalls: ToolCallRecord[] }> {
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
      const userText = opts.input.toLowerCase();
      const classification = userText.includes('split') || userText.includes('cannot pay')
        ? script.classifications.find((c) => c.intent === 'cannot_pay_full')
        : userText.includes('yes') || userText.includes('sounds great')
          ? script.classifications.find((c) => c.intent === 'accepts_plan')
          : script.classifications[0];
      if (classification) return classification as unknown as T;
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
    if (!env.apiKey) throw new Error('ANTHROPIC_API_KEY is required for live LLM mode');
    return new AnthropicLLM(env.apiKey, env.model);
  }
  const existing = scriptedInstances.get(persona);
  if (existing) return existing;
  const created = new ScriptedLLM(persona);
  scriptedInstances.set(persona, created);
  return created;
}

const scriptedInstances = new Map<string, ScriptedLLM>();
