import { afterEach, describe, expect, it } from 'vitest';
import { closeTestDb, createTestDb } from '../db/test-utils';
import type { AppDb } from '../db/client';
import { getInvoice, insertMessage } from '../db/queries';
import { seedDatabase } from '../db/seed';
import { riskLabel } from './index';
import { refreshRisk, riskFeaturesForInvoice } from './service';

const DEMO_NOW = new Date('2026-11-03T00:00:00.000Z');
let database: AppDb;

afterEach(() => { if (database) closeTestDb(database); });

describe('refreshRisk', () => {
  it('computes and stores the docs/06 risk scores for all five seeded overdue invoices', async () => {
    database = createTestDb();
    await seedDatabase(database, { paypalMode: 'mock' }, DEMO_NOW);
    const expected = [
      ['invoice-dana-900', 30, 'Low'],
      ['invoice-marcus-1250', 80, 'High'],
      ['invoice-priya-600', 25, 'Low'],
      ['invoice-tom-350', 10, 'Low'],
      ['invoice-elena-2400', 40, 'Medium'],
    ] as const;
    for (const [invoiceId, score, label] of expected) {
      const result = await refreshRisk(invoiceId, database, DEMO_NOW);
      expect(result.score).toBe(score);
      expect(riskLabel(result.score)).toBe(label);
      expect(getInvoice(invoiceId, database)?.riskScore).toBe(score);
      expect(getInvoice(invoiceId, database)?.riskFactors.reduce((sum, factor) => sum + factor.impact, 0)).toBe(score);
      expect(getInvoice(invoiceId, database)?.riskExplanation).toBeTruthy();
    }
  });

  it('counts only agent nudges after the latest client message', async () => {
    database = createTestDb();
    await seedDatabase(database, { paypalMode: 'mock' }, DEMO_NOW);
    const invoiceId = 'invoice-dana-900';
    insertMessage({ id: 'old-nudge-1', invoiceId, direction: 'agent_to_client', body: 'old 1', createdAt: '2026-11-01T00:00:00.000Z' }, database);
    insertMessage({ id: 'old-nudge-2', invoiceId, direction: 'agent_to_client', body: 'old 2', createdAt: '2026-11-01T01:00:00.000Z' }, database);
    insertMessage({ id: 'latest-client', invoiceId, direction: 'client_to_agent', body: 'I will pay soon', createdAt: '2026-11-02T00:00:00.000Z' }, database);
    insertMessage({ id: 'new-nudge-1', invoiceId, direction: 'agent_to_client', body: 'new 1', createdAt: '2026-11-02T01:00:00.000Z' }, database);
    insertMessage({ id: 'new-nudge-2', invoiceId, direction: 'agent_to_client', body: 'new 2', createdAt: '2026-11-02T02:00:00.000Z' }, database);
    const invoice = getInvoice(invoiceId, database)!;
    expect(riskFeaturesForInvoice(invoice, database, DEMO_NOW).unansweredNudges).toBe(2);
    expect((await refreshRisk(invoiceId, database, DEMO_NOW)).score).toBe(40);
  });
});
