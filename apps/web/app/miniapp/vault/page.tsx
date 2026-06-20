'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PredictClient } from '@nanawise/predict-sdk';
import { formatUsdc } from '@nanawise/shared';
import { sdkConfig } from '../../../lib/config';
import { newSdkClient, signAndExecuteSponsored } from '../../../lib/execute';
import { getZkSession } from '../../../lib/zklogin';

function VaultAction() {
  const p = useSearchParams();
  const action = p.get('action') ?? 'supply';
  const amount = BigInt(p.get('amount') ?? '0');
  const [phase, setPhase] = useState<'ready' | 'signing' | 'done' | 'error'>('ready');
  const [digest, setDigest] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function confirm() {
    setPhase('signing');
    setErr(null);
    try {
      const session = getZkSession();
      if (!session) throw new Error('Please sign in again.');
      const sui = newSdkClient();
      const predict = new PredictClient(sui, sdkConfig());
      const tx =
        action === 'supply'
          ? predict.buildSupply({ amount, sender: session.address })
          : predict.buildWithdraw({ plpAmount: amount, sender: session.address });
      const d = await signAndExecuteSponsored(tx);
      await sui.waitForTransaction({ digest: d });
      setDigest(d);
      setPhase('done');
    } catch (e) {
      setErr((e as Error).message);
      setPhase('error');
    }
  }

  return (
    <main>
      <h2>{action === 'supply' ? 'Supply liquidity' : 'Withdraw liquidity'}</h2>
      <div className="card">
        <div className="row">
          <span className="muted">{action === 'supply' ? 'Supply' : 'Burn'}</span>
          <span className="big">
            {formatUsdc(amount)} {action === 'supply' ? 'dUSDC' : 'PLP'}
          </span>
        </div>
      </div>
      {(phase === 'ready' || phase === 'error') && (
        <button className="btn" onClick={confirm}>
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
          <a href={`https://testnet.suivision.xyz/txblock/${digest}`} target="_blank" rel="noreferrer">
            View transaction →
          </a>
        </div>
      )}
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<main><div className="spinner" /></main>}>
      <VaultAction />
    </Suspense>
  );
}
