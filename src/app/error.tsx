"use client";

export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <main className="grid min-h-screen place-content-center justify-items-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">Chaser couldn’t load the workspace</h1>
      <p className="text-muted-foreground">Give it a moment and try again.</p>
      <button type="button" onClick={retry} className="rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground">Try again</button>
    </main>
  );
}
