import { z } from 'zod';
import { getLlmEnv } from '../env';
import { getNow } from '../clock';
import { db, type AppDb } from '../db/client';
import { getClient, getInvoice, getMessages, updateInvoice } from '../db/queries';
import { getLLM } from '../llm';
import { auditProviderCall } from '../audit';
import type { InvoiceRow, RiskResult } from '../types';
import { computeRisk, type RiskFeatures } from './index';

const explanationSchema = z.object({ explanation: z.string().min(1).max(500) });
const DAY_MS = 86_400_000;

export function riskFeaturesForInvoice(invoice: InvoiceRow, database: AppDb, now = getNow()): RiskFeatures {
  const client = getClient(invoice.clientId, database);
  if (!client) throw new Error('CLIENT_NOT_FOUND');
  const messages = getMessages(invoice.id, database);
  let unansweredNudges = 0;
  for (const message of [...messages].reverse()) {
    if (message.direction === 'client_to_agent') break;
    if (message.direction === 'agent_to_client') unansweredNudges += 1;
  }
  const dueMs = Date.parse(invoice.dueAt.length === 10 ? `${invoice.dueAt}T00:00:00.000Z` : invoice.dueAt);
  return {
    daysOverdue: Math.max(0, Math.floor((now.getTime() - dueMs) / DAY_MS)),
    amountCents: invoice.amountCents,
    lateCount: client.lateCount,
    avgDaysLate: client.avgDaysLate,
    responsiveness: client.responsiveness,
    unansweredNudges,
    hasPartialPayment: invoice.paidCents > 0 && invoice.paidCents < invoice.amountCents,
  };
}

/** Turns a stored factor label such as "Days overdue (23)" into words an owner would use. */
export function plainFactor(factor: string): string {
  const value = /\(([^)]*)\)/.exec(factor)?.[1] ?? '';
  if (factor.startsWith('Days overdue')) return `${value} days overdue`;
  if (factor.startsWith('Invoice amount')) return `the amount (${value})`;
  if (factor.startsWith('Client late count')) return `paid late ${value} ${value === '1' ? 'time' : 'times'} before`;
  if (factor.startsWith('Avg days late')) return `usually pays ${value} days late`;
  if (factor.startsWith('Responsiveness')) return value === 'high' ? 'usually replies quickly' : value === 'low' ? 'often slow to reply' : 'replies within a few days';
  if (factor.startsWith('Unanswered nudges')) return `${value} unanswered ${value === '1' ? 'reminder' : 'reminders'}`;
  if (factor === 'Partial payment made') return 'has already paid part';
  return factor.toLowerCase();
}

export function templateExplanation(result: RiskResult): string {
  const notable = result.factors.filter((factor) => factor.impact !== 0 && factor.factor !== 'Base score');
  if (notable.length === 0) return `Risk ${result.score} of 100: a recent, small invoice from a client with no history of paying late.`;
  const ranked = [...notable].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, 2);
  const raising = ranked.filter((factor) => factor.impact > 0).map((factor) => plainFactor(factor.factor));
  const lowering = ranked.filter((factor) => factor.impact < 0).map((factor) => plainFactor(factor.factor));
  const parts = [
    raising.length ? `mostly because it is ${raising.join(' and ')}` : '',
    lowering.length ? `${raising.length ? 'helped by' : 'kept low because the client'} ${lowering.join(' and ')}` : '',
  ].filter(Boolean);
  return `Risk ${result.score} of 100, ${parts.join(', ')}.`;
}

/**
 * `explain: 'template'` skips the model. Bulk refreshes (seeding, moving demo time, PayPal reconciles on page
 * loads) use it so they don't spend the free-tier request budget the guided stories need (D84).
 */
export async function refreshRisk(invoiceId: string, database: AppDb = db, at = getNow(), options: { explain?: 'model' | 'template' } = {}): Promise<RiskResult> {
  const invoice = getInvoice(invoiceId, database);
  if (!invoice) throw new Error('INVOICE_NOT_FOUND');
  const result = computeRisk(riskFeaturesForInvoice(invoice, database, at));
  let explanation = invoice.riskExplanation;
  if (explanation === null || invoice.riskScore === null || Math.abs(result.score - invoice.riskScore) >= 5) {
    explanation = templateExplanation(result);
    if (getLlmEnv().mode === 'live' && options.explain !== 'template') {
      try {
        const structured = await getLLM().structured({
          system: 'Explain to a busy freelancer, in one short plain-English sentence, why this overdue invoice has this risk score out of 100 (higher means less likely to be paid). Name the one or two biggest reasons in everyday words. Use only the provided factors and do not infer extra facts. Do not use the words deterministic, factor, base score, impact or algorithm.',
          input: JSON.stringify({ score: result.score, factors: result.factors }),
          schema: explanationSchema,
          onProviderCall: (record) => auditProviderCall(record, { invoiceId, purpose: 'risk_explanation', provider: getLlmEnv().provider }, database),
        });
        explanation = explanationSchema.parse(structured).explanation;
      } catch {
        // Keep the deterministic factor-based explanation when the provider is unavailable.
      }
    }
  }
  updateInvoice(invoiceId, { riskScore: result.score, riskFactors: result.factors, riskExplanation: explanation }, database);
  return result;
}
