'use client';

import { Suspense, useState } from 'react';
import { beginLogin, clearZk, getZkSession } from '../../lib/zklogin';
import { startOAuth } from '../../lib/api';

function GoogleMark() {
  return (
    <span
      style={{
        width: 24,
        height: 24,
        borderRadius: '50%',
        background:
          'conic-gradient(from -45deg,#4285F4 0deg 90deg,#34A853 90deg 180deg,#FBBC05 180deg 270deg,#EA4335 270deg 360deg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 'none',
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 12,
          color: '#4285F4',
        }}
      >
        G
      </span>
    </span>
  );
}

function Home() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const session = typeof window !== 'undefined' ? getZkSession() : null;

  async function signIn() {
    setBusy(true);
    setErr(null);
    try {
      let telegramId: string | undefined;
      if (typeof window !== 'undefined') {
        try {
          const tg = (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp;
          if (tg?.initData) {
            const initData = new URLSearchParams(tg.initData);
            const userJson = initData.get('user');
            if (userJson) telegramId = String(JSON.parse(userJson).id);
          }
        } catch {
          /* ignore */
        }
      }
      const { state } = await startOAuth(telegramId);
      localStorage.setItem('oauth-state', state);
      const url = await beginLogin(state);
      window.location.href = url;
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  function signOut() {
    clearZk();
    window.location.href = '/app';
  }

  // ── SIGNED IN ────────────────────────────────────────────────
  if (session) {
    return (
      <div className="nw-screen" style={{ padding: '8px 4px 12px' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <span className="nw-pill nw-pill--green" style={{ alignSelf: 'flex-start' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green)' }} />
            SIGNED IN
          </span>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 34, letterSpacing: '-.02em', marginTop: 18 }}>
            Welcome back.
          </div>
          <div style={{ fontSize: 16, color: 'var(--muted)', marginTop: 8 }}>Your zkLogin wallet is ready to go.</div>

          <div className="nw-card" style={{ marginTop: 24 }}>
            <div className="nw-mono" style={{ fontSize: 11, color: 'var(--muted2)', letterSpacing: '.04em' }}>WALLET ADDRESS</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
              <span className="nw-mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>
                {session.address.slice(0, 6)}…{session.address.slice(-4)}
              </span>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 22 }}>
          <a className="nw-key nw-key--blue" href="/miniapp/onboard" style={{ textDecoration: 'none' }}>
            Continue <span style={{ fontSize: 20 }}>→</span>
          </a>
          <button className="nw-ghost" onClick={signOut} style={{ marginTop: 10 }}>
            Sign out &amp; switch account
          </button>
        </div>
      </div>
    );
  }

  // ── SIGNED OUT ───────────────────────────────────────────────
  return (
    <div
      className="nw-screen"
      style={{ padding: '8px 4px 12px', backgroundImage: 'radial-gradient(#2f8fff10 1px,transparent 1px)', backgroundSize: '22px 22px' }}
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start' }}>
        <div className="nw-kicker">// say it. trade it.</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 42, lineHeight: 1.0, letterSpacing: '-.025em', marginTop: 14 }}>
          Bet on what
          <br />
          happens next.
        </div>
        <div style={{ fontSize: 16, color: 'var(--muted)', marginTop: 16, lineHeight: 1.45, maxWidth: 290 }}>
          Type a hunch in plain English. We turn it into a real on-chain prediction trade — no jargon, no seed phrase.
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 22, flexWrap: 'wrap' }}>
          <span className="nw-pill nw-pill--chip">“BTC above $72k by 5pm”</span>
          <span className="nw-pill nw-pill--chip">“ETH dips today”</span>
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <button className="nw-key nw-key--white" onClick={signIn} disabled={busy}>
          <GoogleMark />
          {busy ? 'Opening Google…' : 'Sign in with Google'}
          <span className="nw-sheen" />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, fontSize: 12.5, color: 'var(--muted2)' }}>
          <svg width="13" height="13" viewBox="0 0 16 16">
            <path d="M8 1l5 2v4c0 3.5-2.2 6.6-5 7.6C5.2 13.6 3 10.5 3 7V3l5-2z" fill="none" stroke="#1fc586" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M5.6 8l1.7 1.7L10.6 6" stroke="#1fc586" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Self-custody wallet · powered by zkLogin
        </div>
        {err && <p className="err" style={{ textAlign: 'center', marginTop: 12 }}>{err}</p>}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <main>
      <Suspense fallback={<div className="spinner" />}>
        <Home />
      </Suspense>
    </main>
  );
}
