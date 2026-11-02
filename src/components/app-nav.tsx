"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, LayoutDashboard, ScrollText, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Extra path prefixes that should also highlight this item. */
  alsoActiveFor?: string[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, alsoActiveFor: ["/invoices"] },
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

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
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
    </nav>
  );
}
