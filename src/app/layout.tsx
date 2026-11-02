import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Chaser", template: "%s · Chaser" },
  description:
    "An AI collections agent that chases overdue PayPal invoices within the limits you set.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
