'use client';

import { useEffect, useState } from 'react';
import { formatStrike, formatUsdc } from '@nanawise/shared';
import type { MintRecord, RedeemRecord } from '@nanawise/predict-sdk';
import { Nav } from '../components/Nav';
import { Spinner, TxLink } from '../components/ui';
import { predictClient, useAccount } from '../../lib/predict';

export default function Portfolio() {
  const { managerId } = useAccount();
  const [pnl, setPnl] = useState<{ unrealized: bigint; total: bigint } | null>(null);
  const [minted, setMinted] = useState<MintRecord[]>([]);
  const [redeemed, setRedeemed] = useState<RedeemRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!managerId) {
      setLoading(false);
      return;
    }
    (async () => {
      const p = predictClient();
      const [pnlRes, pos, red] = await Promise.all([
        p.getManagerPnl(managerId).catch(() => null),
        p.server.rawGet(`/managers/${managerId}/positions`).catch(() => null),
        p.getPositionsRedeemed().catch(() => []),
      ]);
      if (pnlRes) setPnl({ unrealized: pnlRes.unrealized, total: pnlRes.total });
      const posJson = (pos as { json?: { minted?: unknown[] } })?.json;
      const mintedArr = Array.isArray(posJson?.minted) ? posJson!.minted : [];
      setMinted(
        mintedArr.map((o) => {
          const r = o as Record<string, unknown>;
          return {
            managerId: String(r.manager_id ?? ''),
            trader: String(r.trader ?? ''),
            oracleId: String(r.oracle_id ?? ''),
            expiry: BigInt((r.expiry as number) ?? 0),
            strike: BigInt((r.strike as number) ?? 0),
            isUp: r.is_up === true,
            quantity: BigInt((r.quantity as number) ?? 0),
            cost: BigInt((r.cost as number) ?? 0),
            askPrice: 0n,
            digest: String(r.digest ?? ''),
            checkpointMs: 0,
            raw: o,
          };
        }),
      );
      setRedeemed((red as RedeemRecord[]).filter((x) => x.managerId === managerId));
      setLoading(false);
    })();
  }, [managerId]);

  if (!managerId)
    return (
      <main>
        <Nav />
        <p className="muted">Sign in and onboard from the bot to see your portfolio.</p>
      </main>
    );
  if (loading) return <main><Nav /><Spinner /></main>;

  const totalNum = pnl ? Number(pnl.total) / 1e6 : 0;

  return (
    <main>
      <Nav />
      <h2 style={{ marginTop: 0 }}>Portfolio</h2>
      <div className="card">
        <div className="row">
          <span className="muted">Total PnL</span>
          <span className="big" style={{ color: totalNum >= 0 ? 'var(--up)' : 'var(--down)' }}>
            {totalNum >= 0 ? '+' : ''}
            {totalNum.toFixed(2)} dUSDC
          </span>
        </div>
        {pnl && (
          <div className="row">
            <span className="muted">Unrealized</span>
            <span>{formatUsdc(pnl.unrealized)} dUSDC</span>
          </div>
        )}
      </div>

      <div className="card">
        <div className="muted" style={{ marginBottom: 8 }}>Positions ({minted.length})</div>
        {minted.length === 0 && <p className="muted">No positions yet.</p>}
        {minted.map((m, i) => (
          <div className="row" key={i}>
            <span>
              {m.isUp ? 'UP' : 'DOWN'} ${formatStrike(m.strike)} · {formatUsdc(m.quantity)}
            </span>
            <span className="muted">{m.digest ? <TxLink digest={m.digest} /> : ''}</span>
          </div>
        ))}
      </div>

      {redeemed.length > 0 && (
        <div className="card">
          <div className="muted" style={{ marginBottom: 8 }}>Settled ({redeemed.length})</div>
          {redeemed.slice(0, 10).map((r, i) => (
            <div className="row" key={i}>
              <span>
                {r.isUp ? 'UP' : 'DOWN'} ${formatStrike(r.strike)} →{' '}
                <span style={{ color: r.payout > 0n ? 'var(--up)' : 'var(--down)' }}>
                  {r.payout > 0n ? `WON ${formatUsdc(r.payout)}` : 'lost'}
                </span>
              </span>
              <span className="muted">{r.digest ? <TxLink digest={r.digest} /> : ''}</span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
