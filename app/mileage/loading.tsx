/**
 * Shown while the drive query runs. It exists because this route is
 * force-dynamic: without it the browser holds the previous screen and a
 * tap reads as a dead control, which is what the owner reported.
 */
export default function Loading() {
  return (
    <main className="min-h-screen px-4 sm:px-6 py-8" aria-busy="true">
      <div className="max-w-3xl mx-auto grid gap-4">
        <div className="h-5 w-40 rounded bg-[var(--surface-2)]" />
        <div className="h-10 w-56 rounded bg-[var(--surface-2)]" />
        <div className="grid gap-2" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 rounded bg-[var(--surface-2)]" />
          ))}
        </div>
        <span className="sr-only">Loading your drives</span>
      </div>
    </main>
  );
}
