'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PredictClient } from '@nanawise/predict-sdk';
import { completeOnboard, prepareOnboard } from '../../../lib/api';
import { sdkConfig } from '../../../lib/config';
import { newSdkClient, signAndExecuteSponsored } from '../../../lib/execute';
import { getZkSession } from '../../../lib/zklogin';

/**
 * Onboarding orchestration (Phase 1): ensure the user has a PredictManager, then
 * register with the backend (which funds + DMs the bot).
 *
 * create_manager and deposit are SEPARATE txs (you can't &mut a freshly-shared
 * manager in the same PTB). The 100-dUSDC grant lands at the user's address from the
 * hot wallet; the user can deposit it into the manager from the trade screen later.
 */
function Onboard() {
  const params = useSearchParams();
  const state = params.get('state') ?? 'web';
  const [step, setStep] = useState('Setting up your account…');
  const [managerId, setManagerId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const session = getZkSession();
        if (!session) throw new Error('Not signed in — please start again.');

        // Phase 0: Pre-register with backend so sponsorship will work
        setStep('Preparing your account…');
        await prepareOnboard(session.jwt);

        const sui = newSdkClient();
        const predict = new PredictClient(sui, sdkConfig());

        setStep('Creating your trading account on Sui…');
        const tx = predict.buildCreateManager();
        const digest = await signAndExecuteSponsored(tx);
        await sui.waitForTransaction({ digest });
        const mgr = await predict.findCreatedManagerId(digest);
        setManagerId(mgr ?? null);
        if (mgr) sessionStorage.setItem('nanawise.managerId', mgr);

        setStep('Funding your account…');
        await completeOnboard({ state, jwt: session.jwt, managerId: mgr });

        setStep('done');
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
  }, [state]);

  if (err) {
    return (
      <main>
        <div className="card">
          <p className="err">{err}</p>
          <a className="btn" href="/">
            Start over
          </a>
        </div>
      </main>
    );
  }

  if (step === 'done') {
    return (
      <main>
        <div className="card">
          <div className="big" style={{ color: 'var(--up)' }}>You&apos;re all set 🎉</div>
          <p className="muted">
            Your self-custodial wallet is ready and funded with 10 dUSDC. Head back to Telegram and
            try <b>/market</b>.
          </p>
          {managerId && (
            <p className="muted" style={{ fontSize: 12 }}>
              Manager: {managerId.slice(0, 10)}…
            </p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main>
      <div className="card">
        <div className="spinner" />
        <p className="muted" style={{ textAlign: 'center' }}>{step}</p>
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<main><div className="spinner" /></main>}>
      <Onboard />
    </Suspense>
  );
}
