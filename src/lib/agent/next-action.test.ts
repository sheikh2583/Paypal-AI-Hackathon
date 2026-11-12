import { describe, expect, it } from 'vitest';
import type { ApprovalRow, InvoiceRow, PlanRow } from '../types';
import { nextAction } from './next-action';

const invoice = (overrides: Partial<InvoiceRow> = {}): InvoiceRow => ({
  id: 'inv-1', paypalInvoiceId: null, paypalInvoiceUrl: null, clientId: 'client-1', number: 'CH-1', description: 'Service',
  amountCents: 90_000, paidCents: 0, currency: 'USD', issuedAt: '2026-10-01T00:00:00Z', dueAt: '2026-10-15T00:00:00Z',
  status: 'OVERDUE', parentInvoiceId: null, planId: null, installmentNo: null, chaseState: 'NEW', riskScore: null,
  riskFactors: [], riskExplanation: null, lastAgentRunAt: null, nextFollowupAt: null, ...overrides,
});

const approval: ApprovalRow = {
  id: 'approval-1', invoiceId: 'inv-1', planId: null, kind: 'UNCLEAR', reason: 'review', recommendation: 'call',
  status: 'PENDING', ownerResponse: null, createdAt: '2026-11-03T00:00:00Z', resolvedAt: null,
};

const activePlan: PlanRow = {
  id: 'plan-1', invoiceId: 'inv-1', status: 'ACTIVE', discountPercent: 0, totalCents: 90_000,
  installments: [{ no: 1, amountCents: 27_000, dueAt: '2026-11-06' }, { no: 2, amountCents: 63_000, dueAt: '2026-12-06' }],
  createdBy: 'agent', approvedBy: 'policy', createdAt: '2026-11-01T00:00:00Z',
};

describe('nextAction', () => {
  it('labels a new invoice for its first reminder', () => expect(nextAction(invoice(), null, [])).toBe('Send first reminder'));
  it('labels chased invoices as waiting for a client reply', () => expect(nextAction(invoice({ chaseState: 'NUDGED' }), null, [])).toBe('Waiting for client reply'));
  it('labels a scheduled follow-up with its date', () => expect(nextAction(invoice({ nextFollowupAt: '2026-11-10T12:00:00.000Z' }), null, [])).toBe('Follow up on Nov 10'));
  it('labels pending approvals', () => expect(nextAction(invoice(), null, [approval])).toBe('Answer in Approvals'));
  it('uses the earliest open installment and ignores a paid deposit and a cancelled invoice', () => {
    const installments = [
      invoice({ status: 'SENT', dueAt: '2026-12-06' }),
      invoice({ status: 'PAID', dueAt: '2026-11-06' }),
      invoice({ status: 'CANCELLED', dueAt: '2026-11-09' }),
      invoice({ status: 'OVERDUE', dueAt: '2026-11-12' }),
    ];
    expect(nextAction(invoice(), activePlan, [], installments)).toBe('Next installment due Nov 12');
    expect(nextAction(invoice(), activePlan, [], installments.slice(1, 3))).toBe('Review payment plan');
  });
  it('labels paid or resolved invoices', () => expect(nextAction(invoice({ status: 'PAID' }), null, [])).toBe('Paid'));
});
