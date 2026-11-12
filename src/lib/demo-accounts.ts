// Public demo sign-ins (D78). These are deliberately public: they appear on the sign-in pages
// of the public demo so a judge can click once and see the client portal. They use fictional
// example.com addresses, belong to fictional clients, and can only see those clients' invoices.
// The sign-in pages show them only when DEMO_PUBLIC is on.

export interface DemoClientAccount {
  clientId: string;
  name: string;
  email: string;
  password: string;
}

export const DEMO_CLIENT_ACCOUNTS: readonly DemoClientAccount[] = [
  { clientId: "client-dana", name: "Dana Whitfield", email: "dana.demo@example.com", password: "chaser-demo-dana-2026" },
];

/** The owner's demo button only shows what an owner sign-in looks like; it never signs in. */
export const DEMO_OWNER_DISPLAY = { email: "maya@example.com", maskedPassword: "••••••••••••••" } as const;

export function isDemoClientEmail(email: string): boolean {
  return DEMO_CLIENT_ACCOUNTS.some((account) => account.email === email.trim().toLowerCase());
}
