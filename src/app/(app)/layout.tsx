import { AppNav } from "@/components/app-nav";
import { getDemoSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await getDemoSession())) redirect("/login");
  return (
    <div className="min-h-screen md:flex">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <aside className="border-b bg-card p-3 md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r md:p-4">
        <div className="mb-3 px-3 md:mb-6">
          <p className="text-lg font-semibold tracking-tight">Chaser</p>
          <p className="hidden text-xs text-muted-foreground md:block">Invoice collections agent</p>
        </div>
        <AppNav />
      </aside>

      <main id="main" className="min-w-0 flex-1 p-4 md:p-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
