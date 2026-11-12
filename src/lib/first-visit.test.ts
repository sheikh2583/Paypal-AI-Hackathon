import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StartHere } from "@/components/start-here";
import { plainFactor, templateExplanation } from "./risk/service";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const base = {
  ownerFirstName: "Maya", outstandingLabel: "$5,500.00", clientCount: 5, maxDiscountPercent: 5,
  paypalMode: "sandbox" as const, showReset: true,
};

describe("first-visit guidance", () => {
  it("tells a new visitor who they are and links straight to both stories", () => {
    const markup = renderToStaticMarkup(createElement(StartHere, { ...base, dana: { state: "new", step: 0 }, priya: { state: "new" } }));
    expect(markup).toContain("You’re Maya, a freelancer owed $5,500.00 by 5 clients.");
    expect(markup).toContain('href="/invoices/invoice-dana-900"');
    expect(markup).toContain('href="/invoices/invoice-priya-600"');
    expect(markup).toContain("Start Dana’s story");
    expect(markup).toContain("more than your 5% limit");
    // Presenter tools sit behind a disclosure, not beside the main call to action.
    expect(markup).toMatch(/<details[^>]*>[\s\S]*Demo tools[\s\S]*Reset demo[\s\S]*<\/details>/);
  });

  it("shows progress and sends a finished Priya story to Approvals", () => {
    const markup = renderToStaticMarkup(createElement(StartHere, { ...base, dana: { state: "in-progress", step: 1 }, priya: { state: "done" } }));
    expect(markup).toContain("Step 2 of 3");
    expect(markup).toContain("Continue Dana’s story");
    expect(markup).toContain('href="/approvals"');
    expect(markup).toContain("Answer Priya in Approvals");
  });

  it("explains risk in plain words", () => {
    expect(plainFactor("Days overdue (23)")).toBe("23 days overdue");
    expect(plainFactor("Responsiveness (high)")).toBe("usually replies quickly");
    expect(plainFactor("Client late count (1)")).toBe("paid late 1 time before");
    const text = templateExplanation({ score: 30, factors: [
      { factor: "Base score", impact: 20 },
      { factor: "Days overdue (23)", impact: 20 },
      { factor: "Responsiveness (high)", impact: -10 },
    ] });
    expect(text).toBe("Risk 30 of 100, mostly because it is 23 days overdue, helped by usually replies quickly.");
    expect(text).not.toMatch(/deterministic|factor|base score/i);
  });
});
