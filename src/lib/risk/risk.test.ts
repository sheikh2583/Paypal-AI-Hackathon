import { describe, expect, it } from "vitest";
import { computeRisk, riskLabel, type RiskFeatures } from "./index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseFeatures(overrides: Partial<RiskFeatures> = {}): RiskFeatures {
  return {
    daysOverdue: 0,
    amountCents: 10000,   // $100 — below $500 band
    lateCount: 0,
    avgDaysLate: 0,
    responsiveness: "medium",
    unansweredNudges: 0,
    hasPartialPayment: false,
    ...overrides,
  };
}

/** Sum of all factor impacts must equal the unclamped score (which may differ from clamped). */
function factorSum(result: ReturnType<typeof computeRisk>): number {
  return result.factors.reduce((a, f) => a + f.impact, 0);
}

// ---------------------------------------------------------------------------
// Base score
// ---------------------------------------------------------------------------

describe("computeRisk — base score", () => {
  it("minimum inputs produce score 10 (base only)", () => {
    const r = computeRisk(baseFeatures());
    expect(r.score).toBe(10);
  });

  it("always includes base factor", () => {
    const r = computeRisk(baseFeatures());
    expect(r.factors.some((f) => f.factor === "Base score" && f.impact === 10)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Days overdue — boundary tests
// ---------------------------------------------------------------------------

describe("computeRisk — days overdue boundaries", () => {
  it("0 days → +0 overdue impact", () => {
    const r = computeRisk(baseFeatures({ daysOverdue: 0 }));
    expect(r.score).toBe(10);
  });
  it("7 days → +0 overdue impact", () => {
    const r = computeRisk(baseFeatures({ daysOverdue: 7 }));
    expect(r.score).toBe(10);
  });
  it("8 days → +10", () => {
    const r = computeRisk(baseFeatures({ daysOverdue: 8 }));
    expect(r.score).toBe(20);
  });
  it("14 days → +10", () => {
    const r = computeRisk(baseFeatures({ daysOverdue: 14 }));
    expect(r.score).toBe(20);
  });
  it("15 days → +20", () => {
    const r = computeRisk(baseFeatures({ daysOverdue: 15 }));
    expect(r.score).toBe(30);
  });
  it("30 days → +20", () => {
    const r = computeRisk(baseFeatures({ daysOverdue: 30 }));
    expect(r.score).toBe(30);
  });
  it("31 days → +30", () => {
    const r = computeRisk(baseFeatures({ daysOverdue: 31 }));
    expect(r.score).toBe(40);
  });
  it("60 days → +30", () => {
    const r = computeRisk(baseFeatures({ daysOverdue: 60 }));
    expect(r.score).toBe(40);
  });
  it("61 days → +40", () => {
    const r = computeRisk(baseFeatures({ daysOverdue: 61 }));
    expect(r.score).toBe(50);
  });
  it("200 days → +40 (still capped at 40)", () => {
    const r = computeRisk(baseFeatures({ daysOverdue: 200 }));
    expect(r.score).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Amount — boundary tests
// ---------------------------------------------------------------------------

describe("computeRisk — amount boundaries", () => {
  it("$499.99 (49999 cents) → +0", () => {
    const r = computeRisk(baseFeatures({ amountCents: 49999 }));
    expect(r.score).toBe(10);
  });
  it("$500 (50000 cents) → +5", () => {
    const r = computeRisk(baseFeatures({ amountCents: 50000 }));
    expect(r.score).toBe(15);
  });
  it("$1500 (150000 cents) → +5", () => {
    const r = computeRisk(baseFeatures({ amountCents: 150000 }));
    expect(r.score).toBe(15);
  });
  it("$1500.01 (150001 cents) → +10", () => {
    const r = computeRisk(baseFeatures({ amountCents: 150001 }));
    expect(r.score).toBe(20);
  });
  it("$10000 → +10", () => {
    const r = computeRisk(baseFeatures({ amountCents: 1000000 }));
    expect(r.score).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Late history
// ---------------------------------------------------------------------------

describe("computeRisk — late history", () => {
  it("0 late → +0", () => {
    const r = computeRisk(baseFeatures({ lateCount: 0 }));
    expect(r.score).toBe(10);
  });
  it("1 late → +5", () => {
    const r = computeRisk(baseFeatures({ lateCount: 1 }));
    expect(r.score).toBe(15);
  });
  it("4 late → +20", () => {
    const r = computeRisk(baseFeatures({ lateCount: 4 }));
    expect(r.score).toBe(30);
  });
  it("5 late → still +20 (capped at min(lateCount,4)×5)", () => {
    const r = computeRisk(baseFeatures({ lateCount: 5 }));
    expect(r.score).toBe(30);
  });
  it("100 late → still +20", () => {
    const r = computeRisk(baseFeatures({ lateCount: 100 }));
    expect(r.score).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Avg days late
// ---------------------------------------------------------------------------

describe("computeRisk — avgDaysLate", () => {
  it("avgDaysLate=14 → +0", () => {
    expect(computeRisk(baseFeatures({ avgDaysLate: 14 })).score).toBe(10);
  });
  it("avgDaysLate=14.01 → +5 (> 14)", () => {
    expect(computeRisk(baseFeatures({ avgDaysLate: 14.01 })).score).toBe(15);
  });
  it("avgDaysLate=30 → +5", () => {
    expect(computeRisk(baseFeatures({ avgDaysLate: 30 })).score).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Responsiveness
// ---------------------------------------------------------------------------

describe("computeRisk — responsiveness", () => {
  it("high → -10", () => {
    const r = computeRisk(baseFeatures({ responsiveness: "high" }));
    expect(r.score).toBe(0); // 10 - 10 = 0
  });
  it("medium → 0", () => {
    const r = computeRisk(baseFeatures({ responsiveness: "medium" }));
    expect(r.score).toBe(10);
  });
  it("low → +15", () => {
    const r = computeRisk(baseFeatures({ responsiveness: "low" }));
    expect(r.score).toBe(25);
  });
  it("high responsiveness clamps to 0 at minimum", () => {
    // score would be 10 - 10 = 0, already ≥ 0
    const r = computeRisk(baseFeatures({ responsiveness: "high" }));
    expect(r.score).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Unanswered nudges
// ---------------------------------------------------------------------------

describe("computeRisk — unanswered nudges", () => {
  it("0 nudges → +0", () => {
    expect(computeRisk(baseFeatures({ unansweredNudges: 0 })).score).toBe(10);
  });
  it("1 nudge → +5", () => {
    expect(computeRisk(baseFeatures({ unansweredNudges: 1 })).score).toBe(15);
  });
  it("2 nudges → +10", () => {
    expect(computeRisk(baseFeatures({ unansweredNudges: 2 })).score).toBe(20);
  });
  it("3 nudges → +15 (max)", () => {
    expect(computeRisk(baseFeatures({ unansweredNudges: 3 })).score).toBe(25);
  });
  it("4 nudges → still +15 (capped)", () => {
    expect(computeRisk(baseFeatures({ unansweredNudges: 4 })).score).toBe(25);
  });
  it("10 nudges → still +15 (capped)", () => {
    expect(computeRisk(baseFeatures({ unansweredNudges: 10 })).score).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// Partial payment
// ---------------------------------------------------------------------------

describe("computeRisk — partial payment", () => {
  it("no partial → 0 impact", () => {
    expect(computeRisk(baseFeatures({ hasPartialPayment: false })).score).toBe(10);
  });
  it("partial payment → -10", () => {
    expect(computeRisk(baseFeatures({ hasPartialPayment: true })).score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Score clamping
// ---------------------------------------------------------------------------

describe("computeRisk — clamping", () => {
  it("score never exceeds 100", () => {
    const r = computeRisk(baseFeatures({
      daysOverdue: 200,      // +40
      amountCents: 1000000,  // +10
      lateCount: 10,         // +20
      avgDaysLate: 30,       // +5
      responsiveness: "low", // +15
      unansweredNudges: 10,  // +15
      hasPartialPayment: false,
    }));
    // unclamped: 10+40+10+20+5+15+15 = 115 → clamped to 100
    expect(r.score).toBe(100);
  });

  it("score never goes below 0", () => {
    const r = computeRisk(baseFeatures({
      responsiveness: "high",   // -10
      hasPartialPayment: true,  // -10
    }));
    // 10 - 10 - 10 = -10 → clamped to 0
    expect(r.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Factor list invariants
// ---------------------------------------------------------------------------

describe("computeRisk — factor invariants", () => {
  it("factor impacts sum equals the unclamped score", () => {
    // Max case (unclamped 115 but factor sum should still be 115)
    const r = computeRisk(baseFeatures({
      daysOverdue: 200,
      amountCents: 1000000,
      lateCount: 10,
      avgDaysLate: 30,
      responsiveness: "low",
      unansweredNudges: 10,
    }));
    expect(factorSum(r)).toBe(115);
    expect(r.score).toBe(100); // clamped
  });

  it("factor sum = score when not clamped", () => {
    const r = computeRisk(baseFeatures());
    expect(factorSum(r)).toBe(r.score);
  });

  it("zero-impact optional factors are omitted", () => {
    const r = computeRisk(baseFeatures()); // everything at zero except base
    // Only the base factor should be present (all others are zero)
    expect(r.factors).toHaveLength(1);
    expect(r.factors[0]!.factor).toBe("Base score");
  });

  it("negative-impact factors appear in the list", () => {
    const r = computeRisk(baseFeatures({
      responsiveness: "high",
      hasPartialPayment: true,
    }));
    expect(r.factors.some((f) => f.impact < 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// riskLabel thresholds (D38)
// ---------------------------------------------------------------------------

describe("riskLabel", () => {
  it("0 → Low", () => expect(riskLabel(0)).toBe("Low"));
  it("34 → Low", () => expect(riskLabel(34)).toBe("Low"));
  it("35 → Medium", () => expect(riskLabel(35)).toBe("Medium"));
  it("64 → Medium", () => expect(riskLabel(64)).toBe("Medium"));
  it("65 → High", () => expect(riskLabel(65)).toBe("High"));
  it("100 → High", () => expect(riskLabel(100)).toBe("High"));
});

// ---------------------------------------------------------------------------
// Full integrated example
// ---------------------------------------------------------------------------

describe("computeRisk — integrated scenario", () => {
  it("Elena Martinez scenario: 23 days overdue, $2400, medium responsiveness", () => {
    // 10 + 20(15-30 days) + 10(>$1500) = 40 → Low (< 35 is Low, 40 is Medium)
    const r = computeRisk(baseFeatures({
      daysOverdue: 23,
      amountCents: 240000, // $2400
      responsiveness: "medium",
    }));
    expect(r.score).toBe(40);
    expect(riskLabel(r.score)).toBe("Medium");
  });

  it("worst case stack: 31 days, $2400, 4 late, avgDaysLate 20, low responsiveness, 3 nudges", () => {
    const r = computeRisk({
      daysOverdue: 31,       // +30
      amountCents: 240000,   // +10 (>$1500)
      lateCount: 4,          // +20
      avgDaysLate: 20,       // +5
      responsiveness: "low", // +15
      unansweredNudges: 3,   // +15
      hasPartialPayment: false,
    });
    // 10+30+10+20+5+15+15 = 105 → clamped 100
    expect(r.score).toBe(100);
    expect(riskLabel(r.score)).toBe("High");
  });
});

