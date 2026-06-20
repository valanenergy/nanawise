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

        // Use the state we stored in sessionStorage during sign-in, not from Google
        const state = sessionStorage.getItem('oauth-state') ?? 'web';

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
      <div className="card">
        {err ? (
          <>
            <p className="err">{err}</p>
            <a className="btn" href="/">
              Try again
            </a>
          </>
        ) : (
          <>
            <div className="spinner" />
            <p className="muted" style={{ textAlign: 'center' }}>{status}</p>
          </>
        )}
      </div>
    </main>
  );
}
