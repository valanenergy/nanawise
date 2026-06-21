'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PredictClient } from '@nanawise/predict-sdk';
import { formatStrike, formatUsdc } from '@nanawise/shared';
import { lookupManager } from '../../../lib/api';
import { sdkConfig } from '../../../lib/config';
import { newSdkClient, signAndExecuteSponsored } from '../../../lib/execute';
import { getZkSession } from '../../../lib/zklogin';

interface Preview {
  cost: bigint;
  payout: bigint;
  impliedProb: number;
}

function Trade() {
  const p = useSearchParams();
  const action = p.get('action') ?? 'mint';
  const oracleId = p.get('oracleId') ?? '';
  const expiry = BigInt(p.get('expiry') ?? '0');
  const strike = BigInt(p.get('strike') ?? '0');
  const isUp = p.get('isUp') === 'true';
  const lowerStrike = BigInt(p.get('lowerStrike') ?? '0');
  const higherStrike = BigInt(p.get('higherStrike') ?? '0');
  const quantity = BigInt(p.get('quantity') ?? '0');

  const isRange = action === 'mintRange';
  const isRedeem = action === 'redeem';

  const [preview, setPreview] = useState<Preview | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'signing' | 'done' | 'error'>('loading');
  const [digest, setDigest] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const session = getZkSession();
        if (!session) throw new Error('Please sign in with Google first.');
        const predict = new PredictClient(newSdkClient(), sdkConfig());
        if (isRange) {
          const pv = await predict.previewMintRange({ oracleId, expiry, lowerStrike, higherStrike, quantity }, session.address);
          setPreview({ cost: pv.cost, payout: pv.payout, impliedProb: 0 });
        } else if (isRedeem) {
          const pv = await predict.previewRedeem({ oracleId, expiry, strike, isUp, quantity }, session.address);
          setPreview({ cost: 0n, payout: pv.payout, impliedProb: 0 });
        } else {
          const pv = await predict.previewMint({ oracleId, expiry, strike, isUp, quantity }, session.address);
          setPreview({ cost: pv.cost, payout: pv.payout, impliedProb: pv.impliedProb });
        }
        setPhase('ready');
      } catch (e) {
        setErr((e as Error).message);
        setPhase('error');
      }
    })();
  }, []);

  async function confirm() {
    setPhase('signing');
    setErr(null);
    try {
      const session = getZkSession();
      if (!session) throw new Error('Please sign in again.');
      const sui = newSdkClient();
      const predict = new PredictClient(sui, sdkConfig());
      const managerId = await resolveManagerId(predict, session.address);
      if (!managerId) throw new Error('No trading account found — finish onboarding first.');

      if (isRedeem) {
        const tx = predict.buildRedeem({ managerId, oracleId, expiry, strike, isUp, quantity });
        const d = await signAndExecuteSponsored(tx);
        await sui.waitForTransaction({ digest: d });
        setDigest(d);
      } else {
        // mint spends the manager's INTERNAL balance — ensure it's funded first.
        const cost = preview?.cost ?? 0n;
        const buffered = cost + cost / 50n + 1n; // ~2% buffer (post-trade pricing)
        const internal = await predict.getManagerBalance(managerId, sdkConfig().dusdcType, session.address);
        if (internal < buffered) {
          const dep = predict.buildDeposit({ managerId, coinType: sdkConfig().dusdcType, amount: buffered - internal });
          const dd = await signAndExecuteSponsored(dep);
          await sui.waitForTransaction({ digest: dd });
        }
        const tx = isRange
          ? predict.buildMintRange({ managerId, oracleId, expiry, lowerStrike, higherStrike, quantity })
          : predict.buildMint({ managerId, oracleId, expiry, strike, isUp, quantity });
        const d = await signAndExecuteSponsored(tx);
        await sui.waitForTransaction({ digest: d });
        setDigest(d);
      }
      setPhase('done');
    } catch (e) {
      const raw = (e as Error).message;
      const predict = new PredictClient(newSdkClient(), sdkConfig());
      const friendly = predict.mapExecutionError(raw);
      setErr(friendly === raw || raw.includes(friendly) ? raw : `${friendly}\n\n${raw}`);
      setPhase('error');
    }
  }

  const minsToExpiry = expiry > 0n ? Math.max(0, Math.round((Number(expiry) - Date.now()) / 60000)) : 0;
  const headline = isRedeem
    ? 'Close your position'
    : isRange
      ? `BTC settles between $${formatStrike(lowerStrike)}–$${formatStrike(higherStrike)}`
      : `BTC closes ${isUp ? 'above' : 'below'} $${formatStrike(strike)}`;
  const sideColor = isUp && !isRedeem ? 'var(--green)' : isRedeem ? 'var(--blue)' : 'var(--red)';
  const sideLabel = isRedeem ? 'CLOSE' : isRange ? 'RANGE · BTC' : `${isUp ? 'UP' : 'DOWN'} · BTC`;

  // ── SUBMITTING ───────────────────────────────────────────────
  if (phase === 'signing') {
    return (
      <main>
        <div className="nw-screen" style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '26px 24px' }}>
          <div style={{ position: 'relative', width: 96, height: 96 }}>
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '4px solid var(--border)', borderTopColor: 'var(--green)', animation: 'nwspin .9s linear infinite' }} />
            <div style={{ position: 'absolute', inset: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--green)' }}>
              <svg width="40" height="40" viewBox="0 0 16 16"><path d="M8 3v10M8 3l-4 4M8 3l4 4" stroke="var(--green)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24, marginTop: 30 }}>Signing &amp; submitting…</div>
          <div style={{ fontSize: 14.5, color: 'var(--muted)', marginTop: 8, maxWidth: 250, lineHeight: 1.45 }}>
            {isRedeem ? 'Closing your position on Sui.' : 'Depositing and minting your position on Sui.'}
          </div>
          <div className="nw-mono" style={{ marginTop: 24, fontSize: 12, color: 'var(--muted3)' }}>gas sponsored · keys on device</div>
        </div>
      </main>
    );
  }

  // ── DONE ─────────────────────────────────────────────────────
  if (phase === 'done' && digest) {
    return (
      <main>
        <div className="nw-screen">
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
            <div style={{ width: 88, height: 88, borderRadius: 26, background: 'var(--green)', boxShadow: '0 8px 0 var(--green-dk), 0 16px 30px #1fc58640', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'nwpop .5s ease both' }}>
              <svg width="42" height="42" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 30, letterSpacing: '-.02em', marginTop: 24 }}>
              {isRedeem ? 'Position closed ✅' : 'Position is live ✅'}
            </div>
            <div style={{ fontSize: 16, color: 'var(--muted)', marginTop: 8, maxWidth: 270, lineHeight: 1.45 }}>
              {isRedeem ? 'Your payout has settled to your account.' : `You're betting ${headline.toLowerCase()}. We'll ping you in Telegram at settlement.`}
            </div>

            {preview && (
              <div className="nw-card" style={{ width: '100%', marginTop: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ textAlign: 'left' }}>
                  <div className="nw-mono" style={{ fontSize: 11, color: 'var(--muted2)' }}>{isRedeem ? 'RECEIVED' : 'YOUR POSITION'}</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, marginTop: 4, color: sideColor }}>
                    {isRedeem ? `${formatUsdc(preview.payout)} dUSDC` : `${sideLabel.split(' ')[0]} · ${formatUsdc(preview.cost)} dUSDC`}
                  </div>
                </div>
                {!isRedeem && (
                  <div style={{ textAlign: 'right' }}>
                    <div className="nw-mono" style={{ fontSize: 11, color: 'var(--muted2)' }}>MAX PAYOUT</div>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, marginTop: 4 }}>{formatUsdc(preview.payout)} dUSDC</div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ marginTop: 20 }}>
            <a className="nw-key nw-key--ink" href={`https://testnet.suivision.xyz/txblock/${digest}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
              View transaction
              <svg width="15" height="15" viewBox="0 0 16 16"><path d="M5 11L11 5M11 5H6M11 5v5" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </a>
            <a className="nw-ghost" href="/app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', marginTop: 10 }}>
              Back to start
            </a>
          </div>
        </div>
      </main>
    );
  }

  // ── LOADING ──────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <main>
        <div className="nw-screen" style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div className="spinner" />
          <p className="muted" style={{ textAlign: 'center' }}>Pricing your trade…</p>
        </div>
      </main>
    );
  }

  // ── PREVIEW (ready / error) ──────────────────────────────────
  const probPct = preview ? Math.round(preview.impliedProb * 100) : 0;
  return (
    <main>
      <div className="nw-screen">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="nw-pill" style={{ background: `${sideColor}18`, border: `1px solid ${sideColor}40`, color: sideColor }}>
            {!isRedeem && (
              <svg width="13" height="13" viewBox="0 0 16 16" style={{ transform: isUp ? 'none' : 'rotate(180deg)' }}>
                <path d="M8 3v10M8 3l-4 4M8 3l4 4" stroke={sideColor} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            <span style={{ fontWeight: 700 }}>{sideLabel}</span>
          </span>
          {minsToExpiry > 0 && <span className="nw-mono" style={{ fontSize: 12, color: 'var(--muted2)' }}>expires in ~{minsToExpiry}m</span>}
        </div>

        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 27, letterSpacing: '-.02em', marginTop: 16, lineHeight: 1.12 }}>
          {headline}
        </div>

        {/* numbers */}
        {preview && (
          <div className="nw-card" style={{ marginTop: 18, padding: 0, overflow: 'hidden' }}>
            {!isRedeem && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 18px' }}>
                  <span style={{ fontSize: 15, color: 'var(--muted)' }}>You pay</span>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>
                    {formatUsdc(preview.cost)} <span style={{ color: 'var(--muted2)', fontSize: 13, fontWeight: 600 }}>dUSDC</span>
                  </span>
                </div>
                <div style={{ height: 1, background: '#f0ece2' }} />
              </>
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 18px' }}>
              <span style={{ fontSize: 15, color: 'var(--muted)' }}>{isRedeem ? 'You receive' : 'Max payout'}</span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: 'var(--green)' }}>
                {formatUsdc(preview.payout)} <span style={{ color: '#1fc58699', fontSize: 13, fontWeight: 600 }}>dUSDC</span>
              </span>
            </div>
            {!isRange && !isRedeem && (
              <>
                <div style={{ height: 1, background: '#f0ece2' }} />
                <div style={{ padding: '15px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 15, color: 'var(--muted)' }}>Implied probability</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>{probPct}%</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 5, background: '#f0ece2', marginTop: 10, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${probPct}%`, borderRadius: 5, background: 'linear-gradient(90deg,#2f8fff,#1fc586)' }} />
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {err && <p className="err" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 14 }}>{err}</p>}

        <div style={{ flex: 1, minHeight: 14 }} />
        <button className="nw-key nw-key--green" onClick={confirm}>
          <svg width="18" height="18" viewBox="0 0 16 16"><path d="M8 3v10M8 3l-4 4M8 3l4 4" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Confirm &amp; sign
        </button>
        <div className="nw-mono" style={{ textAlign: 'center', marginTop: 10, fontSize: 12, color: 'var(--muted3)' }}>
          {isRedeem ? 'redeem · gas sponsored' : 'deposit → mint · gas sponsored'}
        </div>
      </div>
    </main>
  );
}

/**
 * Resolve the user's PredictManager id. Prefers the local cache the onboard flow
 * writes, but falls back to the backend (DB lookup by address) when the cache is
 * empty — e.g. a fresh Telegram webview that didn't inherit onboarding's storage.
 */
async function resolveManagerId(predict: PredictClient, address: string): Promise<string | undefined> {
  const cached = localStorage.getItem('nanawise.managerId');
  if (cached) return cached;
  void predict;
  const fromBackend = await lookupManager(address);
  if (fromBackend) {
    localStorage.setItem('nanawise.managerId', fromBackend);
    return fromBackend;
  }
  return undefined;
}

export default function Page() {
  return (
    <Suspense fallback={<main><div className="spinner" /></main>}>
      <Trade />
    </Suspense>
  );
}
