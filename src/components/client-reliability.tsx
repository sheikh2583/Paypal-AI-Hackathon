import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ClientGridLoader } from "@/components/client-grid-loader";
import { formatCents } from "@/lib/money";
import type { ClientReliability, ReliabilityComponent } from "@/lib/types";

const components: [ReliabilityComponent, string][] = [
  ["timeliness", "Timeliness"],
  ["planAdherence", "Plan adherence"],
  ["behaviour", "Behaviour"],
  ["exposure", "Exposure"],
];

/** Static fallback for browsers without JavaScript; the grid above replaces it visually. */
function PlainTable({ results }: { results: ClientReliability[] }) {
  return <table className="w-full min-w-[680px] text-left text-sm">
    <thead className="bg-secondary/60 text-xs font-medium text-muted-foreground">
      <tr>{["Rank", "Client", "Grade", "Score", "Outstanding", "Avg days late", "Why"].map((title) => <th key={title} scope="col" className="px-4 py-3">{title}</th>)}</tr>
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
          <td className="px-4 py-4">{result.rank === null ? "No due or settled obligations yet." : components.map(([key, label]) => {
            const { points, weight, explanation } = result.breakdown[key];
            return <p key={key}><strong>{label}</strong> · {points === null ? "No data" : `${points.toFixed(1)} of ${weight} pts`}. {explanation}</p>;
          })}</td>
        </tr>
      ))}
    </tbody>
  </table>;
}

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
        Private to you and based only on your own invoices. This score never changes the limits the agent must follow.
        {publicDemo ? " The public demo shows fictional clients." : ""}
      </p>
      {results.length === 0 ? (
        <p className="rounded-xl border bg-card p-5 text-sm">No clients yet. Client reliability will appear when there are due or settled invoices to assess.</p>
      ) : (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm" aria-label="Client reliability ranking">
          <ClientGridLoader results={results} />
          <noscript><div className="overflow-x-auto"><PlainTable results={results} /></div></noscript>
        </section>
      )}
    </div>
  );
}
