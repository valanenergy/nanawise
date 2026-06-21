'use client';

import { useEffect, useState } from 'react';
import { completeLogin } from '../../../../lib/zklogin';

/**
 * Google implicit-flow callback. The id_token arrives in the URL FRAGMENT
 * (#id_token=...&state=...), which never hits the server. We exchange it with Enoki
 * for the zkLogin address + proof (client-side), then continue to onboarding.
 */
export default function Callback() {
  const [status, setStatus] = useState('Finishing sign-in…');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const hash = new URLSearchParams(window.location.hash.slice(1));
        const jwt = hash.get('id_token');
        if (!jwt) throw new Error('No id_token returned from Google.');

        // Use the state we stored during sign-in (localStorage: survives the redirect
        // even if it lands in a different tab/webview), not the one echoed by Google.
        const state = localStorage.getItem('oauth-state') ?? 'web';

        setStatus('Deriving your wallet…');
        await completeLogin(jwt);
        window.location.href = `/miniapp/onboard?state=${encodeURIComponent(state)}`;
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
  }, []);

  return (
    <main>
      <div className="nw-screen" style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '26px 24px' }}>
        {err ? (
          <>
            <p className="err">{err}</p>
            <a className="nw-key nw-key--blue" href="/app" style={{ textDecoration: 'none', maxWidth: 280, marginTop: 16 }}>
              Try again
            </a>
          </>
        ) : (
          <>
            <div style={{ position: 'relative', width: 96, height: 96 }}>
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '50%',
                  border: '4px solid var(--border)',
                  borderTopColor: 'var(--blue)',
                  animation: 'nwspin .9s linear infinite',
                }}
              />
              <img
                src="/logo.png"
                alt="Nanawise"
                width={52}
                height={52}
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  boxShadow: '0 6px 0 var(--blue-dk)',
                  objectFit: 'cover',
                }}
              />
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24, marginTop: 30, letterSpacing: '-.01em' }}>
              {status}
            </div>
            <div style={{ fontSize: 14.5, color: 'var(--muted)', marginTop: 8, maxWidth: 260, lineHeight: 1.45 }}>
              Securely exchanging your Google sign-in for a self-custody wallet.
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 22 }}>
              {[0, 0.2, 0.4].map((d) => (
                <span key={d} style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--blue)', animation: `nwdot 1.2s infinite ${d}s` }} />
              ))}
            </div>
            <div className="nw-mono" style={{ marginTop: 30, fontSize: 11, color: 'var(--muted3)' }}>
              // no passwords · no seed phrase
            </div>
          </>
        )}
      </div>
    </main>
  );
}
