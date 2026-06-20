'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { beginLogin, getZkSession } from '../lib/zklogin';

function Home() {
  const params = useSearchParams();
  const state = params.get('state') ?? 'web';
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const session = typeof window !== 'undefined' ? getZkSession() : null;

  async function signIn() {
    setBusy(true);
    setErr(null);
    try {
      const url = await beginLogin(state);
      window.location.href = url;
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      {session ? (
        <div className="card">
          <div className="row">
            <span className="muted">Signed in</span>
            <span>
              {session.address.slice(0, 6)}…{session.address.slice(-4)}
            </span>
          </div>
          <a className="btn" href="/miniapp/onboard">
            Continue →
          </a>
        </div>
      ) : (
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>
            Your wallet is created from your Google account and lives in this device&apos;s session — we
            never hold your keys.
          </p>
          <button className="btn" onClick={signIn} disabled={busy}>
            {busy ? 'Opening Google…' : '🔐 Sign in with Google'}
          </button>
          {err && <p className="err">{err}</p>}
        </div>
      )}
    </>
  );
}

export default function Page() {
  return (
    <main>
      {/* Brand renders immediately; the search-param-dependent flow is suspended below. */}
      <h1 style={{ fontSize: 30, marginBottom: 4 }}>Nanawise</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Trade BTC up or down on DeepBook Predict. No seed phrase. No gas. Just Google.
      </p>
      <Suspense fallback={<div className="spinner" />}>
        <Home />
      </Suspense>
    </main>
  );
}
