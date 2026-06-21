'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PredictClient } from '@nanawise/predict-sdk';
import { completeOnboard, prepareOnboard } from '../../../lib/api';
import { sdkConfig } from '../../../lib/config';
import { newSdkClient, signAndExecuteSponsored } from '../../../lib/execute';
import { getZkSession } from '../../../lib/zklogin';

const STEP_LABELS = [
  'Preparing your session',
  'Creating your trading account on Sui',
  'Adding test funds to get you started',
];

/**
 * Onboarding orchestration (Phase 1): ensure the user has a PredictManager, then
 * register with the backend (which funds + DMs the bot). create_manager and deposit
 * are SEPARATE txs. `stepIdx` drives the visual step list; the async flow underneath
 * is unchanged.
 */
function Onboard() {
  const params = useSearchParams();
  const state = params.get('state') ?? 'web';
  const [stepIdx, setStepIdx] = useState(0);
  const [done, setDone] = useState(false);
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

        // Step 1 — prepare (pre-register so sponsorship works)
        setStepIdx(0);
        await prepareOnboard(session.jwt);

        const sui = newSdkClient();
        const predict = new PredictClient(sui, sdkConfig());

        // Step 2 — create the manager on Sui
        setStepIdx(1);
        const tx = predict.buildCreateManager();
        tx.setSender(session.address);
        const digest = await signAndExecuteSponsored(tx);
        await sui.waitForTransaction({ digest });
        const mgr = await predict.findCreatedManagerId(digest);
        setManagerId(mgr ?? null);
        if (mgr) localStorage.setItem('nanawise.managerId', mgr);

        // Step 3 — fund + register
        setStepIdx(2);
        await completeOnboard({ state, jwt: session.jwt, managerId: mgr });

        setDone(true);
      } catch (e) {
        console.error('[onboard] ERROR:', e);
        setErr((e as Error).message);
      }
    })();
  }, [state]);

  function backToTelegram() {
    const tg = (window as unknown as { Telegram?: { WebApp?: { close?: () => void } } }).Telegram?.WebApp;
    if (tg?.close) tg.close();
  }

  // ── ERROR ────────────────────────────────────────────────────
  if (err) {
    return (
      <main>
        <div className="nw-screen" style={{ justifyContent: 'center' }}>
          <div className="nw-card">
            <p className="err" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{err}</p>
          </div>
          <a className="nw-key nw-key--blue" href="/app" style={{ textDecoration: 'none' }}>
            Start over
          </a>
        </div>
      </main>
    );
  }

  // ── SUCCESS ──────────────────────────────────────────────────
  if (done) {
    return (
      <main>
        <div className="nw-screen">
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
            <div
              style={{
                width: 88,
                height: 88,
                borderRadius: 26,
                background: 'var(--green)',
                boxShadow: '0 8px 0 var(--green-dk), 0 16px 30px #1fc58640',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                animation: 'nwpop .5s ease both',
              }}
            >
              <svg width="42" height="42" viewBox="0 0 24 24">
                <path d="M5 12.5l4.5 4.5L19 7" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 30, letterSpacing: '-.02em', marginTop: 24 }}>
              You&apos;re all set 🎉
            </div>
            <div style={{ fontSize: 16, color: 'var(--muted)', marginTop: 8, maxWidth: 270, lineHeight: 1.45 }}>
              Your trading account is live on Sui and funded with test dUSDC.
            </div>

            {managerId && (
              <div className="nw-card" style={{ width: '100%', marginTop: 24, textAlign: 'left' }}>
                <div className="nw-mono" style={{ fontSize: 11, color: 'var(--muted2)', letterSpacing: '.04em' }}>MANAGER ID</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                  <span className="nw-mono" style={{ fontSize: 16, fontWeight: 700 }}>
                    {managerId.slice(0, 6)}…{managerId.slice(-4)}
                  </span>
                  <span className="nw-mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--green)' }}>10.00 dUSDC</span>
                </div>
              </div>
            )}
          </div>

          <div style={{ marginTop: 20 }}>
            <button className="nw-key nw-key--blue" onClick={backToTelegram}>
              Try your first trade <span style={{ fontSize: 20 }}>→</span>
            </button>
            <div style={{ textAlign: 'center', marginTop: 14, fontSize: 12.5, color: 'var(--muted2)' }} className="nw-mono">
              back in Telegram, just say <span style={{ color: 'var(--blue)' }}>“bet $1 BTC goes up”</span> or run{' '}
              <span style={{ color: 'var(--blue)' }}>/market</span>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // ── RUNNING ──────────────────────────────────────────────────
  return (
    <main>
      <div className="nw-screen">
        <div className="nw-kicker">// setting things up</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 28, letterSpacing: '-.02em', marginTop: 8, lineHeight: 1.08 }}>
          Building your
          <br />
          trading account
        </div>
        <div style={{ fontSize: 15, color: 'var(--muted)', marginTop: 10 }}>Hang tight — this is on us. We sponsor the gas.</div>

        <div style={{ marginTop: 30, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {STEP_LABELS.map((label, i) => {
            const isDone = i < stepIdx;
            const isActive = i === stepIdx;
            return (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 0' }}>
                <div style={{ width: 30, height: 30, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {isDone ? (
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="14" height="14" viewBox="0 0 16 16">
                        <path d="M3 8.5l3.5 3.5L13 4.5" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  ) : isActive ? (
                    <div style={{ width: 28, height: 28, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--blue)', animation: 'nwspin .8s linear infinite' }} />
                  ) : (
                    <div style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid #e0dbcf' }} />
                  )}
                </div>
                <div style={{ fontSize: 16, fontWeight: 600, color: isActive || isDone ? 'var(--ink)' : 'var(--muted2)' }}>{label}</div>
              </div>
            );
          })}
        </div>

        <div style={{ flex: 1 }} />
        <div className="nw-card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <svg width="18" height="18" viewBox="0 0 16 16" style={{ flex: 'none' }}>
            <path d="M8 1l5 2v4c0 3.5-2.2 6.6-5 7.6C5.2 13.6 3 10.5 3 7V3l5-2z" fill="#2f8fff15" stroke="#2f8fff" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
          <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.4 }}>
            Your keys never leave your device. Accounts are created gas-free.
          </div>
        </div>
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
