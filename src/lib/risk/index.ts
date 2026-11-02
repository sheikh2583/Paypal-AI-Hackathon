// Pure risk-scoring module — no DB, no network, no LLM, no clock.
// computeRisk(features) -> RiskResult per the table in the prompt.
// Thresholds documented in DECISIONS.md D38.
import type { RiskResult } from "../types";

// ---------------------------------------------------------------------------
// Feature bag (all values passed in — no side effects)
// ---------------------------------------------------------------------------

export interface RiskFeatures {
  daysOverdue: number;
  amountCents: number;        // integer cents
  lateCount: number;
  avgDaysLate: number;
  responsiveness: "high" | "medium" | "low";
  unansweredNudges: number;
  hasPartialPayment: boolean;
}

// ---------------------------------------------------------------------------
// computeRisk
// ---------------------------------------------------------------------------

/**
 * Computes a risk score (0–100, higher = riskier) and a list of factor
 * contributions. The sum of factor impacts equals the unclamped score.
 * Zero-impact factors are omitted except the always-present base.
 */
export function computeRisk(features: RiskFeatures): RiskResult {
  const factors: { factor: string; impact: number }[] = [];

  // Base score (always included)
  const base = 10;
  factors.push({ factor: "Base score", impact: base });

  // Days overdue
  let overdueImpact = 0;
  if (features.daysOverdue <= 7) overdueImpact = 0;
  else if (features.daysOverdue <= 14) overdueImpact = 10;
  else if (features.daysOverdue <= 30) overdueImpact = 20;
  else if (features.daysOverdue <= 60) overdueImpact = 30;
  else overdueImpact = 40;
  if (overdueImpact !== 0) {
    factors.push({ factor: `Days overdue (${features.daysOverdue})`, impact: overdueImpact });
  }

  // Amount
  let amountImpact = 0;
  const amountDollars = features.amountCents / 100;
  if (amountDollars < 500) amountImpact = 0;
  else if (amountDollars <= 1500) amountImpact = 5;
  else amountImpact = 10;
  if (amountImpact !== 0) {
    factors.push({ factor: `Invoice amount ($${amountDollars.toFixed(2)})`, impact: amountImpact });
  }

  // Client late history: +5 × min(lateCount, 4)
  const lateHistoryImpact = 5 * Math.min(features.lateCount, 4);
  if (lateHistoryImpact !== 0) {
    factors.push({ factor: `Client late count (${features.lateCount})`, impact: lateHistoryImpact });
  }

  // Avg days late: +5 if > 14
  const avgLateImpact = features.avgDaysLate > 14 ? 5 : 0;
  if (avgLateImpact !== 0) {
    factors.push({ factor: `Avg days late (${features.avgDaysLate})`, impact: avgLateImpact });
  }

  // Responsiveness: high -10, medium 0, low +15
  const responsivenessImpact =
    features.responsiveness === "high" ? -10 :
    features.responsiveness === "low" ? 15 : 0;
  if (responsivenessImpact !== 0) {
    factors.push({ factor: `Responsiveness (${features.responsiveness})`, impact: responsivenessImpact });
  }

  // Unanswered nudges: +5 each, max +15
  const nudgesImpact = Math.min(features.unansweredNudges * 5, 15);
  if (nudgesImpact !== 0) {
    factors.push({ factor: `Unanswered nudges (${features.unansweredNudges})`, impact: nudgesImpact });
  }

  // Partial payment: -10
  const partialPaymentImpact = features.hasPartialPayment ? -10 : 0;
  if (partialPaymentImpact !== 0) {
    factors.push({ factor: "Partial payment made", impact: partialPaymentImpact });
  }

  // Unclamped sum (factors must sum to this)
  const unclamped = factors.reduce((acc, f) => acc + f.impact, 0);

  // Clamp to 0–100
  const score = Math.max(0, Math.min(100, unclamped));

  return { score, factors };
}

// ---------------------------------------------------------------------------
// riskLabel — thresholds documented in DECISIONS.md D38
// ---------------------------------------------------------------------------

/**
 * Maps a risk score to a human-readable label.
 * Thresholds: < 35 → Low, 35–64 → Medium, ≥ 65 → High (D38).
 */
export function riskLabel(score: number): "Low" | "Medium" | "High" {
  if (score < 35) return "Low";
  if (score < 65) return "Medium";
  return "High";
}
