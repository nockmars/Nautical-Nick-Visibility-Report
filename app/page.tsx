export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <h1 className="text-5xl md:text-6xl font-bold text-nn-cyan mb-4">
        Nautical Nick
      </h1>
      <p className="text-lg text-nn-text-dim mb-8">
        Migration in Progress — Phase 0 boot
      </p>
      <div className="text-sm text-nn-text-muted">
        <span className="inline-block px-3 py-1 rounded bg-nn-panel border border-nn-cyan/30">
          Next.js 15 · Tailwind v4 · Prisma 6
        </span>
      </div>
    </main>
  );
}
