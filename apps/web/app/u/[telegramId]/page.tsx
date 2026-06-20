import { Nav } from '../../components/Nav';

/** Public profile / share-card target (Phase 5). Server component — static shell. */
export default async function PublicProfile({ params }: { params: Promise<{ telegramId: string }> }) {
  const { telegramId } = await params;
  return (
    <main>
      <Nav />
      <h2 style={{ marginTop: 0 }}>Trader {telegramId}</h2>
      <div className="card">
        <p className="muted">
          Public profile for trader <b>{telegramId}</b>. Streak, win-rate, and PnL render here from the
          keeper&apos;s settlement ledger (wired with Phase 7 social).
        </p>
        <a className="btn" href="/dashboard">
          Open Nanawise →
        </a>
      </div>
    </main>
  );
}
