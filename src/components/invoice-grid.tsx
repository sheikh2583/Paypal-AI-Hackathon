"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Search } from "lucide-react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, enableDevValidations, themeQuartz, type ColDef, type ICellRendererParams, type RowClickedEvent } from "ag-grid-community";
import type { InvoiceGridRow } from "@/lib/invoice-grid-rows";

if (process.env.NODE_ENV !== "production") enableDevValidations();
ModuleRegistry.registerModules([AllCommunityModule]);

export const chaserGridTheme = themeQuartz.withParams({
  accentColor: "#0f766e",
  fontFamily: "inherit",
  fontSize: 14,
  headerFontSize: 12,
  headerFontWeight: 600,
  headerBackgroundColor: "#f5f7f9",
  headerTextColor: "#5b6670",
  borderColor: "#e5e9ee",
  rowHoverColor: "#f1f5f4",
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  rowHeight: 64,
  headerHeight: 42,
  cellHorizontalPadding: 16,
});

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const riskTone: Record<InvoiceGridRow["riskLabel"], string> = {
  High: "bg-red-50 text-red-700",
  Medium: "bg-amber-50 text-amber-800",
  Low: "bg-emerald-50 text-emerald-800",
};

type Preset = "all" | "needs-you" | "overdue-30";
const presets: { id: Preset; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs-you", label: "Needs you" },
  { id: "overdue-30", label: "30+ days overdue" },
];

function ClientCell({ data }: ICellRendererParams<InvoiceGridRow>) {
  if (!data) return null;
  return <div className="flex h-full items-center gap-3">
    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-sm font-semibold text-accent-foreground">{data.initials}</span>
    <span className="min-w-0 leading-tight">
      <span className="block truncate font-semibold">{data.clientName}</span>
      <span className="block truncate text-xs text-muted-foreground">{data.number} · {data.description}</span>
    </span>
  </div>;
}

function AmountCell({ data }: ICellRendererParams<InvoiceGridRow>) {
  if (!data) return null;
  return <div className="flex h-full flex-col justify-center leading-tight">
    <span className="font-semibold tabular-nums">{data.amountDueCents === null ? "In payment plan" : money(data.amountDueCents)}</span>
    <span className="text-xs text-muted-foreground">{data.amountDetail}</span>
  </div>;
}

function RiskCell({ data }: ICellRendererParams<InvoiceGridRow>) {
  if (!data) return null;
  if (data.resolved) return <span className="text-xs text-muted-foreground">Resolved</span>;
  return <span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ${riskTone[data.riskLabel]}`}><span className="size-1.5 rounded-full bg-current" />{data.riskLabel} · {data.riskScore}</span>;
}

function ActionCell({ data }: ICellRendererParams<InvoiceGridRow>) {
  if (!data) return null;
  return <span className="inline-flex items-center text-sm font-medium text-primary">{data.nextAction}<ArrowRight className="ml-1 inline size-3.5" aria-hidden="true" /></span>;
}

export function InvoiceGrid({ rows }: { rows: InvoiceGridRow[] }) {
  const router = useRouter();
  const [quickFilter, setQuickFilter] = useState("");
  const [preset, setPreset] = useState<Preset>("all");

  const visibleRows = useMemo(() => rows.filter((row) => {
    if (preset === "needs-you") return row.needsOwner;
    if (preset === "overdue-30") return row.daysOverdue >= 30 && row.amountDueCents !== null && row.amountDueCents > 0;
    return true;
  }), [rows, preset]);

  // Lower-priority columns drop out on narrow screens so the table never needs a sideways scroll.
  const [width, setWidth] = useState(1024);
  const columnDefs = useMemo<ColDef<InvoiceGridRow>[]>(() => [
    { headerName: "Client / invoice", field: "clientName", cellRenderer: ClientCell, flex: 2, minWidth: 190, sortable: true, getQuickFilterText: ({ data }) => data ? `${data.clientName} ${data.number} ${data.description}` : "" },
    { headerName: "Amount due", field: "amountDueCents", cellRenderer: AmountCell, flex: 1.2, minWidth: 150, sortable: true, comparator: (a: number | null, b: number | null) => (a ?? -1) - (b ?? -1), getQuickFilterText: ({ data }) => data?.amountDueCents === null ? "payment plan" : money(data?.amountDueCents ?? 0) },
    { headerName: "Risk", field: "riskScore", cellRenderer: RiskCell, flex: 0.9, minWidth: 115, sortable: true, hide: width < 470, getQuickFilterText: ({ data }) => data?.riskLabel ?? "" },
    { headerName: "Stage", field: "stage", flex: 1, minWidth: 135, sortable: true, hide: width < 760 },
    { headerName: "Next step", field: "nextAction", cellRenderer: ActionCell, flex: 1.4, minWidth: 180, sortable: false, hide: width < 640 },
  ], [width]);

  return <div>
    <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
      <label className="relative flex-1 basis-56">
        <span className="sr-only">Search invoices</span>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input value={quickFilter} onChange={(event) => setQuickFilter(event.target.value)} placeholder="Search client, invoice, or risk" className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
      </label>
      <div role="group" aria-label="Quick filters" className="flex flex-wrap gap-1">
        {presets.map((option) => <button key={option.id} type="button" aria-pressed={preset === option.id} onClick={() => setPreset(option.id)} className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${preset === option.id ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/70"}`}>{option.label}</button>)}
      </div>
    </div>
    <div className="w-full" style={{ minHeight: 120 }}>
      <AgGridReact<InvoiceGridRow>
        theme={chaserGridTheme}
        rowData={visibleRows}
        columnDefs={columnDefs}
        quickFilterText={quickFilter}
        domLayout="autoHeight"
        animateRows
        suppressCellFocus
        rowClass="cursor-pointer"
        getRowId={({ data }) => data.id}
        onGridSizeChanged={({ clientWidth }) => setWidth((previous) => Math.abs(clientWidth - previous) > 8 ? clientWidth : previous)}
        onRowClicked={(event: RowClickedEvent<InvoiceGridRow>) => { if (event.data) router.push(`/invoices/${event.data.id}`); }}
        overlayNoRowsTemplate="<span class='text-sm'>No invoices match this view.</span>"
      />
    </div>
    <p className="px-5 py-2 text-xs text-muted-foreground">Click any row to open that invoice. Click a column title to sort.</p>
  </div>;
}
