import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClientReliabilityView, ReliabilityBadge } from "@/components/client-reliability";
import { computeReliability } from "./reliability";

describe("client reliability components", () => {
  it("renders the page empty state and the account disclosure", () => {
    const markup = renderToStaticMarkup(createElement(ClientReliabilityView, { results: [], publicDemo: true }));
    expect(markup).toContain("No clients yet");
    expect(markup).toContain("The public demo shows fictional clients.");
    expect(markup).toContain("This score never changes the limits the agent must follow.");
  });

  it("renders the invoice badge with its grade, rank and link, or a missing-data label", () => {
    const [result] = computeReliability([{ id: "a", name: "Avery" }], [{
      id: "invoice-a", clientId: "a", dueAt: "2026-11-05", status: "PAID", amountCents: 100, paidCents: 100,
    }], [], [], new Date("2026-11-11T00:00:00Z"));
    const badge = renderToStaticMarkup(createElement(ReliabilityBadge, { result, rankedCount: 1 }));
    expect(badge).toContain('href="/clients"');
    expect(badge).toContain("Reliability A · rank 1 of 1");
    expect(renderToStaticMarkup(createElement(ReliabilityBadge, { rankedCount: 0 }))).toContain("Not enough data");
  });
});
