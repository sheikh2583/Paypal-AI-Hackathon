"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Inbox, LayoutDashboard, LoaderCircle, LogOut, ScrollText, SlidersHorizontal, Users, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Extra path prefixes that should also highlight this item. */
  alsoActiveFor?: string[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, alsoActiveFor: ["/invoices"] },
  { href: "/clients", label: "Client reliability", icon: Users },
  { href: "/approvals", label: "Approvals", icon: Inbox },
  { href: "/policy", label: "Your limits", icon: SlidersHorizontal },
  { href: "/audit", label: "Audit log", icon: ScrollText },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/") {
    return pathname === "/" || (item.alsoActiveFor ?? []).some((p) => pathname.startsWith(p));
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function AppNav({ demoPublic, account }: { demoPublic: boolean; account?: { name: string; business: string } }) {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signOut() {
    setBusy(true);
    setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error("Could not sign out. Please try again.");
      router.replace("/login");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign out. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <nav aria-label="Main" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
      <div className="ml-auto flex shrink-0 items-center gap-1 md:ml-0 md:mt-4 md:flex-col md:items-stretch md:border-t md:pt-4">
        {account ? <p className="hidden px-3 text-xs leading-snug md:block"><span className="block font-semibold text-foreground">{account.name}</span><span className="text-muted-foreground">{account.business}</span></p> : null}
        {demoPublic
          // The public demo has no session to end, so Sign out shows the owner sign-in screen instead.
          ? <Link href="/login" className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"><LogOut className="size-4" aria-hidden="true" /> Sign out</Link>
          : <button type="button" onClick={() => void signOut()} disabled={busy} className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-60">
            {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <LogOut className="size-4" aria-hidden="true" />}
            {busy ? "Signing out…" : "Sign out"}
          </button>}
      </div>
      {error ? <span role="alert" className="basis-full px-3 text-xs text-destructive md:basis-auto">{error}</span> : null}
    </nav>
  );
}
