'use client';

import { useEffect, useState } from 'react';
import { binaryUpPrice, descaleSvi, formatStrike } from '@nanawise/shared';
import type { OracleState } from '@nanawise/predict-sdk';
import { Nav } from '../components/Nav';
import { Spinner } from '../components/ui';
import { activeBtcOracle } from '../../lib/predict';

export default function Surface() {
  const [oracle, setOracle] = useState<OracleState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setOracle((await activeBtcOracle()) ?? null);
      setLoading(false);
    })();
  }, []);

  if (loading) return <main><Nav /><Spinner /></main>;
  if (!oracle || !oracle.svi)
    return (
      <main>
        <Nav />
        <p className="muted">No active surface right now.</p>
      </main>
    );

  const svi = descaleSvi(oracle.svi);
  const forward = Number(oracle.forward1e9) / 1e9;
  const params: Array<[string, string]> = [
    ['a', svi.a.toFixed(6)],
    ['b', svi.b.toFixed(6)],
    ['ρ (rho)', svi.rho.toFixed(4)],
    ['m', svi.m.toFixed(6)],
    ['σ (sigma)', svi.sigma.toFixed(6)],
  ];
  // implied vol smile across strikes
  const FIVE = 500;
  const base = Math.round(forward / FIVE) * FIVE;
  const smile: Array<{ strike: number; prob: number }> = [];
  for (let i = -5; i <= 5; i++) {
    const strike = base + i * FIVE;
    if (strike > 0) smile.push({ strike, prob: binaryUpPrice(strike, forward, svi) });
  }
  const maxBar = 1;

  return (
    <main>
      <Nav />
      <h2 style={{ marginTop: 0 }}>Volatility Surface</h2>
      <div className="card">
        <div className="muted" style={{ marginBottom: 8 }}>SVI parameters (live, signed ρ/m)</div>
        {params.map(([k, v]) => (
          <div className="row" key={k}>
            <span className="muted">{k}</span>
            <span style={{ fontFamily: 'monospace' }}>{v}</span>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="muted" style={{ marginBottom: 8 }}>
          Model UP-probability smile (N(d2), forward ${forward.toFixed(0)})
        </div>
        {smile.map((s) => (
          <div className="row" key={s.strike} style={{ alignItems: 'center' }}>
            <span style={{ width: 70 }}>${formatStrike(BigInt(Math.round(s.strike)) * 1_000_000_000n)}</span>
            <div style={{ flex: 1, margin: '0 8px', height: 8, background: 'var(--border)', borderRadius: 4 }}>
              <div style={{ width: `${(s.prob / maxBar) * 100}%`, height: '100%', background: 'var(--accent)', borderRadius: 4 }} />
            </div>
            <span style={{ width: 44, textAlign: 'right' }}>{(s.prob * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </main>
  );
}
