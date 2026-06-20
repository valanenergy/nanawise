'use client';

import { useEffect, useState } from 'react';
import { formatUsdc } from '@nanawise/shared';
import { Nav } from '../components/Nav';
import { Spinner } from '../components/ui';
import { predictClient } from '../../lib/predict';

interface Rank {
  owner: string;
  realized: bigint;
  wins: number;
  trades: number;
}

export default function Leaderboard() {
  const [ranks, setRanks] = useState<Rank[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // Global realized PnL = settled payout − mint cost (truth = chain). Net, not gross.
      const p = predictClient();
      const [redeemed, minted] = await Promise.all([
        p.getPositionsRedeemed().catch(() => []),
        p.getPositionsMinted().catch(() => []),
      ]);
      const costByMgr = new Map<string, bigint>();
      for (const m of minted) costByMgr.set(m.managerId, (costByMgr.get(m.managerId) ?? 0n) + m.cost);
      const byOwner = new Map<string, Rank & { mgr: string }>();
      for (const r of redeemed) {
        const cur = byOwner.get(r.owner) ?? { owner: r.owner, realized: 0n, wins: 0, trades: 0, mgr: r.managerId };
        cur.realized += r.payout;
        cur.trades += 1;
        if (r.payout > 0n) cur.wins += 1;
        byOwner.set(r.owner, cur);
      }
      for (const v of byOwner.values()) v.realized -= costByMgr.get(v.mgr) ?? 0n;
      setRanks([...byOwner.values()].sort((a, b) => Number(b.realized - a.realized)).slice(0, 20));
      setLoading(false);
    })();
  }, []);

  if (loading) return <main><Nav /><Spinner /></main>;

  return (
    <main>
      <Nav />
      <h2 style={{ marginTop: 0 }}>Leaderboard</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Global, by realized payout from on-chain settlements.
      </p>
      <div className="card">
        {ranks.length === 0 && <p className="muted">No settled trades yet.</p>}
        {ranks.map((r, i) => (
          <div className="row" key={r.owner}>
            <span>
              <b>#{i + 1}</b> {r.owner.slice(0, 6)}…{r.owner.slice(-4)}
            </span>
            <span>
              {formatUsdc(r.realized)} · {r.wins}/{r.trades} won
            </span>
          </div>
        ))}
      </div>
    </main>
  );
}
