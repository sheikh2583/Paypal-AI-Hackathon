import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { formatCents } from "@/lib/money";
import type { ClientReliability, ReliabilityComponent } from "@/lib/types";

const components: [ReliabilityComponent, string][] = [
  ["timeliness", "Timeliness"],
  ["planAdherence", "Plan adherence"],
  ["behaviour", "Behaviour"],
  ["exposure", "Exposure"],
];

export function ReliabilityBadge({ result, rankedCount }: {
  result?: ClientReliability;
  rankedCount: number;
}) {
  return (
    <Link href="/clients" className="inline-flex rounded-full border bg-card px-3 py-1.5 text-xs font-semibold text-primary hover:underline">
      {result?.rank != null ? `Reliability ${result.grade} · rank ${result.rank} of ${rankedCount}` : "Reliability · Not enough data"}
    </Link>
  );
}

export function ClientReliabilityView({ results, publicDemo }: {
  results: ClientReliability[];
  publicDemo: boolean;
}) {
  return (
    <div>
      <PageHeader title="Client reliability" description="See how clients pay across this workspace’s invoices and installment plans." />
      <p className="mb-5 rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        Private to you. Based only on this account&apos;s invoices. Small demo sample. This score never changes the limits the agent must follow.
        {publicDemo ? " The public demo shows fictional clients." : ""}
      </p>
      {results.length === 0 ? (
        <p className="rounded-xl border bg-card p-5 text-sm">No clients yet. Client reliability will appear when there are due or settled invoices to assess.</p>
      ) : (
        <section className="overflow-x-auto rounded-2xl border bg-card shadow-sm" aria-label="Client reliability ranking">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-secondary/60 text-xs font-medium text-muted-foreground">
              <tr>
                {["Rank", "Client", "Grade", "Score", "Outstanding", "Avg days late", "Why"].map((title) =>
                  <th key={title} scope="col" className="px-4 py-3">{title}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y">
              {results.map((result) => (
                <tr key={result.client.id} className="align-top">
                  <td className="px-4 py-4 tabular-nums">{result.rank ?? "—"}</td>
                  <th scope="row" className="px-4 py-4 font-semibold">{result.client.name}</th>
                  <td className="px-4 py-4">{result.grade ?? "—"}</td>
                  <td className="px-4 py-4 tabular-nums">{result.score === null ? "Not enough data" : `${result.score}/100`}</td>
                  <td className="px-4 py-4 tabular-nums">{formatCents(result.outstandingCents)}</td>
                  <td className="px-4 py-4 tabular-nums">{result.avgDaysLate === null ? "—" : result.avgDaysLate.toFixed(1)}</td>
                  <td className="px-4 py-4">
                    <details>
                      <summary className="cursor-pointer whitespace-nowrap font-medium text-primary">Why<span className="sr-only"> for {result.client.name}</span></summary>
                      {result.rank === null ? <p className="mt-2 text-muted-foreground">No due or settled obligations yet.</p> : (
                        <div className="mt-2 min-w-48 space-y-2">
                          <dl className="space-y-2">
                            {components.map(([key, label]) => {
                              const { points, weight, explanation } = result.breakdown[key];
                              return <div key={key}>
                                <dt className="font-medium">{label} · {points === null ? "No data" : `${points.toFixed(1)} of ${weight} pts`}</dt>
                                <dd className="text-muted-foreground">{explanation}</dd>
                              </div>;
                            })}
                          </dl>
                          <p className="text-xs text-muted-foreground">The score uses available weights. Payment timing uses the day Chaser recorded full payment.</p>
                        </div>
                      )}
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
