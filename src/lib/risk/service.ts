import { z } from 'zod';
import { getLlmEnv } from '../env';
import { getNow } from '../clock';
import { db, type AppDb } from '../db/client';
import { getClient, getInvoice, getMessages, updateInvoice } from '../db/queries';
import { getLLM } from '../llm';
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

function templateExplanation(result: RiskResult): string {
  const notable = result.factors.filter((factor) => factor.impact !== 0 && factor.factor !== 'Base score');
  if (notable.length === 0) return `Risk score ${result.score}: the invoice is recent, under $500, and has no recorded late-payment or response concerns.`;
  const highest = [...notable].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, 2);
  const reasons = highest.map((factor) => `${factor.factor} (${factor.impact > 0 ? '+' : ''}${factor.impact})`).join(' and ');
  return `Risk score ${result.score}: the main factors are ${reasons}.`;
}

export async function refreshRisk(invoiceId: string, database: AppDb = db, at = getNow()): Promise<RiskResult> {
  const invoice = getInvoice(invoiceId, database);
  if (!invoice) throw new Error('INVOICE_NOT_FOUND');
  const result = computeRisk(riskFeaturesForInvoice(invoice, database, at));
  let explanation = invoice.riskExplanation;
  if (explanation === null || invoice.riskScore === null || Math.abs(result.score - invoice.riskScore) >= 5) {
    explanation = templateExplanation(result);
    if (getLlmEnv().mode === 'live') {
      try {
        const structured = await getLLM().structured({
          system: 'Write a concise one or two sentence explanation of a deterministic invoice risk score. Use only the provided risk factors and do not infer extra facts.',
          input: JSON.stringify({ score: result.score, factors: result.factors }),
          schema: explanationSchema,
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
