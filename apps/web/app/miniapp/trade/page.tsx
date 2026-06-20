'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PredictClient } from '@nanawise/predict-sdk';
import { formatStrike, formatUsdc } from '@nanawise/shared';
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
          const pv = await predict.previewMintRange(
            { oracleId, expiry, lowerStrike, higherStrike, quantity },
            session.address,
          );
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
          const dep = predict.buildDeposit({
            managerId,
            coinType: sdkConfig().dusdcType,
            amount: buffered - internal,
          });
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
      const predict = new PredictClient(newSdkClient(), sdkConfig());
      setErr(predict.mapExecutionError((e as Error).message));
      setPhase('error');
    }
  }

  const title = isRedeem
    ? 'Close position'
    : isRange
      ? `Range $${formatStrike(lowerStrike)}–$${formatStrike(higherStrike)}`
      : `${isUp ? 'UP' : 'DOWN'} $${formatStrike(strike)}`;

  return (
    <main>
      <h2>{title}</h2>
      {phase === 'loading' && <div className="spinner" />}

      {preview && phase !== 'done' && (
        <div className="card">
          {!isRedeem && (
            <div className="row">
              <span className="muted">You pay</span>
              <span className="big">{formatUsdc(preview.cost)} dUSDC</span>
            </div>
          )}
          <div className="row">
            <span className="muted">{isRedeem ? 'You receive' : 'Max payout'}</span>
            <span>{formatUsdc(preview.payout)} dUSDC</span>
          </div>
          {!isRange && !isRedeem && (
            <div className="row">
              <span className="muted">Implied probability</span>
              <span>{(preview.impliedProb * 100).toFixed(1)}%</span>
            </div>
          )}
        </div>
      )}

      {(phase === 'ready' || phase === 'error') && (
        <button className={`btn ${isRedeem ? '' : isUp ? 'up' : 'down'}`} onClick={confirm}>
          Confirm &amp; sign
        </button>
      )}
      {phase === 'signing' && (
        <>
          <div className="spinner" />
          <p className="muted" style={{ textAlign: 'center' }}>Signing &amp; submitting…</p>
        </>
      )}
      {err && <p className="err">{err}</p>}

      {phase === 'done' && digest && (
        <div className="card">
          <div className="big" style={{ color: 'var(--up)' }}>Done ✅</div>
          <p className="muted">Your transaction is on-chain.</p>
          <a href={`https://testnet.suivision.xyz/txblock/${digest}`} target="_blank" rel="noreferrer">
            View transaction →
          </a>
        </div>
      )}
    </main>
  );
}

/** Find the user's PredictManager by scanning owned/shared state; cached in sessionStorage. */
async function resolveManagerId(predict: PredictClient, address: string): Promise<string | undefined> {
  const cached = sessionStorage.getItem('nanawise.managerId');
  if (cached) return cached;
  // The onboard flow stores it; if absent, the caller should re-onboard.
  void predict;
  void address;
  return undefined;
}

export default function Page() {
  return (
    <Suspense fallback={<main><div className="spinner" /></main>}>
      <Trade />
    </Suspense>
  );
}
