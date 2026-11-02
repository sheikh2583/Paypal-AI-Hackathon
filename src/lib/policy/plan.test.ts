import { describe, expect, it } from "vitest";
import type { InvoiceRow, OwnerPolicy, PlanProposal } from "../types";
import {
  MIN_PLAN_REMAINING_CENTS,
  discountedTotal,
  evaluatePlan,
  minDeposit,
  rebasePlan,
  remainingCents,
  suggestPlan,
} from "./plan";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date("2026-11-03T00:00:00.000Z");
const TODAY = "2026-11-03";

function makePolicy(overrides: Partial<OwnerPolicy> = {}): OwnerPolicy {
  return {
    minDepositPercent: 25,
    maxInstallments: 4,
    maxPlanDays: 90,
    maxDiscountPercent: 10,
    autoApproveBelowCents: 100_000, // $1,000
    tone: "friendly",
    businessName: "Acme",
    ownerName: "Dana",
    ...overrides,
  };
}

function makeInvoice(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: "inv-1",
    paypalInvoiceId: null,
    paypalInvoiceUrl: null,
    clientId: "cli-1",
    number: "CH-001",
    description: "Services",
    amountCents: 200_000, // $2,000
    paidCents: 0,
    currency: "USD",
    issuedAt: "2026-10-01T00:00:00.000Z",
    dueAt: "2026-10-11T00:00:00.000Z",
    status: "OVERDUE",
    parentInvoiceId: null,
    planId: null,
    installmentNo: null,
    chaseState: "NEW",
    riskScore: null,
    riskFactors: [],
    riskExplanation: null,
    lastAgentRunAt: null,
    nextFollowupAt: null,
    ...overrides,
  };
}

/** Build a minimal 2-installment proposal from raw numbers. */
function makeProposal(
  invoiceId: string,
  discountPercent: number,
  inst: { no: number; amountCents: number; dueAt: string }[],
): PlanProposal {
  return { invoiceId, discountPercent, installments: inst };
}

// ---------------------------------------------------------------------------
// remainingCents
// ---------------------------------------------------------------------------

describe("remainingCents", () => {
  it("returns amountCents when paidCents=0", () =>
    expect(remainingCents({ amountCents: 50000, paidCents: 0 })).toBe(50000));
  it("subtracts partial payment", () =>
    expect(remainingCents({ amountCents: 50000, paidCents: 10000 })).toBe(40000));
});

// ---------------------------------------------------------------------------
// discountedTotal math
// ---------------------------------------------------------------------------

describe("discountedTotal", () => {
  it("0% discount: floor((remaining*100+50)/100) = remaining", () =>
    expect(discountedTotal(200_000, 0)).toBe(200_000));
  it("10% discount of $2000 = $1800", () =>
    expect(discountedTotal(200_000, 10)).toBe(180_000));
  it("rounding: $100.01 at 0% → 10001", () =>
    expect(discountedTotal(10001, 0)).toBe(10001));
  it("rounding half-up: 101 × 0% → 101", () =>
    expect(discountedTotal(101, 0)).toBe(101));
  // floor((101*(100-5)+50)/100) = floor((9595+50)/100) = floor(96.45) = 96
  it("5% of 101: floor((101*95+50)/100) = floor(9645/100) = 96", () =>
    expect(discountedTotal(101, 5)).toBe(96));
  // floor((300*(100-33)+50)/100) = floor((300*67+50)/100) = floor(20150/100) = 201
  it("33% of 300 cents rounds correctly", () =>
    expect(discountedTotal(300, 33)).toBe(201));
});

// ---------------------------------------------------------------------------
// minDeposit math
// ---------------------------------------------------------------------------

describe("minDeposit", () => {
  it("25% of 10000 = 2500", () => expect(minDeposit(10000, 25)).toBe(2500));
  it("ceil(25% of 10001) = 2501", () => expect(minDeposit(10001, 25)).toBe(2501));
  it("0% deposit = 0", () => expect(minDeposit(10000, 0)).toBe(0));
  it("100% deposit = total", () => expect(minDeposit(10000, 100)).toBe(10000));
  // ceil(10000 * 25 / 100) = ceil(2500) = 2500
  it("exact: ceil(10001*25/100) = ceil(2500.25) = 2501", () =>
    expect(minDeposit(10001, 25)).toBe(2501));
});

// ---------------------------------------------------------------------------
// evaluatePlan — eligibility (rule 7)
// ---------------------------------------------------------------------------

describe("evaluatePlan — invoice eligibility", () => {
  const policy = makePolicy();
  const baseProposal = makeProposal("inv-1", 0, [
    { no: 1, amountCents: 50000, dueAt: "2026-11-06" },
    { no: 2, amountCents: 150000, dueAt: "2026-11-20" },
  ]);

  for (const status of ["SENT", "PARTIALLY_PAID", "PAID", "CANCELLED", "SUPERSEDED"] as const) {
    it(`rejects status=${status}`, () => {
      const inv = makeInvoice({ status });
      const decision = evaluatePlan(policy, inv, baseProposal, NOW);
      expect(decision.allowed).toBe(false);
      expect(decision.violations.some((v) => v.code === "INVOICE_NOT_ELIGIBLE")).toBe(true);
    });
  }

  it("rejects OVERDUE with paidCents > 0", () => {
    const inv = makeInvoice({ status: "OVERDUE", paidCents: 1 });
    const decision = evaluatePlan(policy, inv, baseProposal, NOW);
    expect(decision.allowed).toBe(false);
    expect(decision.violations[0]!.code).toBe("INVOICE_NOT_ELIGIBLE");
  });

  it("accepts OVERDUE with paidCents=0", () => {
    const inv = makeInvoice();
    // Need a valid proposal for the $2000 invoice: 25% deposit = 50000, then 150000
    const decision = evaluatePlan(policy, inv, baseProposal, NOW);
    expect(decision.violations.some((v) => v.code === "INVOICE_NOT_ELIGIBLE")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evaluatePlan — PLAN_TOO_SMALL (rule 7b)
// ---------------------------------------------------------------------------

describe("evaluatePlan — PLAN_TOO_SMALL", () => {
  const policy = makePolicy({ minDepositPercent: 50 });

  it("exactly MIN is rejected (9999 cents)", () => {
    const inv = makeInvoice({ amountCents: 9999, paidCents: 0 });
    const proposal = makeProposal("inv-1", 0, [
      { no: 1, amountCents: 5000, dueAt: "2026-11-06" },
      { no: 2, amountCents: 4999, dueAt: "2026-11-20" },
    ]);
    const d = evaluatePlan(policy, inv, proposal, NOW);
    expect(d.allowed).toBe(false);
    expect(d.violations.some((v) => v.code === "PLAN_TOO_SMALL")).toBe(true);
  });

  it("exactly MIN_PLAN_REMAINING_CENTS (10000) is NOT too small", () => {
    const inv = makeInvoice({ amountCents: 10000, paidCents: 0 });
    // 50% deposit = 5000, remainder = 5000
    const proposal = makeProposal("inv-1", 0, [
      { no: 1, amountCents: 5000, dueAt: "2026-11-06" },
      { no: 2, amountCents: 5000, dueAt: "2026-11-20" },
    ]);
    const d = evaluatePlan(policy, inv, proposal, NOW);
    expect(d.violations.some((v) => v.code === "PLAN_TOO_SMALL")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evaluatePlan — rule 1: discount cap
// ---------------------------------------------------------------------------

describe("evaluatePlan — discount cap (rule 1)", () => {
  const policy = makePolicy({ maxDiscountPercent: 10 });

  it("exactly at max discount is allowed", () => {
    const inv = makeInvoice(); // $2000
    // 10% discount: total = 180000; 25% deposit = 45000; remainder = 135000
    const proposal = makeProposal("inv-1", 10, [
      { no: 1, amountCents: 45000, dueAt: "2026-11-06" },
      { no: 2, amountCents: 135000, dueAt: "2026-11-20" },
    ]);
    const d = evaluatePlan(policy, inv, proposal, NOW);
    expect(d.violations.some((v) => v.code === "DISCOUNT_TOO_HIGH")).toBe(false);
  });

  it("one percent over max discount is denied", () => {
    const inv = makeInvoice();
    const proposal = makeProposal("inv-1", 11, [
      { no: 1, amountCents: 50000, dueAt: "2026-11-06" },
      { no: 2, amountCents: 129000, dueAt: "2026-11-20" },
    ]);
    const d = evaluatePlan(policy, inv, proposal, NOW);
    expect(d.violations.some((v) => v.code === "DISCOUNT_TOO_HIGH")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluatePlan — rule 2: max installments
// ---------------------------------------------------------------------------

describe("evaluatePlan — max installments (rule 2)", () => {
  const policy = makePolicy({ maxInstallments: 3, minDepositPercent: 25 });

  it("exactly 3 installments is allowed", () => {
    const inv = makeInvoice(); // $2000, total=200000; deposit=50000
    const proposal = makeProposal("inv-1", 0, [
      { no: 1, amountCents: 50000, dueAt: "2026-11-06" },
      { no: 2, amountCents: 75000, dueAt: "2026-12-06" },
      { no: 3, amountCents: 75000, dueAt: "2027-01-05" },
    ]);
    const d = evaluatePlan(policy, inv, proposal, NOW);
    expect(d.violations.some((v) => v.code === "TOO_MANY_INSTALLMENTS")).toBe(false);
  });

  it("4 installments when max is 3 is denied", () => {
    const inv = makeInvoice();
    const proposal = makeProposal("inv-1", 0, [
      { no: 1, amountCents: 50000, dueAt: "2026-11-06" },
      { no: 2, amountCents: 50000, dueAt: "2026-12-06" },
      { no: 3, amountCents: 50000, dueAt: "2027-01-05" },
      { no: 4, amountCents: 50000, dueAt: "2027-02-04" },
    ]);
    const d = evaluatePlan(policy, inv, proposal, NOW);
    expect(d.violations.some((v) => v.code === "TOO_MANY_INSTALLMENTS")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluatePlan — rule 3: deposit too low
// ---------------------------------------------------------------------------

describe("evaluatePlan — deposit too low (rule 3)", () => {
  const policy = makePolicy({ minDepositPercent: 25 }); // $2000 → total=200000 → minDeposit=50000

  it("deposit exactly at minimum is allowed", () => {
    const inv = makeInvoice();
    const proposal = makeProposal("inv-1", 0, [
      { no: 1, amountCents: 50000, dueAt: "2026-11-06" },
      { no: 2, amountCents: 150000, dueAt: "2026-12-06" },
    ]);
    const d = evaluatePlan(policy, inv, proposal, NOW);
    expect(d.violations.some((v) => v.code === "DEPOSIT_TOO_LOW")).toBe(false);
  });

  it("deposit one cent below minimum is denied", () => {
    const inv = makeInvoice();
    const proposal = makeProposal("inv-1", 0, [
      { no: 1, amountCents: 49999, dueAt: "2026-11-06" },
      { no: 2, amountCents: 150001, dueAt: "2026-12-06" },
    ]);
    const d = evaluatePlan(policy, inv, proposal, NOW);
    expect(d.violations.some((v) => v.code === "DEPOSIT_TOO_LOW")).toBe(true);
  });

  it("deposit computed AFTER discount: 10% off $2000 → total=$1800 → minDeposit=$450", () => {
    const inv = makeInvoice(); // $2000
    // total = floor((200000*90+50)/100) = floor(18000050/100) = 180000
    // minDeposit = ceil(180000*25/100) = ceil(45000) = 45000
    const proposal = makeProposal("inv-1", 10, [
      { no: 1, amountCents: 45000, dueAt: "2026-11-06" },
      { no: 2, amountCents: 135000, dueAt: "2026-12-06" },
    ]);
    const d = evaluatePlan(policy, inv, proposal, NOW);
    expect(d.violations.some((v) => v.code === "DEPOSIT_TOO_LOW")).toBe(false);
  });

  it("deposit one cent below discounted minimum is denied", () => {
    const inv = makeInvoice();
    const proposal = makeProposal("inv-1", 10, [
      { no: 1, amountCents: 44999, dueAt: "2026-11-06" },
      { no: 2, amountCents: 135001, dueAt: "2026-12-06" },
    ]);
    const d = evaluatePlan(policy, inv, proposal, NOW);
    expect(d.violations.some((v) => v.code === "DEPOSIT_TOO_LOW")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluatePlan — rule 4: plan too long
// ---------------------------------------------------------------------------

describe("evaluatePlan — plan too long (rule 4)", () => {
  const policy = makePolicy({ maxPlanDays: 90 });
  // Today = 2026-11-03; deadline = 2027-02-01 (90 days later)
  const deadline = "2027-02-01";
  const oneDayOver = "2027-02-02";

  it("last installment exactly at deadline is allowed", () => {
    const inv = makeInvoice();
    const proposal = makeProposal("inv-1", 0, [
      { no: 1, amountCents: 50000, dueAt: "2026-11-06" },
      { no: 2, amountCents: 150000, dueAt: deadline },
    ]);
    const d = evaluatePlan(policy, inv, proposal, NOW);
    expect(d.violations.some((v) => v.code === "PLAN_TOO_LONG")).toBe(false);
  });

  it("last installment one day over deadline is denied", () => {
    const inv = makeInvoice();
    const proposal = makeProposal("inv-1", 0, [
      { no: 1, amountCents: 50000, dueAt: "2026-11-06" },
      { no: 2, amountCents: 150000, dueAt: oneDayOver },
    ]);
    const d = evaluatePlan(policy, inv, proposal, NOW);
    expect(d.violations.some((v) => v.code === "PLAN_TOO_LONG")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluatePlan — rule 5a: non-positive installments
// ---------------------------------------------------------------------------

describe("evaluatePlan — non-positive amounts (rule 5a)", () => {
  const policy = makePolicy();

  it("zero amount fails INSTALLMENT_NOT_POSITIVE", () => {
    const inv = makeInvoice();
    const proposal = makeProposal("inv-1", 0, [
      { no: 1, amountCents: 0, dueAt: "2026-11-06" },
      { no: 2, amountCents: 200000, dueAt: "2026-12-06" },
    ]);
    const d = evaluatePlan(policy, inv, proposal, NOW);
    expect(d.violations.some((v) => v.code === "INSTALLMENT_NOT_POSITIVE")).toBe(true);
  });

  it("negative amount fails INSTALLMENT_NOT_POSITIVE", () => {
    const inv = makeInvoice();
    const proposal = makeProposal("inv-1", 0, [
      { no: 1, amountCents: -100, dueAt: "2026-11-06" },
      { no: 2, amountCents: 200100, dueAt: "2026-12-06" },
    ]);
    const d = evaluatePlan(policy, inv, proposal, NOW);
    expect(d.violations.some((v) => v.code === "INSTALLMENT_NOT_POSITIVE")).toBe(true);
  });

  it("non-integer amount fails INSTALLMENT_NOT_POSITIVE", () => {
    const inv = makeInvoice();
    const proposal = makeProposal("inv-1", 0, [
      { no: 1, amountCents: 50000.5, dueAt: "2026-11-06" },
      { no: 2, amountCents: 149999.5, dueAt: "2026-12-06" },
    ]);
    const d = evaluatePlan(policy, inv, proposal, NOW);
    expect(d.violations.some((v) => v.code === "INSTALLMENT_NOT_POSITIVE")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluatePlan — rule 5b: past due dates
// ---------------------------------------------------------------------------

describe("evaluatePlan — past due dates (rule 5b)", () => {
  const policy = makePolicy();

  it("due date equal to today is allowed", () => {
    const inv = makeInvoice();
    const proposal = makeProposal("inv-1", 0, [
      { no: 1, amountCents: 50000, dueAt: TODAY },
      { no: 2, amountCents: 150000, dueAt: "2026-12-06" },
    ]);
    const d = evaluatePlan(policy, inv, proposal, NOW);
    expect(d.violations.some((v) => v.code === "DUE_DATE_IN_PAST")).toBe(false);
  });

  it("due date yesterday fails DUE_DATE_IN_PAST", () => {
    const inv = makeInvoice();
    const proposal = makeProposal("inv-1", 0, [
      { no: 1, amountCents: 50000, dueAt: "2026-11-02" },
      { no: 2, amountCents: 150000, dueAt: "2026-12-06" },
    ]);
    const d = evaluatePlan(policy, inv, proposal, NOW);
    expect(d.violations.some((v) => v.code === "DUE_DATE_IN_PAST")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluatePlan — rule 6: total mismatch
// ---------------------------------------------------------------------------

describe("evaluatePlan — total mismatch (rule 6)", () => {
  const policy = makePolicy();

  it("sum exactly matches discounted total — allowed", () => {
    const inv = makeInvoice();
    const proposal = makeProposal("inv-1", 0, [
      { no: 1, amountCents: 50000, dueAt: "2026-11-06" },
      { no: 2, amountCents: 150000, dueAt: "2026-12-06" },
    ]);
    const d = evaluatePlan(policy, inv, proposal, NOW);
    expect(d.violations.some((v) => v.code === "TOTAL_MISMATCH")).toBe(false);
  });

  it("sum one cent short fails TOTAL_MISMATCH", () => {
    const inv = makeInvoice();
    const proposal = makeProposal("inv-1", 0, [
      { no: 1, amountCents: 50000, dueAt: "2026-11-06" },
      { no: 2, amountCents: 149999, dueAt: "2026-12-06" },
    ]);
    const d = evaluatePlan(policy, inv, proposal, NOW);
    expect(d.violations.some((v) => v.code === "TOTAL_MISMATCH")).toBe(true);
  });

  it("sum one cent over fails TOTAL_MISMATCH", () => {
    const inv = makeInvoice();
    const proposal = makeProposal("inv-1", 0, [
      { no: 1, amountCents: 50000, dueAt: "2026-11-06" },
      { no: 2, amountCents: 150001, dueAt: "2026-12-06" },
    ]);
    const d = evaluatePlan(policy, inv, proposal, NOW);
    expect(d.violations.some((v) => v.code === "TOTAL_MISMATCH")).toBe(true);
  });

  // Odd-cent rounding: $100.01 over 3 installments (no discount)
  // total = 10001; deposit = ceil(10001*25/100) = ceil(2500.25) = 2501
  // otherBase = floor((10001-2501)/2) = floor(7500/2) = 3750
  // last = 10001 - 2501 - 3750 = 3750; sum = 2501+3750+3750 = 10001 ✓
  it("$100.01 over 3 installments — odd-cent split", () => {
    const inv = makeInvoice({ amountCents: 10001 });
    const proposal = makeProposal("inv-1", 0, [
      { no: 1, amountCents: 2501, dueAt: "2026-11-06" },
      { no: 2, amountCents: 3750, dueAt: "2026-12-06" },
      { no: 3, amountCents: 3750, dueAt: "2027-01-05" },
    ]);
    const d = evaluatePlan(policy, inv, proposal, NOW);
    expect(d.allowed).toBe(true);
    expect(d.violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// evaluatePlan — rule 8: needsOwnerApproval
// ---------------------------------------------------------------------------

describe("evaluatePlan — needsOwnerApproval (rule 8)", () => {
  // autoApproveBelowCents = 100_000 ($1000)
  const policy = makePolicy({ autoApproveBelowCents: 100_000 });

  it("total exactly at threshold needs approval", () => {
    // invoice = $1000 exactly; total = 100000 >= 100000 → needs approval
    const inv = makeInvoice({ amountCents: 100_000 });
    const proposal = makeProposal("inv-1", 0, [
      { no: 1, amountCents: 25000, dueAt: "2026-11-06" },
      { no: 2, amountCents: 75000, dueAt: "2026-12-06" },
    ]);
    const d = evaluatePlan(policy, inv, proposal, NOW);
    expect(d.allowed).toBe(true);
    expect(d.needsOwnerApproval).toBe(true);
  });

  it("total one cent below threshold does NOT need approval", () => {
    const inv = makeInvoice({ amountCents: 99_999 });
    // total = 99999; minDeposit = ceil(99999*25/100) = ceil(24999.75) = 25000
    const proposal = makeProposal("inv-1", 0, [
      { no: 1, amountCents: 25000, dueAt: "2026-11-06" },
      { no: 2, amountCents: 74999, dueAt: "2026-12-06" },
    ]);
    const d = evaluatePlan(policy, inv, proposal, NOW);
    expect(d.allowed).toBe(true);
    expect(d.needsOwnerApproval).toBe(false);
  });

  it("needsOwnerApproval is false when there are violations", () => {
    const inv = makeInvoice({ amountCents: 200_000 });
    const proposal = makeProposal("inv-1", 99, [
      // Violates discount too high
      { no: 1, amountCents: 500, dueAt: "2026-11-06" },
      { no: 2, amountCents: 1500, dueAt: "2026-12-06" },
    ]);
    const d = evaluatePlan(policy, inv, proposal, NOW);
    expect(d.allowed).toBe(false);
    expect(d.needsOwnerApproval).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evaluatePlan — multiple simultaneous violations
// ---------------------------------------------------------------------------

describe("evaluatePlan — multiple simultaneous violations", () => {
  it("reports all violations at once", () => {
    const policy = makePolicy({ maxDiscountPercent: 5, maxInstallments: 2, maxPlanDays: 30 });
    const inv = makeInvoice(); // $2000
    const proposal = makeProposal("inv-1", 10, [
      // discount too high (10 > 5)
      { no: 1, amountCents: 10000, dueAt: "2026-10-01" }, // past due
      { no: 2, amountCents: 10000, dueAt: "2027-06-01" }, // too long
      { no: 3, amountCents: 160000, dueAt: "2027-07-01" }, // too many installments
    ]);
    const d = evaluatePlan(policy, inv, proposal, NOW);
    expect(d.allowed).toBe(false);
    const codes = d.violations.map((v) => v.code);
    expect(codes).toContain("DISCOUNT_TOO_HIGH");
    expect(codes).toContain("TOO_MANY_INSTALLMENTS");
    expect(codes).toContain("DUE_DATE_IN_PAST");
    expect(codes).toContain("PLAN_TOO_LONG");
    // deposit is also low (10000 < 25% of discounted total)
    expect(codes).toContain("DEPOSIT_TOO_LOW");
  });
});

// ---------------------------------------------------------------------------
// suggestPlan
// ---------------------------------------------------------------------------

describe("suggestPlan", () => {
  const policy = makePolicy();
  const inv = makeInvoice(); // $2000, total=200000

  it("produces 2 installments by default when count=2", () => {
    const plan = suggestPlan(policy, inv, 2, NOW);
    expect(plan.installments).toHaveLength(2);
  });

  it("clamps count below 2 to 2", () => {
    const plan = suggestPlan(policy, inv, 1, NOW);
    expect(plan.installments).toHaveLength(2);
  });

  it("clamps count above maxInstallments to maxInstallments", () => {
    const plan = suggestPlan(policy, inv, 99, NOW);
    expect(plan.installments.length).toBe(policy.maxInstallments);
  });

  it("first installment (deposit) is exactly minDeposit", () => {
    const plan = suggestPlan(policy, inv, 2, NOW);
    const remaining = remainingCents(inv);
    const total = discountedTotal(remaining, 0);
    const expectedDeposit = minDeposit(total, policy.minDepositPercent);
    expect(plan.installments[0]!.amountCents).toBe(expectedDeposit);
  });

  it("installments sum exactly to discountedTotal", () => {
    const plan = suggestPlan(policy, inv, 4, NOW);
    const total = discountedTotal(remainingCents(inv), 0);
    const sum = plan.installments.reduce((a, i) => a + i.amountCents, 0);
    expect(sum).toBe(total);
  });

  it("deposit due in 3 days", () => {
    const plan = suggestPlan(policy, inv, 2, NOW);
    expect(plan.installments[0]!.dueAt).toBe("2026-11-06");
  });

  it("second installment due 33 days from now (3+30)", () => {
    const plan = suggestPlan(policy, inv, 2, NOW);
    expect(plan.installments[1]!.dueAt).toBe("2026-12-06");
  });

  it("dates clamped to maxPlanDays when span is too large", () => {
    const shortPolicy = makePolicy({ maxPlanDays: 5 });
    const plan = suggestPlan(shortPolicy, inv, 4, NOW);
    // All dates must be <= today + 5 days = 2026-11-08
    for (const inst of plan.installments) {
      expect(inst.dueAt <= "2026-11-08").toBe(true);
    }
  });

  it("all amounts are positive integers", () => {
    for (const count of [2, 3, 4]) {
      const plan = suggestPlan(policy, inv, count, NOW);
      for (const inst of plan.installments) {
        expect(Number.isInteger(inst.amountCents)).toBe(true);
        expect(inst.amountCents).toBeGreaterThan(0);
      }
    }
  });

  it("discount defaults to 0", () => {
    const plan = suggestPlan(policy, inv, 2, NOW);
    expect(plan.discountPercent).toBe(0);
  });

  it("output passes evaluatePlan with no violations", () => {
    for (const count of [2, 3, 4]) {
      const plan = suggestPlan(policy, inv, count, NOW);
      const d = evaluatePlan(policy, inv, plan, NOW);
      expect(d.allowed).toBe(true);
      expect(d.violations).toHaveLength(0);
    }
  });

  it("odd-cent rounding: $100.01 → installments[last] absorbs remainder", () => {
    const smallInv = makeInvoice({ amountCents: 10001 });
    const plan = suggestPlan(policy, smallInv, 3, NOW);
    const total = discountedTotal(10001, 0);
    const sum = plan.installments.reduce((a, i) => a + i.amountCents, 0);
    expect(sum).toBe(total);
    // All positive integers
    for (const inst of plan.installments) {
      expect(Number.isInteger(inst.amountCents)).toBe(true);
      expect(inst.amountCents).toBeGreaterThan(0);
    }
  });

  it("installment .no values are sequential 1..n", () => {
    const plan = suggestPlan(policy, inv, 4, NOW);
    plan.installments.forEach((inst, idx) => {
      expect(inst.no).toBe(idx + 1);
    });
  });
});

// ---------------------------------------------------------------------------
// rebasePlan
// ---------------------------------------------------------------------------

describe("rebasePlan", () => {
  const baseProposal: PlanProposal = {
    invoiceId: "inv-1",
    discountPercent: 0,
    installments: [
      { no: 1, amountCents: 50000, dueAt: "2026-11-06" },
      { no: 2, amountCents: 150000, dueAt: "2026-12-06" },
    ],
  };

  it("returns same object when deposit is in the future", () => {
    const result = rebasePlan(baseProposal, NOW);
    expect(result).toBe(baseProposal); // reference equality
  });

  it("returns same object when deposit is today", () => {
    const proposal = {
      ...baseProposal,
      installments: [
        { no: 1, amountCents: 50000, dueAt: TODAY },
        { no: 2, amountCents: 150000, dueAt: "2026-12-03" },
      ],
    };
    const result = rebasePlan(proposal, NOW);
    expect(result).toBe(proposal);
  });

  it("shifts by 1 day when deposit is yesterday", () => {
    const proposal = {
      ...baseProposal,
      installments: [
        { no: 1, amountCents: 50000, dueAt: "2026-11-02" },
        { no: 2, amountCents: 150000, dueAt: "2026-12-02" },
      ],
    };
    const result = rebasePlan(proposal, NOW);
    expect(result.installments[0]!.dueAt).toBe("2026-11-03"); // shifted +1
    expect(result.installments[1]!.dueAt).toBe("2026-12-03"); // also shifted +1
  });

  it("shifts by many days preserving spacing", () => {
    const proposal = {
      ...baseProposal,
      installments: [
        { no: 1, amountCents: 50000, dueAt: "2026-10-01" }, // 33 days ago
        { no: 2, amountCents: 75000, dueAt: "2026-10-31" }, // 30 days later
        { no: 3, amountCents: 75000, dueAt: "2026-11-30" }, // 30 days later
      ],
    };
    const result = rebasePlan(proposal, NOW);
    // Deposit must be >= today (2026-11-03). days since 2026-10-01 = 33 → shift 33
    expect(result.installments[0]!.dueAt).toBe("2026-11-03");
    expect(result.installments[1]!.dueAt).toBe("2026-12-03");
    expect(result.installments[2]!.dueAt).toBe("2027-01-02");
  });

  it("does not mutate the input proposal", () => {
    const proposal = {
      ...baseProposal,
      installments: [
        { no: 1, amountCents: 50000, dueAt: "2026-10-01" },
        { no: 2, amountCents: 150000, dueAt: "2026-10-31" },
      ],
    };
    const originalDates = proposal.installments.map((i) => i.dueAt);
    rebasePlan(proposal, NOW);
    expect(proposal.installments.map((i) => i.dueAt)).toEqual(originalDates);
  });

  it("returns same object when installments is empty", () => {
    const empty: PlanProposal = { invoiceId: "x", discountPercent: 0, installments: [] };
    expect(rebasePlan(empty, NOW)).toBe(empty);
  });
});

// ---------------------------------------------------------------------------
// Property-style test: suggestPlan always produces a valid plan
// ---------------------------------------------------------------------------

/** Minimal seeded pseudo-random (no new dependency). */
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

describe("property: suggestPlan always evaluates allowed", () => {
  const rand = mulberry32(0xdeadbeef);

  // Generate 50 random (policy, invoice) combinations and verify
  const TRIALS = 50;

  it(`passes ${TRIALS} random trials`, () => {
    for (let i = 0; i < TRIALS; i++) {
      // Random policy
      const policy = makePolicy({
        minDepositPercent: Math.floor(rand() * 50) + 10, // 10-59
        maxInstallments: Math.floor(rand() * 3) + 2,     // 2-4
        maxPlanDays: Math.floor(rand() * 120) + 60,      // 60-179
        maxDiscountPercent: 0,
        autoApproveBelowCents: 999_999_999,
      });

      // Random eligible invoice (remaining >= MIN)
      const amountCents = Math.floor(rand() * 500_000) + MIN_PLAN_REMAINING_CENTS;
      const inv = makeInvoice({ amountCents, paidCents: 0, status: "OVERDUE" });

      // Random installment count
      const count = Math.floor(rand() * policy.maxInstallments) + 2;

      const plan = suggestPlan(policy, inv, count, NOW);
      const decision = evaluatePlan(policy, inv, plan, NOW);

      // Must be allowed
      expect(decision.allowed, `Trial ${i}: ${JSON.stringify(decision.violations)}`).toBe(true);
      expect(decision.violations).toHaveLength(0);

      // Sum must match discounted total exactly
      const total = discountedTotal(remainingCents(inv), 0);
      const sum = plan.installments.reduce((a, inst) => a + inst.amountCents, 0);
      expect(sum, `Trial ${i}: sum mismatch`).toBe(total);

      // All amounts positive integers
      for (const inst of plan.installments) {
        expect(Number.isInteger(inst.amountCents), `Trial ${i}: non-integer`).toBe(true);
        expect(inst.amountCents, `Trial ${i}: non-positive`).toBeGreaterThan(0);
      }
    }
  });
});
