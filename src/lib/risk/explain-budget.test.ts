import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeTestDb, createTestDb } from '../db/test-utils';
import type { AppDb } from '../db/client';
import { getInvoice, updateInvoice } from '../db/queries';
import { seedDatabase } from '../db/seed';

// Count model calls without a network: the live model is replaced by a stub.
const calls = vi.hoisted(() => ({ structured: 0 }));
vi.mock('../llm', async (original) => ({
  ...await original<typeof import('../llm')>(),
  getLLM: () => ({
    async structured<T>() { calls.structured += 1; return { explanation: 'Written by the model.' } as T; },
    async runToolLoop() { return { summary: '', toolCalls: [] }; },
  }),
}));

const NOW = new Date('2026-11-03T00:00:00.000Z');
const saved = { ...process.env };
let database: AppDb;
afterEach(() => {
  if (database) closeTestDb(database);
  process.env = { ...saved };
  calls.structured = 0;
});

describe('risk explanations and the free-tier request budget', () => {
  it('seeds the demo without asking the model, then lets an agent-driven refresh use it', async () => {
    Object.assign(process.env, { LLM_MODE: 'live', LLM_PROVIDER: 'openai-compatible', LLM_API_KEY: 'test-key', LLM_BASE_URL: 'https://provider.test/v1', LLM_MODEL: 'test-model' });
    database = createTestDb();
    await seedDatabase(database, { paypalMode: 'mock' }, NOW);
    expect(calls.structured).toBe(0);
    expect(getInvoice('invoice-dana-900', database)?.riskExplanation).toMatch(/^Risk \d+ of 100/);

    const { refreshRisk } = await import('./service');
    await refreshRisk('invoice-dana-900', database, NOW, { explain: 'template' });
    expect(calls.structured).toBe(0);

    updateInvoice('invoice-dana-900', { riskExplanation: null }, database);
    await refreshRisk('invoice-dana-900', database, NOW);
    expect(calls.structured).toBe(1);
    expect(getInvoice('invoice-dana-900', database)?.riskExplanation).toBe('Written by the model.');
  });
});
