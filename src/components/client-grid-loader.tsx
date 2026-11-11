"use client";

import dynamic from "next/dynamic";
import type { ClientReliability } from "@/lib/types";

const ClientGrid = dynamic(() => import("./client-grid").then((module) => module.ClientGrid), {
  ssr: false,
  loading: () => <div aria-busy="true" className="space-y-2 p-5">{[0, 1, 2, 3, 4].map((row) => <div key={row} className="h-12 animate-pulse rounded-lg bg-secondary/60" />)}</div>,
});

export function ClientGridLoader({ results }: { results: ClientReliability[] }) {
  return <ClientGrid results={results} />;
}
