"use client";

import { useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, type ColDef, type ICellRendererParams, type RowClickedEvent } from "ag-grid-community";
import { chaserGridTheme } from "./invoice-grid";
import { formatCents } from "@/lib/money";
import type { ClientReliability, ReliabilityComponent } from "@/lib/types";

ModuleRegistry.registerModules([AllCommunityModule]);

const components: [ReliabilityComponent, string][] = [
  ["timeliness", "Timeliness"],
  ["planAdherence", "Plan adherence"],
  ["behaviour", "Behaviour"],
  ["exposure", "Exposure"],
];
const gradeTone: Record<string, string> = {
  A: "bg-emerald-50 text-emerald-800",
  B: "bg-teal-50 text-teal-800",
  C: "bg-amber-50 text-amber-800",
  D: "bg-red-50 text-red-700",
};

function GradeCell({ value }: ICellRendererParams<ClientReliability, ClientReliability["grade"]>) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return <span className={`inline-flex size-8 items-center justify-center rounded-full text-sm font-bold ${gradeTone[value]}`}>{value}</span>;
}

function ScoreCell({ data }: ICellRendererParams<ClientReliability>) {
  if (!data) return null;
  if (data.score === null) return <span className="text-sm text-muted-foreground">Not enough data</span>;
  return <div className="flex h-full items-center gap-3">
    <span className="h-2 w-16 overflow-hidden rounded-full bg-secondary"><span className="block h-full rounded-full bg-primary" style={{ width: `${data.score}%` }} /></span>
    <span className="tabular-nums">{data.score}/100</span>
  </div>;
}

export function ClientGrid({ results }: { results: ClientReliability[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(results.find(({ rank }) => rank !== null)?.client.id ?? null);
  const selected = results.find(({ client }) => client.id === selectedId) ?? null;

  const columnDefs = useMemo<ColDef<ClientReliability>[]>(() => [
    { headerName: "Rank", valueGetter: ({ data }) => data?.rank ?? null, valueFormatter: ({ value }) => value === null ? "—" : String(value), width: 90, sortable: true, comparator: (a: number | null, b: number | null) => (a ?? 999) - (b ?? 999), type: "numericColumn" },
    { headerName: "Client", valueGetter: ({ data }) => data?.client.name ?? "", flex: 1.4, minWidth: 180, sortable: true, cellClass: "font-semibold" },
    { headerName: "Grade", valueGetter: ({ data }) => data?.grade ?? null, cellRenderer: GradeCell, width: 100, sortable: true },
    { headerName: "Score", valueGetter: ({ data }) => data?.score ?? -1, cellRenderer: ScoreCell, flex: 1.1, minWidth: 150, sortable: true },
    { headerName: "Outstanding", valueGetter: ({ data }) => data?.outstandingCents ?? 0, valueFormatter: ({ value }) => formatCents(value as number), flex: 1, minWidth: 130, sortable: true, type: "numericColumn" },
    { headerName: "Avg days late", valueGetter: ({ data }) => data?.avgDaysLate ?? null, valueFormatter: ({ value }) => value === null ? "—" : (value as number).toFixed(1), flex: 0.9, minWidth: 130, sortable: true, type: "numericColumn" },
  ], []);

  return <div>
    <div style={{ minHeight: 120 }}>
      <AgGridReact<ClientReliability>
        theme={chaserGridTheme}
        rowData={results}
        columnDefs={columnDefs}
        domLayout="autoHeight"
        suppressCellFocus
        rowClass="cursor-pointer"
        getRowId={({ data }) => data.client.id}
        rowClassRules={{ "bg-accent/40": ({ data }) => data?.client.id === selectedId }}
        onRowClicked={(event: RowClickedEvent<ClientReliability>) => { if (event.data) setSelectedId(event.data.client.id); }}
      />
    </div>
    <div className="border-t px-5 py-4" aria-live="polite">
      {!selected ? <p className="text-sm text-muted-foreground">Select a client to see why they rank where they do.</p> : selected.rank === null ? <p className="text-sm text-muted-foreground"><strong>{selected.client.name}</strong> has no due or settled obligations yet, so there is nothing to score.</p> : (
        <div>
          <p className="text-sm font-semibold">Why {selected.client.name} ranks #{selected.rank}</p>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {components.map(([key, label]) => {
              const { points, weight, explanation } = selected.breakdown[key];
              return <div key={key} className="rounded-xl bg-secondary/60 p-3">
                <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">{points === null ? "No data" : `${points.toFixed(1)} / ${weight}`}</dd>
                <dd className="mt-1 text-xs text-muted-foreground">{explanation}</dd>
              </div>;
            })}
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">Scores use only the weights with data. Payment timing uses the day Chaser recorded full payment.</p>
        </div>
      )}
    </div>
  </div>;
}
