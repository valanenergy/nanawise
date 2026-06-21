'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Landing (/) — long marketing page in the Sui-Overflow design, with the hero
 * "morphing device" that auto-plays the real app flow (sign-in → onboard → trade)
 * and rotates iPhone → iPad → Mac. Ported 1:1 from the Nanawise Auth design comp.
 * The bare mini-app the Telegram bot opens lives at /app.
 */

const GREEN = '#1fc586', GREEN_D = '#149e69';
const RED = '#ff6a5d';
const BLUE = '#2f8fff', BLUE_D = '#1f6fe0';
const YELLOW = '#ffc83d', YELLOW_D = '#e0a800';
const PURPLE = '#9b7cf0', PURPLE_D = '#7a55e0';

interface DemoState {
  device: 'phone' | 'tablet' | 'mac';
  screen: 'homeOut' | 'homeIn' | 'oauth' | 'onboard' | 'trade';
  oauthStep: number;
  onboardStep: number;
  onboardDone: boolean;
  trade: 'preview' | 'submitting' | 'done';
}

const SIZES: Record<DemoState['device'], [number, number]> = { phone: [384, 812], tablet: [560, 740], mac: [780, 520] };

function GoogleMark() {
  return (
    <span style={{ width: 23, height: 23, borderRadius: '50%', background: 'conic-gradient(from -45deg,#4285F4 0deg 90deg,#34A853 90deg 180deg,#FBBC05 180deg 270deg,#EA4335 270deg 360deg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
      <span style={{ width: 15, height: 15, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 11, color: '#4285F4' }}>G</span>
    </span>
  );
}

/** The mini-app screens rendered inside the device, driven by demo state. */
function AppScreens({ s, cb }: { s: DemoState; cb: { signIn: () => void; continueOnboard: () => void; signOut: () => void; tryTrade: () => void; confirmTrade: () => void; backHome: () => void } }) {
  const oauthMsg = ['Finishing sign-in…', 'Deriving your wallet…'][s.oauthStep] ?? 'Finishing sign-in…';
  const steps = ['Preparing your session', 'Creating your trading account on Sui', 'Adding test funds to get you started'].map((label, i) => ({
    label, isDone: s.onboardDone || i < s.onboardStep, isActive: !s.onboardDone && i === s.onboardStep,
  }));
  const wrap: React.CSSProperties = { position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' };

  // telegram mini-app header (shared)
  const header = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px 12px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src="/logo.png" alt="Nanawise" style={{ width: 32, height: 32, borderRadius: '50%', boxShadow: `0 4px 0 ${BLUE_D}`, objectFit: 'cover' }} />
        <div style={{ lineHeight: 1.1 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14.5 }}>Nanawise</div>
          <div className="nw-mono" style={{ fontSize: 10.5, color: 'var(--muted2)' }}>mini app · bot</div>
        </div>
      </div>
      <svg width="18" height="5" viewBox="0 0 20 5"><circle cx="2.5" cy="2.5" r="2.2" fill="#5c6573" /><circle cx="10" cy="2.5" r="2.2" fill="#5c6573" /><circle cx="17.5" cy="2.5" r="2.2" fill="#5c6573" /></svg>
    </div>
  );

  let body: ReactNode = null;
  if (s.screen === 'homeOut') {
    body = (
      <div key="ho" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '22px 22px 26px', animation: 'nwfade .4s ease both', backgroundImage: 'radial-gradient(#2f8fff10 1px,transparent 1px)', backgroundSize: '22px 22px' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start' }}>
          <div className="nw-kicker">// say it. trade it.</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 36, lineHeight: 1.0, letterSpacing: '-.025em', marginTop: 12 }}>Bet on what<br />happens next.</div>
          <div style={{ fontSize: 15, color: 'var(--muted)', marginTop: 14, lineHeight: 1.45, maxWidth: 280 }}>Type a hunch in plain English. We turn it into a real on-chain prediction trade — no jargon, no seed phrase.</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
            <span className="nw-pill nw-pill--chip" style={{ fontSize: 11.5 }}>“BTC above $72k by 5pm”</span>
            <span className="nw-pill nw-pill--chip" style={{ fontSize: 11.5 }}>“ETH dips today”</span>
          </div>
        </div>
        <div style={{ marginTop: 20 }}>
          <button className="nw-key nw-key--white" style={{ height: 56 }} onClick={cb.signIn}><GoogleMark /> Sign in with Google<span className="nw-sheen" /></button>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 13, fontSize: 12, color: 'var(--muted2)' }}>
            <svg width="13" height="13" viewBox="0 0 16 16"><path d="M8 1l5 2v4c0 3.5-2.2 6.6-5 7.6C5.2 13.6 3 10.5 3 7V3l5-2z" fill="none" stroke="#1fc586" strokeWidth="1.5" strokeLinejoin="round" /><path d="M5.6 8l1.7 1.7L10.6 6" stroke="#1fc586" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Self-custody wallet · powered by zkLogin
          </div>
        </div>
      </div>
    );
  } else if (s.screen === 'oauth') {
    body = (
      <div key="oa" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '26px 30px', animation: 'nwfade .4s ease both' }}>
        <div style={{ position: 'relative', width: 92, height: 92 }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '4px solid var(--border)', borderTopColor: BLUE, animation: 'nwspin .9s linear infinite' }} />
          <img src="/logo.png" alt="Nanawise" width={50} height={50} style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 50, height: 50, borderRadius: '50%', boxShadow: `0 6px 0 ${BLUE_D}`, objectFit: 'cover' }} />
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 23, marginTop: 28 }}>{oauthMsg}</div>
        <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 8, maxWidth: 250, lineHeight: 1.45 }}>Securely exchanging your Google sign-in for a self-custody wallet.</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 20 }}>{[0, 0.2, 0.4].map((d) => <span key={d} style={{ width: 8, height: 8, borderRadius: '50%', background: BLUE, animation: `nwdot 1.2s infinite ${d}s` }} />)}</div>
      </div>
    );
  } else if (s.screen === 'onboard' && !s.onboardDone) {
    body = (
      <div key="onr" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '26px 24px', animation: 'nwfade .4s ease both' }}>
        <div className="nw-kicker">// setting things up</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26, letterSpacing: '-.02em', marginTop: 8, lineHeight: 1.08 }}>Building your<br />trading account</div>
        <div style={{ fontSize: 14.5, color: 'var(--muted)', marginTop: 10 }}>Hang tight — this is on us. We sponsor the gas.</div>
        <div style={{ marginTop: 26, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {steps.map((st) => (
            <div key={st.label} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 0' }}>
              <div style={{ width: 30, height: 30, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {st.isDone ? <div style={{ width: 28, height: 28, borderRadius: '50%', background: GREEN, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="14" height="14" viewBox="0 0 16 16"><path d="M3 8.5l3.5 3.5L13 4.5" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
                  : st.isActive ? <div style={{ width: 28, height: 28, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: BLUE, animation: 'nwspin .8s linear infinite' }} />
                    : <div style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid #e0dbcf' }} />}
              </div>
              <div style={{ fontSize: 15.5, fontWeight: 600, color: 'var(--ink)' }}>{st.label}</div>
            </div>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <div className="nw-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px' }}>
          <svg width="18" height="18" viewBox="0 0 16 16" style={{ flex: 'none' }}><path d="M8 1l5 2v4c0 3.5-2.2 6.6-5 7.6C5.2 13.6 3 10.5 3 7V3l5-2z" fill="#2f8fff15" stroke="#2f8fff" strokeWidth="1.4" strokeLinejoin="round" /></svg>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.4 }}>Your keys never leave your device. Accounts are created gas-free.</div>
        </div>
      </div>
    );
  } else if (s.screen === 'onboard' && s.onboardDone) {
    body = (
      <div key="ons" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '26px 24px', animation: 'nwfade .4s ease both' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ width: 84, height: 84, borderRadius: 26, background: GREEN, boxShadow: `0 8px 0 ${GREEN_D}, 0 16px 30px #1fc58640`, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'nwpop .5s ease both' }}>
            <svg width="40" height="40" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 28, letterSpacing: '-.02em', marginTop: 22 }}>You&apos;re all set 🎉</div>
          <div style={{ fontSize: 15, color: 'var(--muted)', marginTop: 8, maxWidth: 270, lineHeight: 1.45 }}>Your trading account is live on Sui and funded with test dUSDC.</div>
          <div className="nw-card" style={{ width: '100%', marginTop: 22, textAlign: 'left' }}>
            <div className="nw-mono" style={{ fontSize: 11, color: 'var(--muted2)' }}>MANAGER ID</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
              <span className="nw-mono" style={{ fontSize: 16, fontWeight: 700 }}>0x7be2…0a14</span>
              <span className="nw-mono" style={{ fontSize: 14, fontWeight: 700, color: GREEN }}>25.00 dUSDC</span>
            </div>
          </div>
        </div>
        <button className="nw-key nw-key--blue" style={{ height: 56 }} onClick={cb.tryTrade}>Try your first trade <span style={{ fontSize: 20 }}>→</span></button>
      </div>
    );
  } else if (s.screen === 'trade' && s.trade === 'preview') {
    body = (
      <div key="tp" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '20px 22px 24px', animation: 'nwfade .4s ease both' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="nw-pill nw-pill--green" style={{ fontWeight: 700 }}>
            <svg width="13" height="13" viewBox="0 0 16 16"><path d="M8 3v10M8 3l-4 4M8 3l4 4" stroke="#0f8a5a" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>UP · BTC
          </span>
          <span className="nw-mono" style={{ fontSize: 12, color: 'var(--muted2)' }}>expires 5:00 PM</span>
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 25, letterSpacing: '-.02em', marginTop: 14, lineHeight: 1.12 }}>BTC closes <span style={{ color: GREEN }}>above $72,000</span> by 5 PM today</div>
        <div className="nw-mono" style={{ fontSize: 13.5, color: 'var(--muted2)', marginTop: 6 }}>you said: “bitcoin goes up before close”</div>
        <div className="nw-card" style={{ marginTop: 14, padding: 0, overflow: 'hidden' }}>
          {[['You pay', '5.00', 'var(--ink)'], ['Max payout', '12.40', GREEN]].map(([k, v, c], idx) => (
            <div key={k}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px' }}>
                <span style={{ fontSize: 14.5, color: 'var(--muted)' }}>{k}</span>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, color: c as string }}>{v} <span style={{ color: 'var(--muted2)', fontSize: 13, fontWeight: 600 }}>dUSDC</span></span>
              </div>
              {idx === 0 && <div style={{ height: 1, background: '#f0ece2' }} />}
            </div>
          ))}
          <div style={{ height: 1, background: '#f0ece2' }} />
          <div style={{ padding: '14px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14.5, color: 'var(--muted)' }}>Implied probability</span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17 }}>41%</span>
            </div>
            <div style={{ height: 8, borderRadius: 5, background: '#f0ece2', marginTop: 10, overflow: 'hidden' }}><div style={{ height: '100%', width: '41%', borderRadius: 5, background: 'linear-gradient(90deg,#2f8fff,#1fc586)' }} /></div>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 12 }} />
        <button className="nw-key nw-key--green" onClick={cb.confirmTrade}>
          <svg width="18" height="18" viewBox="0 0 16 16"><path d="M8 3v10M8 3l-4 4M8 3l4 4" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>Confirm &amp; sign
        </button>
      </div>
    );
  } else if (s.screen === 'trade' && s.trade === 'submitting') {
    body = (
      <div key="ts" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '26px 30px', animation: 'nwfade .4s ease both' }}>
        <div style={{ position: 'relative', width: 92, height: 92 }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '4px solid var(--border)', borderTopColor: GREEN, animation: 'nwspin .9s linear infinite' }} />
          <div style={{ position: 'absolute', inset: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="38" height="38" viewBox="0 0 16 16"><path d="M8 3v10M8 3l-4 4M8 3l4 4" stroke={GREEN} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 23, marginTop: 28 }}>Signing &amp; submitting…</div>
        <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 8, maxWidth: 240, lineHeight: 1.45 }}>Depositing and minting your position on Sui.</div>
        <div className="nw-mono" style={{ marginTop: 22, fontSize: 12, color: 'var(--muted3)' }}>deposit ✓  mint …</div>
      </div>
    );
  } else {
    body = (
      <div key="td" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '26px 24px', animation: 'nwfade .4s ease both' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ width: 84, height: 84, borderRadius: 26, background: GREEN, boxShadow: `0 8px 0 ${GREEN_D}, 0 16px 30px #1fc58640`, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'nwpop .5s ease both' }}>
            <svg width="40" height="40" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 28, letterSpacing: '-.02em', marginTop: 22 }}>Position is live ✅</div>
          <div style={{ fontSize: 15, color: 'var(--muted)', marginTop: 8, maxWidth: 260, lineHeight: 1.45 }}>You&apos;re betting BTC closes above $72,000. We&apos;ll ping you in Telegram at settlement.</div>
          <div className="nw-card" style={{ width: '100%', marginTop: 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ textAlign: 'left' }}><div className="nw-mono" style={{ fontSize: 11, color: 'var(--muted2)' }}>YOUR POSITION</div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, marginTop: 4, color: '#0f8a5a' }}>UP · 5.00 dUSDC</div></div>
            <div style={{ textAlign: 'right' }}><div className="nw-mono" style={{ fontSize: 11, color: 'var(--muted2)' }}>MAX PAYOUT</div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, marginTop: 4 }}>12.40 dUSDC</div></div>
          </div>
        </div>
        <button className="nw-key nw-key--ink" onClick={cb.backHome}>View transaction <svg width="15" height="15" viewBox="0 0 16 16"><path d="M5 11L11 5M11 5H6M11 5v5" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      {header}
      <div style={wrap}>{body}</div>
    </div>
  );
}

export default function Landing() {
  const [s, setS] = useState<DemoState>({ device: 'phone', screen: 'homeOut', oauthStep: 0, onboardStep: 0, onboardDone: false, trade: 'preview' });
  const userControl = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const centerRef = useRef<HTMLDivElement>(null);
  const deviceRotation = useRef(0);
  const pinned = useRef(false); // ?device= override pins one device (for screenshots/QA)
  const devices: DemoState['device'][] = ['phone', 'tablet', 'mac'];
  // Scale is React STATE (not an imperative style) so it survives the demo's frequent
  // re-renders — otherwise React keeps resetting transform/size and the device overflows.
  const [scale, setScale] = useState(0.5);

  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const later = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)); };
  const patch = (p: Partial<DemoState>) => setS((x) => ({ ...x, ...p }));

  const fit = useCallback(() => {
    const center = centerRef.current;
    if (!center) return;
    const [nw, nh] = SIZES[s.device];
    const mobile = window.innerWidth < 900;
    const colW = (center.clientWidth || 460) - 16;
    // Reserve room for nav + the device-indicator pill + breathing room so the
    // device always fits; smaller cap on mobile so it never dominates / clips.
    const availH = window.innerHeight - (mobile ? 170 : 290);
    const cap = mobile ? 0.46 : 0.68;
    setScale(Math.max(0.28, Math.min(colW / nw, availH / nh, cap)));
  }, [s.device]);

  // auto-play demo loop
  useEffect(() => {
    // ?device=phone|tablet|mac pins one device (QA/screenshots), pausing rotation.
    const dev = new URLSearchParams(window.location.search).get('device');
    if (dev === 'phone' || dev === 'tablet' || dev === 'mac') { pinned.current = true; patch({ device: dev }); }

    const seq: [Partial<DemoState>, number][] = [
      [{ screen: 'homeOut' }, 1900], [{ screen: 'oauth', oauthStep: 0 }, 1200], [{ oauthStep: 1 }, 1400],
      [{ screen: 'onboard', onboardStep: 0, onboardDone: false }, 1100], [{ onboardStep: 1 }, 1200], [{ onboardStep: 2 }, 1300], [{ onboardStep: 3, onboardDone: true }, 2200],
      [{ screen: 'trade', trade: 'preview' }, 2600], [{ trade: 'submitting' }, 1800], [{ trade: 'done' }, 2400],
    ];
    let i = 0;
    const tick = () => {
      if (userControl.current) return;
      patch(seq[i]![0]);
      const ms = seq[i]![1];
      i++;
      if (i >= seq.length) { i = 0; if (!pinned.current) { deviceRotation.current = (deviceRotation.current + 1) % 3; patch({ device: devices[deviceRotation.current] }); } }
      timers.current.push(setTimeout(tick, ms));
    };
    tick();
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // scale-to-fit on mount, resize, and device change
  useEffect(() => {
    fit();
    const t1 = setTimeout(fit, 60), t2 = setTimeout(fit, 300);
    window.addEventListener('resize', fit);
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener('resize', fit); };
  }, [fit]);

  const takeOver = () => { userControl.current = true; clear(); };
  const startOAuth = () => { clear(); patch({ screen: 'oauth', oauthStep: 0 }); later(() => patch({ oauthStep: 1 }), 1200); later(() => startOnboard(), 2500); };
  const startOnboard = () => { clear(); patch({ screen: 'onboard', onboardStep: 0, onboardDone: false }); later(() => patch({ onboardStep: 1 }), 1200); later(() => patch({ onboardStep: 2 }), 2500); later(() => patch({ onboardStep: 3, onboardDone: true }), 3900); };
  const confirmTrade = () => { clear(); patch({ screen: 'trade', trade: 'submitting' }); later(() => patch({ trade: 'done' }), 2100); };
  const wrapCb = (fn: () => void) => () => { takeOver(); fn(); };
  const cb = {
    signIn: wrapCb(startOAuth), continueOnboard: wrapCb(startOnboard), signOut: wrapCb(() => patch({ screen: 'homeOut' })),
    tryTrade: wrapCb(() => patch({ screen: 'trade', trade: 'preview' })), confirmTrade: wrapCb(confirmTrade), backHome: wrapCb(() => patch({ screen: 'homeOut' })),
  };

  // Platform switcher: pick a device and pin it so the auto-rotation stops fighting
  // the user's choice (the screen demo keeps playing on the chosen device).
  const pickDevice = (d: DemoState['device']) => { pinned.current = true; patch({ device: d }); };

  const screens = <AppScreens s={s} cb={cb} />;

  // device frame around the app screens
  let frame: ReactNode;
  if (s.device === 'phone') {
    frame = (
      <div style={{ width: 384, height: 812, borderRadius: 54, background: '#0c0c0e', padding: 11, boxShadow: '0 40px 90px rgba(13,20,36,.28), 0 0 0 1px rgba(13,20,36,.10)', position: 'relative' }}>
        <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 44, overflow: 'hidden', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ position: 'absolute', top: 9, left: '50%', transform: 'translateX(-50%)', width: 108, height: 32, borderRadius: 20, background: '#000', zIndex: 60 }} />
          <div style={{ position: 'relative', zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 26px 6px', flex: 'none' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15 }}>9:41</span>
            <div style={{ display: 'flex', gap: 6 }}><svg width="18" height="11" viewBox="0 0 18 11"><rect x="0" y="7" width="3" height="4" rx="1" fill="#0d1424" /><rect x="5" y="4.5" width="3" height="6.5" rx="1" fill="#0d1424" /><rect x="10" y="2" width="3" height="9" rx="1" fill="#0d1424" /><rect x="15" y="0" width="3" height="11" rx="1" fill="#0d1424" /></svg></div>
          </div>
          <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex' }}>{screens}</div>
          <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', width: 130, height: 5, borderRadius: 100, background: '#0d142440', zIndex: 60 }} />
        </div>
      </div>
    );
  } else if (s.device === 'tablet') {
    frame = (
      <div style={{ width: 560, height: 740, borderRadius: 42, background: '#0c0c0e', padding: 18, boxShadow: '0 40px 90px rgba(13,20,36,.28), 0 0 0 1px rgba(13,20,36,.10)', position: 'relative' }}>
        <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 26, overflow: 'hidden', display: 'flex' }}>{screens}</div>
      </div>
    );
  } else {
    frame = (
      <div style={{ width: 780, height: 520, borderRadius: 16, background: '#fff', border: '1px solid #d8d2c4', overflow: 'hidden', boxShadow: '0 40px 90px rgba(13,20,36,.28)', position: 'relative' }}>
        <div style={{ height: 40, background: '#e9e5da', borderBottom: '1px solid #ddd6c7', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 8 }}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => <span key={c} style={{ width: 12, height: 12, borderRadius: '50%', background: c }} />)}
          <span style={{ flex: 1, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted2)' }}>Nanawise · Telegram Desktop</span>
          <span style={{ width: 44 }} />
        </div>
        <div style={{ height: 480, display: 'flex' }}>{screens}</div>
      </div>
    );
  }

  const annot = [
    { c: GREEN, lip: GREEN_D, ink: '#06321f', t: 'Say it like you mean it', b: '“BTC above $72k by 5pm” becomes a real market order.', tag: '// natural language', glyph: '“' },
    { c: BLUE, lip: BLUE_D, ink: '#fff', t: 'No seed phrase, ever', b: 'Sign in with Google. zkLogin gives you a self-custody wallet.', tag: '// zkLogin', glyph: '⛨' },
    { c: YELLOW, lip: YELLOW_D, ink: '#4a3500', t: 'Gas is on us', b: 'Every account and trade is sponsored. Settles on Sui in seconds.', tag: '// sponsored', glyph: '⚡' },
  ];
  const features = [
    { title: 'Plain-English trading', body: 'No order books, no Greeks. Describe the outcome; we build the trade.', color: GREEN, lip: GREEN_D, ink: '#06321f', glyph: '“' },
    { title: 'Self-custody by default', body: 'zkLogin keeps your keys on your device. We never hold your funds.', color: BLUE, lip: BLUE_D, ink: '#fff', glyph: '⛨' },
    { title: 'Gas sponsored', body: 'Account creation and every trade is paid for. Start with zero SUI.', color: YELLOW, lip: YELLOW_D, ink: '#4a3500', glyph: '⚡' },
    { title: 'Settles on Sui in seconds', body: 'Positions mint instantly and resolve on-chain — fully verifiable.', color: PURPLE, lip: PURPLE_D, ink: '#fff', glyph: '⤳' },
  ];
  const up = { side: 'UP', fg: '#0f8a5a', pill: '#1fc58618', spark: 'M0,20 L12,16 L24,18 L36,9 L48,11 L60,3' };
  const dn = { side: 'DOWN', fg: '#d0392e', pill: '#f0463a18', spark: 'M0,4 L12,8 L24,6 L36,15 L48,13 L60,21' };
  const markets = [
    { tkr: 'BTC', tbg: YELLOW, tlip: YELLOW_D, tink: '#4a3500', phrase: 'Bitcoin above $72k by 5pm', expiry: 'expires today · 5:00 PM', prob: '41%', ...up },
    { tkr: 'ETH', tbg: PURPLE, tlip: PURPLE_D, tink: '#fff', phrase: 'Ether dips before the close', expiry: 'expires today · 8:00 PM', prob: '58%', ...dn },
    { tkr: 'SUI', tbg: BLUE, tlip: BLUE_D, tink: '#fff', phrase: 'SUI tops $5 this week', expiry: 'expires Fri · 12:00 PM', prob: '33%', ...up },
    { tkr: 'SOL', tbg: GREEN, tlip: GREEN_D, tink: '#06321f', phrase: 'Solana red on the day', expiry: 'expires today · 11:59 PM', prob: '47%', ...dn },
  ];

  return (
    <div style={{ position: 'relative', width: '100%', overflowX: 'hidden' }}>
      {/* NAV */}
      <div style={{ position: 'sticky', top: 0, zIndex: 100, background: '#f4f1eaee', backdropFilter: 'blur(10px)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <img src="/logo.png" alt="Nanawise" style={{ width: 32, height: 32, borderRadius: '50%', boxShadow: `0 4px 0 ${BLUE_D}`, objectFit: 'cover' }} />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19 }}>Nanawise</span>
          </div>
          <div className="nw-nav-links" style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--muted)' }}>
            <a href="#how" style={{ color: 'var(--muted)', textDecoration: 'none' }}>How it works</a>
            <a href="#why" style={{ color: 'var(--muted)', textDecoration: 'none' }}>Why Nanawise</a>
            <a href="#markets" style={{ color: 'var(--muted)', textDecoration: 'none' }}>Markets</a>
            <Link href="/pitch" style={{ color: 'var(--muted)', textDecoration: 'none' }}>Pitch</Link>
          </div>
          <Link href="/app" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--ink)', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, padding: '11px 18px', borderRadius: 11, boxShadow: '0 4px 0 #00000030' }}>Open app →</Link>
        </div>
      </div>

      {/* HERO */}
      <div data-hero className="nw-hero" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 26, maxWidth: 1240, margin: '0 auto', padding: '20px 28px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 300px', maxWidth: 360 }}>
          <span className="nw-pill nw-pill--chip"><span style={{ width: 7, height: 7, borderRadius: '50%', background: GREEN, boxShadow: '0 0 0 3px #1fc58633' }} /> live on Sui testnet</span>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 50, lineHeight: 0.98, letterSpacing: '-.03em', margin: '16px 0 0' }}>Trade what<br />you think,<br />in plain<br /><span style={{ color: BLUE }}>words.</span></h1>
          <p style={{ fontSize: 16.5, color: 'var(--muted)', lineHeight: 1.5, margin: '18px 0 0', maxWidth: 340 }}>Nanawise turns a sentence into a real on-chain prediction trade. No charts to decode, no seed phrase, no gas. If your nana can text, she can trade.</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 24 }}>
            <Link href="/app" className="nw-key nw-key--blue" style={{ width: 'auto', padding: '0 22px', textDecoration: 'none' }}>Start trading →</Link>
            <a href="#how" style={{ textDecoration: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 16, color: 'var(--ink)', padding: '15px 8px' }}>See how →</a>
          </div>
        </div>

        {/* morphing device */}
        <div ref={centerRef} style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <div data-device style={{ position: 'relative', width: SIZES[s.device][0] * scale, height: SIZES[s.device][1] * scale }}>
            {/* scale ONLY here — no transform-animation (nwfade animates transform and
                would clobber this scale, making the device render at native size). */}
            <div style={{ transformOrigin: 'top left', transform: `scale(${scale})` }}>{frame}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#fff', border: '1px solid var(--border)', borderRadius: 999, padding: '5px 6px', boxShadow: '0 4px 14px #0d14240f' }}>
            <span className="nw-mono" style={{ fontSize: 10.5, color: 'var(--muted3)', padding: '0 4px 0 8px' }}>view on</span>
            {([['phone', 'iPhone'], ['tablet', 'iPad'], ['mac', 'Mac']] as const).map(([k, l]) => (
              <button
                key={k}
                type="button"
                onClick={() => pickDevice(k)}
                aria-pressed={s.device === k}
                style={{
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-display)',
                  fontWeight: 600,
                  fontSize: 12,
                  padding: '6px 13px',
                  borderRadius: 999,
                  background: s.device === k ? BLUE : 'transparent',
                  color: s.device === k ? '#fff' : 'var(--muted2)',
                  transition: 'background .15s ease, color .15s ease',
                }}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        {/* annotation cards */}
        <div className="nw-hero-cards" style={{ flex: '1 1 240px', maxWidth: 280 }}>
          {annot.map((a) => (
            <div key={a.t} style={{ position: 'relative', overflow: 'hidden', background: '#fff', border: '1px solid var(--border)', borderRadius: 18, padding: 18, boxShadow: '0 6px 18px #0d14240e' }}>
              <div style={{ position: 'absolute', right: -26, top: -26, width: 96, height: 96, borderRadius: '50%', background: a.c, opacity: 0.13, filter: 'blur(8px)' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }}>
                <div style={{ width: 42, height: 42, flex: 'none', borderRadius: 12, background: a.c, boxShadow: `0 5px 0 ${a.lip}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, color: a.ink }}>{a.glyph}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, lineHeight: 1.1 }}>{a.t}</div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 11, lineHeight: 1.45, position: 'relative' }}>{a.b}</div>
              <div className="nw-mono" style={{ fontSize: 10, color: a.c, marginTop: 10, position: 'relative' }}>{a.tag}</div>
            </div>
          ))}
        </div>
      </div>

      {/* HOW IT WORKS */}
      <div id="how" style={{ maxWidth: 1120, margin: '0 auto', padding: '70px 28px 30px' }}>
        <div className="nw-kicker" style={{ fontSize: 13 }}>// how it works</div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'clamp(28px,4vw,40px)', letterSpacing: '-.02em', margin: '10px 0 0', maxWidth: 600, lineHeight: 1.05 }}>From a sentence to an on-chain trade in three taps.</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 22, marginTop: 40 }}>
          {[['01', 'Say it', 'Tell the bot what you think will happen, in plain English. We parse the market, strike and expiry for you.', GREEN, GREEN_D, '#06321f'],
            ['02', 'Sign in once', 'Google sign-in spins up a self-custody zkLogin wallet and a gas-free trading account on Sui.', BLUE, BLUE_D, '#fff'],
            ['03', 'Confirm & trade', 'Review payout and odds, hit confirm. Your position is minted on-chain and settles automatically.', YELLOW, YELLOW_D, '#4a3500']].map(([n, t, b, c, lip, ink]) => (
            <div key={n} style={{ position: 'relative', overflow: 'hidden', background: '#fff', border: '1px solid var(--border)', borderRadius: 20, padding: 26, boxShadow: '0 6px 18px #0d14240c' }}>
              <div style={{ position: 'absolute', right: 14, bottom: 6, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 84, color: c as string, opacity: 0.09, lineHeight: 1 }}>{n}</div>
              <div style={{ width: 56, height: 56, borderRadius: 15, background: c as string, boxShadow: `0 7px 0 ${lip}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: ink as string, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24, position: 'relative' }}>{n}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 21, marginTop: 22, position: 'relative' }}>{t}</div>
              <div style={{ fontSize: 15, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5, position: 'relative' }}>{b}</div>
            </div>
          ))}
        </div>
      </div>

      {/* WHY */}
      <div id="why" style={{ maxWidth: 1120, margin: '0 auto', padding: '50px 28px 30px' }}>
        <div className="nw-kicker" style={{ fontSize: 13 }}>// why nanawise</div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'clamp(28px,4vw,40px)', letterSpacing: '-.02em', margin: '10px 0 40px', maxWidth: 560, lineHeight: 1.05 }}>All the power of on-chain markets. None of the homework.</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 18 }}>
          {features.map((f) => (
            <div key={f.title} style={{ position: 'relative', overflow: 'hidden', background: '#fff', border: '1px solid var(--border)', borderRadius: 18, padding: 24, display: 'flex', gap: 16, boxShadow: '0 6px 18px #0d14240c' }}>
              <div style={{ position: 'absolute', right: -28, top: -28, width: 104, height: 104, borderRadius: '50%', background: f.color, opacity: 0.12, filter: 'blur(7px)' }} />
              <div style={{ width: 48, height: 48, flex: 'none', borderRadius: 13, background: f.color, boxShadow: `0 6px 0 ${f.lip}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: f.ink, position: 'relative' }}>{f.glyph}</div>
              <div style={{ position: 'relative' }}><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>{f.title}</div><div style={{ fontSize: 14.5, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>{f.body}</div></div>
            </div>
          ))}
        </div>
      </div>

      {/* MARKETS */}
      <div id="markets" style={{ maxWidth: 1120, margin: '0 auto', padding: '50px 28px 30px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div className="nw-kicker" style={{ fontSize: 13 }}>// trending markets</div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'clamp(28px,4vw,40px)', letterSpacing: '-.02em', margin: '10px 0 0' }}>What people are saying.</h2>
          </div>
          <div className="nw-mono" style={{ fontSize: 12, color: 'var(--muted2)' }}>prices update live · testnet</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 14, marginTop: 30 }}>
          {markets.map((m) => (
            <div key={m.phrase} style={{ position: 'relative', overflow: 'hidden', background: '#fff', border: '1px solid var(--border)', borderRadius: 16, padding: '18px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, boxShadow: '0 6px 18px #0d14240c' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                <div style={{ width: 46, height: 46, flex: 'none', borderRadius: 12, background: m.tbg, boxShadow: `0 5px 0 ${m.tlip}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: m.tink }}>{m.tkr}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.phrase}</div>
                  <div className="nw-mono" style={{ fontSize: 11, color: 'var(--muted3)', marginTop: 3 }}>{m.expiry}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 'none' }}>
                <svg viewBox="0 0 60 24" style={{ width: 54, height: 24, overflow: 'visible' }}><path d={m.spark} fill="none" stroke={m.fg} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: m.fg }}>{m.prob}</div>
                  <div className="nw-mono" style={{ display: 'inline-flex', alignItems: 'center', background: m.pill, borderRadius: 999, padding: '2px 8px', marginTop: 2, fontSize: 10, fontWeight: 700, color: m.fg }}>{m.side}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA BAND */}
      <div style={{ maxWidth: 1120, margin: '60px auto 0', padding: '0 28px' }}>
        <div style={{ position: 'relative', overflow: 'hidden', background: 'var(--ink)', borderRadius: 28, padding: '56px 40px', textAlign: 'center' }}>
          <div style={{ position: 'absolute', left: 36, top: 34, width: 64, height: 64, borderRadius: 14, background: GREEN, boxShadow: `0 7px 0 ${GREEN_D}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#06321f', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 28, transform: 'rotate(-12deg)' }}>↑</div>
          <div style={{ position: 'absolute', right: 40, bottom: 34, width: 60, height: 60, borderRadius: 13, background: BLUE, boxShadow: `0 7px 0 ${BLUE_D}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26, transform: 'rotate(10deg)' }}>N</div>
          <div className="nw-mono" style={{ fontSize: 13, color: '#4da2ff' }}>// your first trade is on us</div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'clamp(30px,5vw,46px)', letterSpacing: '-.02em', color: '#fff', margin: '14px auto 0', maxWidth: 620, lineHeight: 1.04 }}>If you can text it, you can trade it.</h2>
          <p style={{ fontSize: 17, color: '#aab4c4', margin: '16px auto 0', maxWidth: 440, lineHeight: 1.5 }}>Open Nanawise and place your first prediction in under a minute.</p>
          <Link href="/app" className="nw-key nw-key--blue" style={{ width: 'auto', maxWidth: 260, margin: '28px auto 0', padding: '0 26px', textDecoration: 'none' }}>Launch Nanawise →</Link>
        </div>
      </div>

      {/* FOOTER */}
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '40px 28px 56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/logo.png" alt="Nanawise" style={{ width: 28, height: 28, borderRadius: '50%', boxShadow: `0 3px 0 ${BLUE_D}`, objectFit: 'cover' }} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>Nanawise</span>
        </div>
        <div className="nw-mono" style={{ fontSize: 12, color: 'var(--muted3)' }}>prediction markets, in plain words · built on Sui</div>
      </div>
    </div>
  );
}
