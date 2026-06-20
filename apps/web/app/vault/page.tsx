'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  descaleSvi,
  formatUsdc,
  parseUsdc,
  plpPrice,
  previewSupplyPlp,
  previewWithdrawDusdc,
  whatIf,
} from '@nanawise/shared';
import { Nav } from '../components/Nav';
import { Spinner } from '../components/ui';
import { activeBtcOracle, predictClient } from '../../lib/predict';

type Vault = Awaited<ReturnType<ReturnType<typeof predictClient>['readVault']>>;

export default function VaultPage() {
  const [v, setV] = useState<Vault | null>(null);
  const [loading, setLoading] = useState(true);
  const [supplyAmt, setSupplyAmt] = useState('100');
  const [withdrawAmt, setWithdrawAmt] = useState('50');
  const [movePct, setMovePct] = useState(5);
  const [oracle, setOracle] = useState<Awaited<ReturnType<typeof activeBtcOracle>>>();

  useEffect(() => {
    (async () => {
      try {
        setV(await predictClient().readVault());
        setOracle(await activeBtcOracle());
      } catch {
        /* ignore */
      }
      setLoading(false);
    })();
  }, []);

  const snap = v ? { balance: v.balance, totalMtm: v.totalMtm, totalMaxPayout: v.totalMaxPayout, plpSupply: v.plpSupply } : null;

  const expectedPlp = useMemo(() => {
    if (!snap) return 0n;
    try {
      return previewSupplyPlp(snap, parseUsdc(supplyAmt || '0'));
    } catch {
      return 0n;
    }
  }, [snap, supplyAmt]);

  const expectedDusdc = useMemo(() => {
    if (!snap) return 0n;
    try {
      return previewWithdrawDusdc(snap, parseUsdc(withdrawAmt || '0'));
    } catch {
      return 0n;
    }
  }, [snap, withdrawAmt]);

  const sim = useMemo(() => {
    if (!snap || !oracle?.svi) return null;
    const fwd = Number(oracle.forward1e9) / 1e9;
    return whatIf({
      vault: snap,
      spot: Number(oracle.spot1e9) / 1e9,
      forward: fwd,
      svi: descaleSvi(oracle.svi),
      strike: Math.round(fwd / 500) * 500,
      openUpQty: snap.totalMaxPayout, // proxy for open exposure
      pctMove: movePct / 100,
    });
  }, [snap, oracle, movePct]);

  if (loading) return <main><Nav /><Spinner /></main>;
  if (!v) return <main><Nav /><p className="muted">Vault unavailable.</p></main>;

  const util = v.balance > 0n ? Number((v.totalMaxPayout * 10000n) / v.balance) / 100 : 0;
  const available = v.balance > v.totalMaxPayout ? v.balance - v.totalMaxPayout : 0n;
  const limiterAvail = v.limiter.enabled ? v.limiter.available : available;
  const maxWithdraw = limiterAvail < available ? limiterAvail : available;

  return (
    <main>
      <Nav />
      <h2 style={{ marginTop: 0 }}>Liquidity Vault (PLP)</h2>
      <div className="card">
        <div className="row">
          <span className="muted">Vault balance</span>
          <span className="big">{formatUsdc(v.balance)} dUSDC</span>
        </div>
        <div className="row">
          <span className="muted">Outstanding max payout</span>
          <span>{formatUsdc(v.totalMaxPayout)} dUSDC</span>
        </div>
        <div className="row">
          <span className="muted">Mark-to-market liability</span>
          <span>{formatUsdc(v.totalMtm)} dUSDC</span>
        </div>
        <div className="row">
          <span className="muted">Utilization</span>
          <span>{util.toFixed(1)}%</span>
        </div>
      </div>

      <div className="card">
        <div className="row">
          <span className="muted">PLP price</span>
          <span>{snap ? plpPrice(snap).toFixed(4) : '—'} dUSDC</span>
        </div>
        <div className="row">
          <span className="muted">Available to withdraw now</span>
          <span>{formatUsdc(maxWithdraw)} dUSDC</span>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          Withdrawable = min(vault balance − outstanding payouts
          {v.limiter.enabled ? ', token-bucket limiter' : ''}).
        </p>
      </div>

      {/* Supply / Withdraw forms */}
      <div className="card">
        <div className="muted" style={{ marginBottom: 6 }}>Provide liquidity</div>
        <div className="row">
          <input
            value={supplyAmt}
            onChange={(e) => setSupplyAmt(e.target.value)}
            inputMode="decimal"
            style={inputStyle}
          />
          <span className="muted">→ ≈ {formatUsdc(expectedPlp)} PLP</span>
        </div>
        <a className="btn" href={`/miniapp/vault?action=supply&amount=${safeUsdc(supplyAmt)}`}>
          Supply {supplyAmt || '0'} dUSDC
        </a>
        <div className="row" style={{ marginTop: 14 }}>
          <input
            value={withdrawAmt}
            onChange={(e) => setWithdrawAmt(e.target.value)}
            inputMode="decimal"
            style={inputStyle}
          />
          <span className="muted">→ ≈ {formatUsdc(expectedDusdc)} dUSDC</span>
        </div>
        <a className="btn" href={`/miniapp/vault?action=withdraw&amount=${safeUsdc(withdrawAmt)}`}>
          Withdraw {withdrawAmt || '0'} PLP
        </a>
      </div>

      {/* What-If simulator */}
      <div className="card">
        <div className="muted" style={{ marginBottom: 6 }}>&quot;What if&quot; BTC moves {movePct >= 0 ? '+' : ''}{movePct}%</div>
        <input
          type="range"
          min={-20}
          max={20}
          value={movePct}
          onChange={(e) => setMovePct(Number(e.target.value))}
          style={{ width: '100%' }}
        />
        {sim ? (
          <>
            <div className="row">
              <span className="muted">Vault liability</span>
              <span>
                {formatUsdc(sim.liabilityBefore)} → {formatUsdc(sim.liabilityAfter)}
              </span>
            </div>
            <div className="row">
              <span className="muted">Est. PLP price impact</span>
              <span style={{ color: sim.plpPriceChangePct >= 0 ? 'var(--up)' : 'var(--down)' }}>
                {sim.plpPriceChangePct >= 0 ? '+' : ''}
                {sim.plpPriceChangePct.toFixed(2)}%
              </span>
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              Single-market estimate from live SVI. LPs gain when traders lose and vice-versa.
            </p>
          </>
        ) : (
          <p className="muted" style={{ fontSize: 12 }}>No active market to simulate against.</p>
        )}
      </div>

      {/* Earn (margin lending) — deferred to Phase 8 */}
      <div className="card" style={{ opacity: 0.7 }}>
        <div className="row">
          <span className="muted">💰 Earn — idle dUSDC lending</span>
          <span className="muted" style={{ fontSize: 12 }}>coming soon</span>
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          DeepBook Margin dUSDC lending pool. Pending a confirmed testnet pool — see docs/BLOCKERS.
        </p>
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--fg)',
  padding: '8px 10px',
  width: 120,
  fontSize: 16,
};

function safeUsdc(s: string): string {
  try {
    return parseUsdc(s || '0').toString();
  } catch {
    return '0';
  }
}
