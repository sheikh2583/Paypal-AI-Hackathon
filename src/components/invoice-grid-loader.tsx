"use client";

import dynamic from "next/dynamic";
import type { InvoiceGridRow } from "@/lib/invoice-grid-rows";

// The grid touches the DOM at mount, so it loads only in the browser; the
// server renders a lightweight placeholder of the same height.
const InvoiceGrid = dynamic(() => import("./invoice-grid").then((module) => module.InvoiceGrid), {
  ssr: false,
  loading: () => <div aria-busy="true" className="space-y-2 p-5">{[0, 1, 2, 3, 4].map((row) => <div key={row} className="h-12 animate-pulse rounded-lg bg-secondary/60" />)}</div>,
});

export function InvoiceGridLoader({ rows }: { rows: InvoiceGridRow[] }) {
  return <InvoiceGrid rows={rows} />;
}
