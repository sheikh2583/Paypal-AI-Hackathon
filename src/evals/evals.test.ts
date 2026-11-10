import { describe, expect, it } from "vitest";
import { runScenario } from "./run";
import { scenarios } from "./scenarios";

describe("scripted agent evals", () => {
  it.each(scenarios)("$name", async (scenario) => {
    const result = await runScenario(scenario);
    expect(result.reasons, result.reasons.join("\n")).toEqual([]);
  });
});
