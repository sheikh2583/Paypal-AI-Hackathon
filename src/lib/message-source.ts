// Which agent messages the live model wrote and which came from the script (D79), worked out from the
// audit log alone: an agent run is "live" when the model answered at least once during it and no
// scripted fallback took over. Messages sent outside an agent run (the owner's relayed counter) get no label.
import type { AuditEntry } from "./types";

export type MessageSource = "live" | "scripted";

export function messageSources(entries: readonly AuditEntry[]): Map<string, MessageSource> {
  const at = (entry: AuditEntry) => Date.parse(entry.at);
  const runs = entries
    .filter((entry) => entry.action === "agent_run" && entry.ok)
    .map((entry) => {
      const input = (entry.input ?? {}) as { startedAt?: string };
      const start = input.startedAt ? Date.parse(input.startedAt) : at(entry);
      const end = at(entry);
      const inside = (other: AuditEntry) => at(other) >= start && at(other) <= end;
      const answered = entries.some((other) => other.action === "llm.call" && other.ok
        && (other.input as { purpose?: string } | null)?.purpose === "agent_run" && inside(other));
      const fellBack = entries.some((other) => other.action === "llm.fallback" && inside(other));
      return { start, end, source: (answered && !fellBack ? "live" : "scripted") as MessageSource };
    });

  const sources = new Map<string, MessageSource>();
  for (const entry of entries) {
    if (entry.action !== "send_message" || !entry.ok) continue;
    const messageId = (entry.result as { messageId?: unknown } | null)?.messageId;
    if (typeof messageId !== "string") continue;
    const run = runs.find(({ start, end }) => at(entry) >= start && at(entry) <= end);
    if (run) sources.set(messageId, run.source);
  }
  return sources;
}
