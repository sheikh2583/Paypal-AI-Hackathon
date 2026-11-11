import { paypalModeLabel, type PayPalDisplayMode } from "@/lib/paypal/display";

export function PayPalModeBadge({ mode, credentialsConfigured }: { mode: PayPalDisplayMode; credentialsConfigured: boolean }) {
  const simulated = mode !== "sandbox" || !credentialsConfigured;
  return <p aria-label={`PayPal mode: ${paypalModeLabel(mode, credentialsConfigured)}`} className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-sm font-semibold ${simulated ? "bg-secondary text-secondary-foreground" : "bg-[#003087]/10 text-[#003087]"}`}>
    {paypalModeLabel(mode, credentialsConfigured)}
  </p>;
}
