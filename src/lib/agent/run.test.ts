import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, closeTestDb } from '../db/test-utils';
import type { AppDb } from '../db/client';
import { getInvoice, getMessages, insertMessage, listApprovals, listAudit, listInvoicesByPlanId, updateInvoice } from '../db/queries';
import { seedDatabase } from '../db/seed';
import { setClockDatabaseForTests, setClockOffset } from '../clock';
import { MockPayPalClient } from '../paypal/mock';
import type { LLM } from '../llm';
import { OpenAICompatibleLLM, ScriptedLLM } from '../llm';
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
