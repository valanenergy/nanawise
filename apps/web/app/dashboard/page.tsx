'use client';

import { useEffect, useState } from 'react';
import { formatStrike, formatUsdc, type OracleStatus } from '@nanawise/shared';
import type { OracleState } from '@nanawise/predict-sdk';
import { Nav } from '../components/Nav';
import { LifecycleBadge, Spinner } from '../components/ui';
import { activeBtcOracle, predictClient, useAccount } from '../../lib/predict';

interface Row {
  strike: bigint;
  prob: number;
  cost: bigint;
  atm: boolean;
}

export default function Market() {
  const { suiAddress } = useAccount();
  const [oracle, setOracle] = useState<OracleState | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const o = await activeBtcOracle();
    setOracle(o ?? null);
    if (!o) {
      setLoading(false);
      return;
    }
    const p = predictClient();
    const FIVE = 500_000_000_000n;
    const base = ((o.forward1e9 + FIVE / 2n) / FIVE) * FIVE;
    const sender = suiAddress ?? `0x${'0'.repeat(64)}`;
    const out: Row[] = [];
    for (let i = -3; i <= 3; i++) {
      const strike = base + BigInt(i) * FIVE;
      if (strike <= 0n) continue;
      try {
        const pv = await p.previewMint(
          { oracleId: o.oracleId, expiry: BigInt(o.expiryMs), strike, isUp: true, quantity: 1_000_000n },
          sender,
        );
        out.push({ strike, prob: pv.impliedProb, cost: pv.cost, atm: i === 0 });
      } catch {
        out.push({ strike, prob: 0, cost: 0n, atm: i === 0 });
      }
    }
    setRows(out);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main>
      <Nav />
      <div className="row">
        <h2 style={{ margin: 0 }}>BTC Market</h2>
        {oracle && <LifecycleBadge status={oracle.status as OracleStatus} />}
      </div>
      {loading && <Spinner />}
      {!loading && !oracle && <p className="muted">No BTC round is open right now — a new one activates shortly.</p>}
      {oracle && (
        <>
          <div className="card">
            <div className="row">
              <span className="muted">Spot</span>
              <span className="big">${formatStrike(oracle.spot1e9)}</span>
            </div>
            <div className="row">
              <span className="muted">Expires</span>
              <span>{new Date(oracle.expiryMs).toLocaleTimeString()}</span>
            </div>
          </div>
          <div className="card">
            {rows.map((r) => (
              <div className="row" key={r.strike.toString()}>
                <span style={{ fontWeight: r.atm ? 700 : 400 }}>
                  ${formatStrike(r.strike)} {r.atm && <span className="muted">ATM</span>}
                </span>
                <span>{r.cost > 0n ? `${(r.prob * 100).toFixed(0)}% · ${formatUsdc(r.cost)}` : '—'}</span>
              </div>
            ))}
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
              UP pays $1/contract if BTC ≥ strike at expiry. Trade from the Telegram bot.
            </p>
          </div>
        </>
      )}
    </main>
  );
}
