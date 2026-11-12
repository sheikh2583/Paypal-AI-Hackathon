import { paypalModeLabel, type PayPalDisplayMode } from "@/lib/paypal/display";

export function PayPalModeBadge({ mode, credentialsConfigured }: { mode: PayPalDisplayMode; credentialsConfigured: boolean }) {
  const simulated = mode !== "sandbox" || !credentialsConfigured;
  return <p aria-label={`PayPal mode: ${paypalModeLabel(mode, credentialsConfigured)}`} title={simulated ? "PayPal is simulated. No money moves." : "Real PayPal invoices using PayPal's test money. Nothing is charged."} className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold md:mt-2 md:text-sm ${simulated ? "bg-secondary text-secondary-foreground" : "bg-[#003087]/10 text-[#003087]"}`}>
    {paypalModeLabel(mode, credentialsConfigured)}
  </p>;
}
