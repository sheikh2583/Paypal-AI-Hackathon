// Pure policy functions — no DB, no network, no clock, no LLM.
// `now` is always passed in. Integer math throughout (hard rule 1).
// Mirrors the 8 rules in docs/04-contracts.md and the math in DECISIONS.md D8.
import type {
  Cents,
  InvoiceRow,
  Installment,
  OwnerPolicy,
  PolicyDecision,
  PolicyViolation,
  PlanProposal,
} from "../types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum remaining balance for a plan to be created (D8). */
export const MIN_PLAN_REMAINING_CENTS = 10_000;

/** MS in one day — used for date arithmetic only. */
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** remaining = amountCents − paidCents */
export function remainingCents(invoice: Pick<InvoiceRow, "amountCents" | "paidCents">): Cents {
  return invoice.amountCents - invoice.paidCents;
}

/**
 * discountedTotal = floor((remaining × (100 − discount) + 50) / 100)
 * Integer math, round half up (D8 / docs/04 rule 3).
 */
export function discountedTotal(remaining: Cents, discountPercent: number): Cents {
  return Math.floor((remaining * (100 - discountPercent) + 50) / 100);
}

/**
 * minDeposit = ceil(discountedTotal × minDepositPercent / 100)  (D8)
 */
export function minDeposit(total: Cents, minDepositPercent: number): Cents {
  return Math.ceil((total * minDepositPercent) / 100);
}

/** Returns midnight UTC for the date portion of a given ms timestamp. */
function startOfDayUtc(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** ISO date string (YYYY-MM-DD) from ms. */
function toISODate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Parses an ISO date/datetime string to ms (UTC midnight if date-only). */
function parseDate(iso: string): number {
  // Date-only strings (YYYY-MM-DD) are parsed as UTC midnight.
  return iso.length === 10 ? Date.parse(`${iso}T00:00:00.000Z`) : Date.parse(iso);
}

// ---------------------------------------------------------------------------
// evaluatePlan
// ---------------------------------------------------------------------------

/**
 * Evaluates a PlanProposal against policy. Reports ALL violations (not just the first).
 * Returns PolicyDecision with allowed=true only when violations is empty.
 */
export function evaluatePlan(
  policy: OwnerPolicy,
  invoice: InvoiceRow,
  proposal: PlanProposal,
  now: Date,
): PolicyDecision {
  const violations: PolicyViolation[] = [];
  const nowMs = now.getTime();
  const todayMs = startOfDayUtc(nowMs);

  // Rule 7a: invoice eligibility — OVERDUE + paidCents === 0
  if (invoice.status !== "OVERDUE" || invoice.paidCents !== 0) {
    violations.push({
      code: "INVOICE_NOT_ELIGIBLE",
      message: `Invoice must be OVERDUE with no partial payment. Current status: ${invoice.status}, paid: ${invoice.paidCents} cents.`,
    });
    // No point running math rules on an ineligible invoice.
    return { allowed: false, needsOwnerApproval: false, violations };
  }

  const remaining = remainingCents(invoice);

  // Rule 7b: PLAN_TOO_SMALL
  if (remaining < MIN_PLAN_REMAINING_CENTS) {
    violations.push({
      code: "PLAN_TOO_SMALL",
      message: `Remaining balance (${remaining} cents) is below the minimum plannable amount (${MIN_PLAN_REMAINING_CENTS} cents = $${MIN_PLAN_REMAINING_CENTS / 100}).`,
    });
  }

  // Rule 1: discountPercent <= maxDiscountPercent
  if (proposal.discountPercent > policy.maxDiscountPercent) {
    violations.push({
      code: "DISCOUNT_TOO_HIGH",
      message: `Proposed discount ${proposal.discountPercent}% exceeds maximum allowed ${policy.maxDiscountPercent}%.`,
    });
  }

  // Rule 2: installments.length <= maxInstallments
  if (proposal.installments.length > policy.maxInstallments) {
    violations.push({
      code: "TOO_MANY_INSTALLMENTS",
      message: `Plan has ${proposal.installments.length} installments but maximum allowed is ${policy.maxInstallments}.`,
    });
  }

  // Compute discounted total for rules 3, 5, 6.
  const total = discountedTotal(remaining, proposal.discountPercent);
  const installments = proposal.installments;

  // Rule 5a: all amounts must be positive integers
  const nonPositive = installments.filter((i) => !Number.isInteger(i.amountCents) || i.amountCents <= 0);
  if (nonPositive.length > 0) {
    violations.push({
      code: "INSTALLMENT_NOT_POSITIVE",
      message: `All installment amounts must be positive integers. Found: ${nonPositive.map((i) => `#${i.no}=${i.amountCents}`).join(", ")}.`,
    });
  }

  // Rule 5b: all due dates >= today
  const pastDue = installments.filter((i) => {
    const ms = parseDate(i.dueAt);
    return startOfDayUtc(ms) < todayMs;
  });
  if (pastDue.length > 0) {
    violations.push({
      code: "DUE_DATE_IN_PAST",
      message: `Installment due dates must be today or in the future. Past dates: ${pastDue.map((i) => `#${i.no} (${i.dueAt})`).join(", ")}.`,
    });
  }

  // Rule 4: last dueAt <= now + maxPlanDays
  if (installments.length > 0) {
    const lastInstallment = installments[installments.length - 1]!;
    const lastDueMs = parseDate(lastInstallment.dueAt);
    const maxDueMs = todayMs + policy.maxPlanDays * DAY_MS;
    if (lastDueMs > maxDueMs) {
      violations.push({
        code: "PLAN_TOO_LONG",
        message: `Last installment due date (${lastInstallment.dueAt}) exceeds the maximum of ${policy.maxPlanDays} days from today (${toISODate(maxDueMs)}).`,
      });
    }
  }

  // Rule 3: deposit >= ceil(total * minDepositPercent / 100)
  if (installments.length > 0 && nonPositive.length === 0) {
    const deposit = installments[0]!.amountCents;
    const required = minDeposit(total, policy.minDepositPercent);
    if (deposit < required) {
      violations.push({
        code: "DEPOSIT_TOO_LOW",
        message: `Deposit (${deposit} cents) is below the minimum required (${required} cents = ${policy.minDepositPercent}% of the discounted total ${total} cents).`,
      });
    }
  }

  // Rule 6: sum of installments == discountedTotal exactly
  if (nonPositive.length === 0 && installments.length > 0) {
    const sum = installments.reduce((acc, i) => acc + i.amountCents, 0);
    if (sum !== total) {
      violations.push({
        code: "TOTAL_MISMATCH",
        message: `Installments sum to ${sum} cents but discounted total is ${total} cents (discount: ${proposal.discountPercent}%, remaining: ${remaining} cents).`,
      });
    }
  }

  const allowed = violations.length === 0;
  // Rule 8: needsOwnerApproval = total >= autoApproveBelowCents (only meaningful when allowed)
  const needsOwnerApproval = allowed && total >= policy.autoApproveBelowCents;

  return { allowed, needsOwnerApproval, violations };
}

// ---------------------------------------------------------------------------
// suggestPlan
// ---------------------------------------------------------------------------

/**
 * Generates the minimum-compliant payment plan for an eligible invoice.
 * Deposit due now + 3 days; subsequent installments every 30 days, each
 * clamped to now + maxPlanDays. Count clamped to [2, maxInstallments].
 * Always produces a plan that evaluatePlan allows.
 */
export function suggestPlan(
  policy: OwnerPolicy,
  invoice: InvoiceRow,
  installments: number,
  now: Date,
): PlanProposal {
  const nowMs = now.getTime();
  const todayMs = startOfDayUtc(nowMs);
  const n = Math.max(2, Math.min(installments, policy.maxInstallments));
  const discountPercent = 0; // Default: no discount.

  const remaining = remainingCents(invoice);
  const total = discountedTotal(remaining, discountPercent);
  const deposit = minDeposit(total, policy.minDepositPercent);

  // Remaining n-1 installments split floor((total - deposit) / (n-1)),
  // rounding remainder on the LAST one (D8).
  const otherCount = n - 1;
  const otherBase = otherCount > 0 ? Math.floor((total - deposit) / otherCount) : 0;
  const lastRemainder = total - deposit - otherBase * otherCount;

  const maxDueMs = todayMs + policy.maxPlanDays * DAY_MS;

  function clampedDate(ms: number): string {
    return toISODate(Math.min(ms, maxDueMs));
  }

  const result: Installment[] = [];

  // Installment 1: deposit, due now + 3 days
  result.push({
    no: 1,
    amountCents: deposit,
    dueAt: clampedDate(todayMs + 3 * DAY_MS),
  });

  // Installments 2..n-1: otherBase each, every 30 days
  for (let k = 2; k < n; k++) {
    result.push({
      no: k,
      amountCents: otherBase,
      dueAt: clampedDate(todayMs + 3 * DAY_MS + (k - 1) * 30 * DAY_MS),
    });
  }

  // Last installment: otherBase + rounding remainder
  if (n > 1) {
    result.push({
      no: n,
      amountCents: otherBase + lastRemainder,
      dueAt: clampedDate(todayMs + 3 * DAY_MS + (n - 1) * 30 * DAY_MS),
    });
  }

  return {
    invoiceId: invoice.id,
    discountPercent,
    installments: result,
  };
}

// ---------------------------------------------------------------------------
// rebasePlan
// ---------------------------------------------------------------------------

/**
 * If the deposit (first installment) date has passed, shifts ALL due dates
 * forward by the same whole-day delta that puts the deposit on or after today.
 * Preserves inter-installment spacing. Never mutates the input.
 * Returns the same proposal object (reference equality) if no shift needed.
 */
export function rebasePlan(proposal: PlanProposal, now: Date): PlanProposal {
  if (proposal.installments.length === 0) return proposal;

  const todayMs = startOfDayUtc(now.getTime());
  const depositMs = parseDate(proposal.installments[0]!.dueAt);
  const depositDayMs = startOfDayUtc(depositMs);

  if (depositDayMs >= todayMs) {
    // No rebase needed.
    return proposal;
  }

  // Smallest whole-day shift that puts the deposit on or after today.
  const deltaDays = Math.ceil((todayMs - depositDayMs) / DAY_MS);
  const deltaMs = deltaDays * DAY_MS;

  return {
    ...proposal,
    installments: proposal.installments.map((inst) => ({
      ...inst,
      dueAt: toISODate(parseDate(inst.dueAt) + deltaMs),
    })),
  };
}
