import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, closeTestDb } from '../db/test-utils';
import type { AppDb } from '../db/client';
import { getInvoice, getMessages, insertMessage, listApprovals, listAudit, listInvoicesByPlanId, updateInvoice } from '../db/queries';
import { seedDatabase } from '../db/seed';
import { setClockDatabaseForTests, setClockOffset } from '../clock';
import { MockPayPalClient } from '../paypal/mock';
import type { LLM } from '../llm';
import { OpenAICompatibleLLM, ScriptedLLM } from '../llm';
import { KeyPool } from '../llm-pool';
import { applyClassification } from './classify';
import { runAgent, runDueAgents } from './run';
import { buildSystemPrompt } from './prompt';

const DEMO_NOW = new Date('2026-11-03T00:00:00.000Z');
let database: AppDb;
const originalDemoNow = process.env.DEMO_NOW;

async function seeded(): Promise<void> {
  process.env.DEMO_NOW = DEMO_NOW.toISOString();
  database = createTestDb();
  setClockDatabaseForTests(database);
  await seedDatabase(database, { paypalMode: 'mock' }, DEMO_NOW);
  setClockOffset(0, database);
}

afterEach(() => {
  if (database) closeTestDb(database);
  setClockDatabaseForTests(undefined);
  if (originalDemoNow === undefined) delete process.env.DEMO_NOW;
  else process.env.DEMO_NOW = originalDemoNow;
});
const noopLLM: LLM = {
  async runToolLoop() { return { summary: 'No action was needed.', toolCalls: [] }; },
  async structured<T>() { return { ok: true } as T; },
};

describe('agent runs', () => {
  it('completes Dana from reminder through active PayPal installment invoices', async () => {
    await seeded();
    const paypal = new MockPayPalClient(database);
    const llm = new ScriptedLLM('dana');

    const reminder = await runAgent('invoice-dana-900', 'manual', { database, llm, paypal });
    expect(reminder.finalState).toBe('NUDGED');
    expect(getMessages('invoice-dana-900', database).some((message) => message.direction === 'agent_to_client')).toBe(true);

    insertMessage({ id: 'dana-reply-1', invoiceId: 'invoice-dana-900', direction: 'client_to_agent', body: 'Can I split this into three payments?', createdAt: DEMO_NOW.toISOString() }, database);
    applyClassification('invoice-dana-900', { intent: 'cannot_pay_full', confidence: 0.95 }, database);
    const proposal = await runAgent('invoice-dana-900', 'sim', { database, llm, paypal });
    expect(proposal.finalState).toBe('PLAN_OFFERED');

    insertMessage({ id: 'dana-reply-2', invoiceId: 'invoice-dana-900', direction: 'client_to_agent', body: 'Yes, that sounds great!', createdAt: DEMO_NOW.toISOString() }, database);
    applyClassification('invoice-dana-900', { intent: 'accepts_plan', confidence: 0.97 }, database);
    const active = await runAgent('invoice-dana-900', 'sim', { database, llm, paypal });
    expect(active.finalState).toBe('PLAN_ACTIVE');
    expect(getInvoice('invoice-dana-900', database)?.status).toBe('SUPERSEDED');
    expect(listInvoicesByPlanId(getInvoice('invoice-dana-900', database)?.planId ?? '', database).filter((row) => row.parentInvoiceId === 'invoice-dana-900')).toHaveLength(3);
    expect(listAudit('invoice-dana-900', database).length).toBeGreaterThan(5);
  });

  it('enforces a six-tool-call ceiling even if an LLM ignores the requested iteration cap', async () => {
    await seeded();
    const overcalling: LLM = {
      async structured<T>() { return {} as T; },
      async runToolLoop(options) {
        const toolCalls = [];
        for (let index = 0; index < 12; index += 1) {
          const input = { invoiceId: 'invoice-dana-900', body: `Reminder ${index}` };
          const result = await options.onToolCall({ id: `call-${index}`, name: 'send_message', input });
          toolCalls.push({ tool: 'send_message', input, ok: true, result: JSON.parse(result) as unknown, at: DEMO_NOW.toISOString() });
        }
        return { summary: 'Sent reminders. No more action needed.', toolCalls };
      },
    };
    const result = await runAgent('invoice-dana-900', 'manual', { database, llm: overcalling });
    expect(result.toolCalls).toHaveLength(6);
    expect(getMessages('invoice-dana-900', database).filter((message) => message.direction === 'agent_to_client')).toHaveLength(6);
  });

  it('rejects a concurrent run for the same invoice and leaves chase_state unchanged after NO_ACTION', async () => {
    await seeded();
    let started!: () => void;
    let release!: () => void;
    const began = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const blockingLLM: LLM = {
      async structured<T>() { return {} as T; },
      async runToolLoop() { started(); await gate; return { summary: 'No action needed.', toolCalls: [] }; },
    };
    const first = runAgent('invoice-dana-900', 'manual', { database, llm: blockingLLM });
    await began;
    await expect(runAgent('invoice-dana-900', 'manual', { database, llm: noopLLM })).rejects.toThrow('AGENT_RUN_IN_PROGRESS');
    release();
    const result = await first;
    expect(result.finalState).toBe('NO_ACTION');
    expect(getInvoice('invoice-dana-900', database)?.chaseState).toBe('NEW');
    expect(getInvoice('invoice-dana-900', database)?.lastAgentRunAt).not.toBeNull();
    expect(getMessages('invoice-dana-900', database).some((message) => message.direction === 'system' && message.body === result.summary)).toBe(true);
  });

  it('runs only invoices whose follow-up time is due', async () => {
    await seeded();
    updateInvoice('invoice-dana-900', { nextFollowupAt: '2026-11-02T23:59:00.000Z' }, database);
    updateInvoice('invoice-marcus-1250', { nextFollowupAt: '2026-11-04T00:00:00.000Z' }, database);
    const results = await runDueAgents(database, { llm: noopLLM });
    expect(results).toHaveLength(1);
    expect(listAudit(undefined, database).filter((entry) => entry.action === 'agent_run' && entry.ok).map((entry) => entry.invoiceId)).toContain('invoice-dana-900');
    expect(listAudit(undefined, database).filter((entry) => entry.action === 'agent_run' && entry.ok).map((entry) => entry.invoiceId)).not.toContain('invoice-marcus-1250');
  });

  it('escalates a scripted Marcus run after four unanswered agent reminders', async () => {
    await seeded();
    for (let index = 0; index < 4; index += 1) {
      insertMessage({ id: `marcus-nudge-${index}`, invoiceId: 'invoice-marcus-1250', direction: 'agent_to_client', body: `Reminder ${index + 1}`, createdAt: new Date(DEMO_NOW.getTime() + index).toISOString() }, database);
    }
    const result = await runAgent('invoice-marcus-1250', 'due', { database, llm: new ScriptedLLM('marcus') });
    expect(result.finalState).toBe('ESCALATED');
    expect(result.toolCalls[0]?.tool).toBe('escalate_to_owner');
    expect(listApprovals('PENDING', database).some((approval) => approval.invoiceId === 'invoice-marcus-1250' && approval.kind === 'UNCLEAR' && /4 reminders/.test(approval.reason))).toBe(true);
    expect(buildSystemPrompt({ minDepositPercent: 30, maxInstallments: 3, maxPlanDays: 90, maxDiscountPercent: 5, tone: 'firm' }, 'Maya', 'Studio', 'firm')).toContain('4 or more unanswered nudges');
  });

  it('keeps Elena pending owner sign-off without exposing plan terms', async () => {
    await seeded();
    const paypal = new MockPayPalClient(database);
    const llm = new ScriptedLLM('elena');
    await runAgent('invoice-elena-2400', 'manual', { database, llm, paypal });
    insertMessage({ id: 'elena-reply-1', invoiceId: 'invoice-elena-2400', direction: 'client_to_agent', body: 'Could we split this into three payments with a small deposit?', createdAt: DEMO_NOW.toISOString() }, database);
    applyClassification('invoice-elena-2400', { intent: 'cannot_pay_full', proposedInstallments: 3, confidence: 0.93 }, database);
    const result = await runAgent('invoice-elena-2400', 'sim', { database, llm, paypal });
    expect(result.finalState).toBe('ESCALATED');
    expect(listApprovals('PENDING', database).some((approval) => approval.invoiceId === 'invoice-elena-2400' && approval.kind === 'PLAN_NEEDS_SIGNOFF')).toBe(true);
    const visibleMessages = getMessages('invoice-elena-2400', database).filter((message) => message.direction === 'agent_to_client').map((message) => message.body).join(' ');
    expect(visibleMessages).not.toMatch(/\$24\.00|\$840\.00|\$720\.00|installment 1/i);
  });

  it('falls back to scripted mode after a retryable first live-provider failure and audits it', async () => {
    await seeded();
    const saved = { LLM_MODE: process.env.LLM_MODE, LLM_PROVIDER: process.env.LLM_PROVIDER, LLM_API_KEY: process.env.LLM_API_KEY, LLM_BASE_URL: process.env.LLM_BASE_URL, LLM_MODEL: process.env.LLM_MODEL };
    Object.assign(process.env, { LLM_MODE: 'live', LLM_PROVIDER: 'openai-compatible', LLM_API_KEY: 'test-key', LLM_BASE_URL: 'https://provider.test/v1', LLM_MODEL: 'test-model' });
    const fetchMock = vi.fn(async () => new Response('rate limited', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    const failing = new OpenAICompatibleLLM('https://provider.test/v1', 'test-key', 'test-model');
    try {
      const result = await runAgent('invoice-dana-900', 'manual', { database, llm: failing, paypal: new MockPayPalClient(database) });
      expect(result.summary).toContain('scripted fallback');
      expect(getMessages('invoice-dana-900', database).some((message) => message.direction === 'system' && message.body.includes('scripted fallback'))).toBe(true);
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(listAudit('invoice-dana-900', database).some((entry) => entry.action === 'llm.fallback' && (entry.input as { provider?: string }).provider === 'openai-compatible')).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      for (const [key, value] of Object.entries(saved)) { if (value === undefined) { delete process.env[key]; } else { process.env[key] = value; } }
    }
  });

  it('with a key pool: falls back to the guided reply only when every key is busy before any side effect, and audits key numbers', async () => {
    await seeded();
    const saved = { LLM_MODE: process.env.LLM_MODE, LLM_PROVIDER: process.env.LLM_PROVIDER, LLM_API_KEY: process.env.LLM_API_KEY, LLM_BASE_URL: process.env.LLM_BASE_URL, LLM_MODEL: process.env.LLM_MODEL };
    Object.assign(process.env, { LLM_MODE: 'live', LLM_PROVIDER: 'openai-compatible', LLM_API_KEY: 'key-one', LLM_BASE_URL: 'https://provider.test/v1', LLM_MODEL: 'test-model' });
    const fetchMock = vi.fn(async () => new Response('{"error":{"status":"RESOURCE_EXHAUSTED","details":[{"retryDelay":"40s"}]}}', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    const pooled = new OpenAICompatibleLLM('https://provider.test/v1', ['key-one', 'key-two', 'key-three'], 'test-model', { pool: new KeyPool(3, ['test-model'], Date.now, () => undefined) });
    try {
      const result = await runAgent('invoice-dana-900', 'manual', { database, llm: pooled, paypal: new MockPayPalClient(database) });
      expect(result.summary).toContain('scripted fallback');
      // Each key exactly once for the agent turn, with no waiting when more than one key exists.
      const calls = listAudit('invoice-dana-900', database).filter((entry) => entry.action === 'llm.call' && (entry.input as { purpose: string }).purpose === 'agent_run');
      expect(calls.map((entry) => (entry.input as { keyNumber: number }).keyNumber).sort()).toEqual([1, 2, 3]);
      expect(JSON.stringify(listAudit(undefined, database))).not.toMatch(/key-one|key-two|key-three/);
    } finally {
      vi.unstubAllGlobals();
      for (const [key, value] of Object.entries(saved)) { if (value === undefined) { delete process.env[key]; } else { process.env[key] = value; } }
    }
  });

  it('with a key pool: after a side effect, an exhausted pool neither falls back nor re-runs the tool', async () => {
    await seeded();
    const saved = { LLM_MODE: process.env.LLM_MODE, LLM_PROVIDER: process.env.LLM_PROVIDER, LLM_API_KEY: process.env.LLM_API_KEY, LLM_BASE_URL: process.env.LLM_BASE_URL, LLM_MODEL: process.env.LLM_MODEL };
    Object.assign(process.env, { LLM_MODE: 'live', LLM_PROVIDER: 'openai-compatible', LLM_API_KEY: 'key-one', LLM_BASE_URL: 'https://provider.test/v1', LLM_MODEL: 'test-model' });
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'send_message', arguments: JSON.stringify({ invoiceId: 'invoice-dana-900', body: 'Pool reminder' }) } }] } }] }), { status: 200 });
      }
      return new Response('{"error":{"status":"RESOURCE_EXHAUSTED"}}', { status: 429 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const pooled = new OpenAICompatibleLLM('https://provider.test/v1', ['key-one', 'key-two'], 'test-model', { pool: new KeyPool(2, ['test-model'], Date.now, () => undefined) });
    try {
      await expect(runAgent('invoice-dana-900', 'manual', { database, llm: pooled, paypal: new MockPayPalClient(database) })).rejects.toThrow('LLM_HTTP_429');
      expect(fetchMock).toHaveBeenCalledTimes(3); // one answer, then each key once for the next turn
      expect(listAudit('invoice-dana-900', database).some((entry) => entry.action === 'llm.fallback')).toBe(false);
      expect(getMessages('invoice-dana-900', database).filter((message) => message.body === 'Pool reminder')).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
      for (const [key, value] of Object.entries(saved)) { if (value === undefined) { delete process.env[key]; } else { process.env[key] = value; } }
    }
  });

  it('asks for the invoices first once the client has accepted a plan, and passes the plan ID', async () => {
    await seeded();
    const paypal = new MockPayPalClient(database);
    const scripted = new ScriptedLLM('dana');
    await runAgent('invoice-dana-900', 'manual', { database, llm: scripted, paypal });
    insertMessage({ id: 'reply-1', invoiceId: 'invoice-dana-900', direction: 'client_to_agent', body: 'Can I split this?', createdAt: DEMO_NOW.toISOString() }, database);
    applyClassification('invoice-dana-900', { intent: 'cannot_pay_full', confidence: 0.95 }, database);
    await runAgent('invoice-dana-900', 'sim', { database, llm: scripted, paypal });
    insertMessage({ id: 'reply-2', invoiceId: 'invoice-dana-900', direction: 'client_to_agent', body: 'Yes, that works.', createdAt: DEMO_NOW.toISOString() }, database);
    applyClassification('invoice-dana-900', { intent: 'accepts_plan', confidence: 0.95 }, database);

    let seen: { toolChoiceName?: string; content?: string } = {};
    const watching: LLM = {
      async structured<T>() { return {} as T; },
      async runToolLoop(options) {
        seen = { toolChoiceName: options.toolChoiceName, content: String(options.messages[0]?.content) };
        return scripted.runToolLoop(options);
      },
    };
    await runAgent('invoice-dana-900', 'sim', { database, llm: watching, paypal });
    expect(seen.toolChoiceName).toBe('create_plan_invoices');
    expect(JSON.parse(seen.content ?? '{}')).toMatchObject({ acceptedPlanId: expect.any(String) });
  });

  it('tells the model today’s date from the demo clock, so plan due dates are not guessed', async () => {
    await seeded();
    const { handleToolCall } = await import('./tools');
    const later = new Date('2026-11-20T09:00:00.000Z');
    const context = JSON.parse(await handleToolCall('get_invoice_context', { invoiceId: 'invoice-dana-900' }, database, later)) as { today: string };
    expect(context.today).toBe('2026-11-20');
    expect(buildSystemPrompt({ minDepositPercent: 30, maxInstallments: 3, maxPlanDays: 90, maxDiscountPercent: 5, tone: 'friendly' }, 'Maya', 'Studio', 'friendly')).toContain('on or after "today"');
  });

  it('hands the model the real pay links, accepts a confirmation that quotes one, and reports the plan as active even at the cap', async () => {
    await seeded();
    const paypal = new MockPayPalClient(database);
    const scripted = new ScriptedLLM('dana');
    await runAgent('invoice-dana-900', 'manual', { database, llm: scripted, paypal });
    insertMessage({ id: 'reply-1', invoiceId: 'invoice-dana-900', direction: 'client_to_agent', body: 'Can I split this?', createdAt: DEMO_NOW.toISOString() }, database);
    applyClassification('invoice-dana-900', { intent: 'cannot_pay_full', confidence: 0.95 }, database);
    await runAgent('invoice-dana-900', 'sim', { database, llm: scripted, paypal });
    insertMessage({ id: 'reply-2', invoiceId: 'invoice-dana-900', direction: 'client_to_agent', body: 'Yes, that works.', createdAt: DEMO_NOW.toISOString() }, database);
    applyClassification('invoice-dana-900', { intent: 'accepts_plan', confidence: 0.95 }, database);

    const results: Record<string, unknown>[] = [];
    const confirming: LLM = {
      async structured<T>() { return {} as T; },
      async runToolLoop(options) {
        const { acceptedPlanId } = JSON.parse(String(options.messages[0]?.content)) as { acceptedPlanId: string };
        const call = async (name: string, input: Record<string, unknown>) => {
          const result = JSON.parse(await options.onToolCall({ id: name, name, input })) as Record<string, unknown>;
          results.push(result);
          return { tool: name, input, ok: true, result, at: DEMO_NOW.toISOString() };
        };
        const created = await call('create_plan_invoices', { planId: acceptedPlanId });
        const [first] = (created.result.installments ?? []) as { payUrl: string }[];
        const sent = await call('send_message', { invoiceId: 'invoice-dana-900', body: `All set. Your first payment is here: ${first?.payUrl}.` });
        const invented = await call('send_message', { invoiceId: 'invoice-dana-900', body: 'Pay at https://paypal.com/invoice/i/#made-up' });
        const followup = await call('schedule_followup', { invoiceId: 'invoice-dana-900', inDays: 3 });
        return { summary: 'Tool iteration limit reached.', toolCalls: [created, sent, invented, followup] };
      },
    };
    const result = await runAgent('invoice-dana-900', 'sim', { database, llm: confirming, paypal });

    const installments = results[0]?.installments as { installmentNo: number; amountCents: number; dueAt: string; payUrl: string }[];
    expect(installments).toHaveLength(3);
    expect(installments.every((item) => item.payUrl.startsWith('http') && Number.isInteger(item.amountCents))).toBe(true);
    expect(results[1]).toMatchObject({ ok: true });
    expect(results[2]).toMatchObject({ ok: false, error: 'URL_NOT_ALLOWED' });
    expect(result.finalState).toBe('PLAN_ACTIVE');
    expect(result.summary).toBe('Created the approved installment invoices.');
  });

  it('uses the given step script, not the generic one, when the live model fails first', async () => {
    await seeded();
    const saved = { LLM_MODE: process.env.LLM_MODE, LLM_PROVIDER: process.env.LLM_PROVIDER, LLM_API_KEY: process.env.LLM_API_KEY, LLM_BASE_URL: process.env.LLM_BASE_URL, LLM_MODEL: process.env.LLM_MODEL };
    Object.assign(process.env, { LLM_MODE: 'live', LLM_PROVIDER: 'openai-compatible', LLM_API_KEY: 'test-key', LLM_BASE_URL: 'https://provider.test/v1', LLM_MODEL: 'test-model' });
    const failing: LLM = { async structured<T>() { return {} as T; }, async runToolLoop() { throw Object.assign(new Error('LLM_HTTP_503'), { status: 503 }); } };
    let fallbackUsed = false;
    const stepScript: LLM = { async structured<T>() { return {} as T; }, async runToolLoop() { fallbackUsed = true; return { summary: 'Step script answered.', toolCalls: [] }; } };
    try {
      const result = await runAgent('invoice-dana-900', 'sim', { database, llm: failing, fallbackLlm: stepScript });
      expect(fallbackUsed).toBe(true);
      expect(result.summary).toContain('scripted fallback');
    } finally {
      for (const [key, value] of Object.entries(saved)) { if (value === undefined) { delete process.env[key]; } else { process.env[key] = value; } }
    }
  });

  it('does not fall back after a side-effecting tool has run', async () => {
    await seeded();
    const saved = { LLM_MODE: process.env.LLM_MODE, LLM_PROVIDER: process.env.LLM_PROVIDER, LLM_API_KEY: process.env.LLM_API_KEY, LLM_BASE_URL: process.env.LLM_BASE_URL, LLM_MODEL: process.env.LLM_MODEL };
    Object.assign(process.env, { LLM_MODE: 'live', LLM_PROVIDER: 'openai-compatible', LLM_API_KEY: 'test-key', LLM_BASE_URL: 'https://provider.test/v1', LLM_MODEL: 'test-model' });
    const failing: LLM = {
      async structured<T>() { return {} as T; },
      async runToolLoop(options) {
        await options.onToolCall({ id: 'send', name: 'send_message', input: { invoiceId: 'invoice-dana-900', body: 'Reminder' } });
        throw Object.assign(new Error('LLM_HTTP_503'), { status: 503 });
      },
    };
    try {
      await expect(runAgent('invoice-dana-900', 'manual', { database, llm: failing })).rejects.toThrow('LLM_HTTP_503');
      expect(listAudit('invoice-dana-900', database).some((entry) => entry.action === 'llm.fallback')).toBe(false);
      expect(getMessages('invoice-dana-900', database).some((message) => message.body === 'Reminder')).toBe(true);
    } finally {
      for (const [key, value] of Object.entries(saved)) { if (value === undefined) { delete process.env[key]; } else { process.env[key] = value; } }
    }
  });
});
