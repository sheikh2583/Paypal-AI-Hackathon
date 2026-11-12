"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Inbox, LayoutDashboard, LoaderCircle, LockKeyhole, LogOut, ScrollText, SlidersHorizontal, Users, type LucideIcon } from "lucide-react";
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
  { href: "/policy", label: "Policy", icon: SlidersHorizontal },
  { href: "/audit", label: "Audit log", icon: ScrollText },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/") {
    return pathname === "/" || (item.alsoActiveFor ?? []).some((p) => pathname.startsWith(p));
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function AppNav({ demoPublic }: { demoPublic: boolean }) {
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
      {demoPublic ? <div className="hidden rounded-lg border border-dashed px-3 py-2.5 text-xs leading-relaxed text-muted-foreground md:mt-4 md:block">
        <p className="flex items-center gap-1.5 font-semibold text-foreground"><LockKeyhole className="size-3.5" aria-hidden="true" /> Public demo</p>
        <p className="mt-1">No sign-in here, so there is nothing to sign out of. A real workspace is owner-only.</p>
        <Link href="/login" className="mt-1.5 inline-block font-semibold text-primary hover:underline">See the owner sign-in</Link>
      </div> : null}
      {demoPublic ? <Link href="/login" className="flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground md:hidden"><LockKeyhole className="size-4" aria-hidden="true" /> Owner sign-in</Link> : null}
      {!demoPublic ? <button type="button" onClick={() => void signOut()} disabled={busy} className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-60 md:mt-4 md:border-t md:pt-5">
        {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <LogOut className="size-4" aria-hidden="true" />}
        {busy ? "Signing out…" : "Sign out"}
      </button> : null}
      {error ? <span role="alert" className="basis-full px-3 text-xs text-destructive md:basis-auto">{error}</span> : null}
    </nav>
  );
}
