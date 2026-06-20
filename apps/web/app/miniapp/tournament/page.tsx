'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { buildJoinTournament } from '@nanawise/predict-sdk';
import { formatUsdc } from '@nanawise/shared';
import { sdkConfig } from '../../../lib/config';
import { newSdkClient, signAndExecuteSponsored } from '../../../lib/execute';
import { getZkSession } from '../../../lib/zklogin';

function Join() {
  const p = useSearchParams();
  const tournamentId = p.get('id') ?? '';
  const fee = BigInt(p.get('fee') ?? '0');
  const [phase, setPhase] = useState<'ready' | 'signing' | 'done' | 'error'>('ready');
  const [digest, setDigest] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function confirm() {
    setPhase('signing');
    setErr(null);
    try {
      const session = getZkSession();
      if (!session) throw new Error('Please sign in again.');
      const cfg = sdkConfig();
      const tx = buildJoinTournament(
        { tournamentPackageId: process.env.NEXT_PUBLIC_TOURNAMENT_PACKAGE_ID, dusdcType: cfg.dusdcType, clockId: cfg.clockId },
        { tournamentId, entryFee: fee, nowMs: BigInt(Date.now()) },
      );
      const d = await signAndExecuteSponsored(tx);
      await newSdkClient().waitForTransaction({ digest: d });
      setDigest(d);
      setPhase('done');
    } catch (e) {
      setErr((e as Error).message);
      setPhase('error');
    }
  }

  return (
    <main>
      <h2>Join tournament</h2>
      <div className="card">
        <div className="row">
          <span className="muted">Entry fee</span>
          <span className="big">{formatUsdc(fee)} dUSDC</span>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Your fee joins the on-chain prize pool. Top trader at the end takes it (minus a small
          platform fee) — released trustlessly by the escrow.
        </p>
      </div>
      {(phase === 'ready' || phase === 'error') && (
        <button className="btn" onClick={confirm}>
          Pay &amp; join
        </button>
      )}
      {phase === 'signing' && <div className="spinner" />}
      {err && <p className="err">{err}</p>}
      {phase === 'done' && digest && (
        <div className="card">
          <div className="big" style={{ color: 'var(--up)' }}>Joined ✅</div>
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
      <Join />
    </Suspense>
  );
}
