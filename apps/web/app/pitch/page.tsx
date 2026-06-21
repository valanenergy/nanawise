'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';

/**
 * Nanawise pitch deck (/pitch). YC/Sequoia slide order (Problem → Solution → Why Now
 * → Market → Product → Model → Edge → Team → Ask), themed around the north star:
 * "even your grandma can trade — without fear or jargon." Arrow-key navigable, in the
 * same Sui-Overflow design as the landing.
 */

function Kicker({ children }: { children: ReactNode }) {
  return <div className="nw-kicker" style={{ fontSize: 12.5 }}>{children}</div>;
}
function H({ children, size = 40 }: { children: ReactNode; size?: number }) {
  return (
    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: size, lineHeight: 1.04, letterSpacing: '-.025em', marginTop: 14 }}>
      {children}
    </div>
  );
}
function Sub({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 17, color: 'var(--muted)', marginTop: 16, lineHeight: 1.5, maxWidth: 620 }}>{children}</div>;
}
function Card({ children, accent }: { children: ReactNode; accent?: string }) {
  return (
    <div className="nw-card" style={{ margin: 0, borderLeft: accent ? `3px solid ${accent}` : undefined, flex: 1, minWidth: 0 }}>
      {children}
    </div>
  );
}
function Stat({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 30, color: color ?? 'var(--ink)' }}>{value}</div>
      <div className="nw-mono" style={{ fontSize: 12, color: 'var(--muted2)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Keycap({ ch, bg, shadow, fg, size, rot, pos }: { ch: string; bg: string; shadow: string; fg: string; size: number; rot: number; pos: React.CSSProperties }) {
  return (
    <div
      className="nw-keycap"
      style={{
        ...pos,
        width: size,
        height: size,
        borderRadius: size * 0.2,
        background: bg,
        color: fg,
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: size * 0.45,
        transform: `rotate(${rot}deg)`,
        boxShadow: `0 8px 0 ${shadow}, 0 16px 24px #0d142426`,
      }}
    >
      {ch}
    </div>
  );
}

const GREEN = '#1fc586';
const RED = '#ff6a5d';
const BLUE = '#2f8fff';
const YELLOW = '#ffc83d';
const PURPLE = '#9b7cf0';

const SLIDES: { tag: string; render: () => ReactNode }[] = [
  // 0 — TITLE
  {
    tag: 'intro',
    render: () => (
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
        <Keycap ch="↑" bg={GREEN} shadow="#149e69" fg="#06321f" size={64} rot={-9} pos={{ right: 8, top: -40 }} />
        <Keycap ch="$" bg={YELLOW} shadow="#e0a800" fg="#4a3500" size={54} rot={8} pos={{ right: 90, top: 30 }} />
        <span className="nw-pill nw-pill--green" style={{ marginBottom: 18 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: GREEN }} /> SUI TESTNET · TELEGRAM-NATIVE
        </span>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 64, lineHeight: 0.98, letterSpacing: '-.03em' }}>
          Nanawise
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26, marginTop: 18, letterSpacing: '-.02em', maxWidth: 560, lineHeight: 1.15 }}>
          Even your grandma can trade prediction markets — <span style={{ color: GREEN }}>without fear or jargon.</span>
        </div>
        <Sub>Say a hunch in plain words. We turn it into a real on-chain trade. No seed phrase, no gas, no learning curve.</Sub>
      </div>
    ),
  },
  // 1 — PROBLEM
  {
    tag: 'problem',
    render: () => (
      <div>
        <Kicker>01 · the problem</Kicker>
        <H>Trading is built for crypto natives.<br />Everyone else is locked out.</H>
        <Sub>To place one on-chain bet today, a normal person must survive a gauntlet:</Sub>
        <div style={{ display: 'flex', gap: 12, marginTop: 22, flexWrap: 'wrap' }}>
          <Card accent={RED}><b>Seed phrases & wallets.</b><div style={{ color: 'var(--muted)', marginTop: 4 }}>12 words to lose, a wallet to install.</div></Card>
          <Card accent={RED}><b>Gas & tokens.</b><div style={{ color: 'var(--muted)', marginTop: 4 }}>Buy the right coin just to click once.</div></Card>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          <Card accent={RED}><b>Jargon.</b><div style={{ color: 'var(--muted)', marginTop: 4 }}>Strikes, AMMs, slippage, expiries.</div></Card>
          <Card accent={RED}><b>Fear.</b><div style={{ color: 'var(--muted)', marginTop: 4 }}>One wrong tap and the money is gone.</div></Card>
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, marginTop: 24, color: 'var(--ink)' }}>
          Your grandma will never write down a 12-word seed phrase.
        </div>
      </div>
    ),
  },
  // 2 — SOLUTION
  {
    tag: 'solution',
    render: () => (
      <div>
        <Kicker>02 · the solution</Kicker>
        <H>Just say what you think.<br />We do the rest.</H>
        <Sub>Nanawise lives in Telegram. Talk to it like a person — by text or voice.</Sub>
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
          {[
            { n: '1', t: 'You say it', d: '“bet $2 Bitcoin goes up”', c: BLUE },
            { n: '2', t: 'AI builds it', d: 'reads the live market, picks the position, explains why', c: PURPLE },
            { n: '3', t: 'You tap to pay', d: 'one button — deposit + trade, gas on us', c: GREEN },
          ].map((s) => (
            <div key={s.n} className="nw-card" style={{ margin: 0, flex: 1, minWidth: 150 }}>
              <div style={{ width: 30, height: 30, borderRadius: 9, background: s.c, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 700 }}>{s.n}</div>
              <div style={{ fontWeight: 700, marginTop: 12 }}>{s.t}</div>
              <div className="nw-mono" style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 6, lineHeight: 1.4 }}>{s.d}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 22, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['no seed phrase', 'no gas', 'no jargon', 'plain words or voice'].map((c) => (
            <span key={c} className="nw-pill nw-pill--chip">{c}</span>
          ))}
        </div>
      </div>
    ),
  },
  // 3 — WHY NOW
  {
    tag: 'why now',
    render: () => (
      <div>
        <Kicker>03 · why now</Kicker>
        <H>Four things just became true.</H>
        <Sub>None of this was possible 18 months ago. Together, they remove every barrier at once.</Sub>
        <div style={{ display: 'flex', gap: 12, marginTop: 22, flexWrap: 'wrap' }}>
          <Card accent={BLUE}><b>zkLogin</b><div style={{ color: 'var(--muted)', marginTop: 4 }}>Google sign-in → a real self-custody wallet. No seed phrase.</div></Card>
          <Card accent={GREEN}><b>Sponsored gas</b><div style={{ color: 'var(--muted)', marginTop: 4 }}>We pay the gas. Users never touch a token to trade.</div></Card>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          <Card accent={PURPLE}><b>LLMs (gpt-4o)</b><div style={{ color: 'var(--muted)', marginTop: 4 }}>Understand a spoken hunch and turn it into a precise trade.</div></Card>
          <Card accent={YELLOW}><b>Telegram mini-apps</b><div style={{ color: 'var(--muted)', marginTop: 4 }}>900M people, already in chat. No app to download.</div></Card>
        </div>
      </div>
    ),
  },
  // 4 — MARKET
  {
    tag: 'market',
    render: () => (
      <div>
        <Kicker>04 · market</Kicker>
        <H>Prediction markets went mainstream.<br />The audience hasn&apos;t followed — yet.</H>
        <div style={{ display: 'flex', gap: 28, marginTop: 22, flexWrap: 'wrap' }}>
          <Stat value="$10B+" label="prediction-market volume, 2024" color={GREEN} />
          <Stat value="900M" label="Telegram monthly users" color={BLUE} />
          <Stat value="~600M" label="people who own crypto" color={PURPLE} />
        </div>
        <div style={{ marginTop: 26, maxWidth: 560 }}>
          {[
            { k: 'TAM', v: 'Everyone with an opinion + a phone', w: '100%', c: '#e7e2d6' },
            { k: 'SAM', v: 'Telegram users curious about markets', w: '55%', c: BLUE },
            { k: 'SOM', v: 'Crypto-curious chat users, next 3 yrs', w: '22%', c: GREEN },
          ].map((r) => (
            <div key={r.k} style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
                <span className="nw-mono" style={{ color: 'var(--ink)', fontWeight: 700 }}>{r.k}</span>
                <span style={{ color: 'var(--muted)' }}>{r.v}</span>
              </div>
              <div style={{ height: 10, borderRadius: 6, background: '#f0ece2', marginTop: 6, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: r.w, borderRadius: 6, background: r.c }} />
              </div>
            </div>
          ))}
        </div>
        <div className="nw-mono" style={{ fontSize: 11, color: 'var(--muted3)', marginTop: 14 }}>// figures directional</div>
      </div>
    ),
  },
  // 5 — PRODUCT
  {
    tag: 'product',
    render: () => (
      <div>
        <Kicker>05 · product · live today</Kicker>
        <H>From a sentence to a signed trade.</H>
        <div className="nw-card" style={{ marginTop: 22, maxWidth: 560 }}>
          <div className="nw-mono" style={{ fontSize: 12, color: 'var(--muted2)' }}>you →</div>
          <div style={{ fontWeight: 600, marginTop: 4 }}>“I think bitcoin goes up, bet me a dollar”</div>
          <div style={{ height: 1, background: '#f0ece2', margin: '14px 0' }} />
          <div className="nw-mono" style={{ fontSize: 12, color: BLUE }}>nanawise →</div>
          <div style={{ marginTop: 6, color: 'var(--muted)', lineHeight: 1.5 }}>
            Reads the live BTC market, picks <b style={{ color: 'var(--ink)' }}>UP $63,800</b> (~51%), explains it, and shows one button:
          </div>
          <div className="nw-key nw-key--green" style={{ marginTop: 12, height: 50, fontSize: 16 }}>💸 Open — pay 0.51 dUSDC</div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
          {['text + voice', 'on Sui · DeepBook Predict', 'self-custodial', 'gas sponsored'].map((c) => (
            <span key={c} className="nw-pill nw-pill--chip">{c}</span>
          ))}
        </div>
      </div>
    ),
  },
  // 6 — BUSINESS MODEL
  {
    tag: 'model',
    render: () => (
      <div>
        <Kicker>06 · business model</Kicker>
        <H>We earn the spread on every trade.</H>
        <Sub>Aligned with users: we make money when they trade, not when they lose.</Sub>
        <div style={{ display: 'flex', gap: 12, marginTop: 22, flexWrap: 'wrap' }}>
          <Card accent={GREEN}><b>Spread per trade</b><div style={{ color: 'var(--muted)', marginTop: 4 }}>A small, transparent fee baked into each position.</div></Card>
          <Card accent={BLUE}><b>Liquidity vault</b><div style={{ color: 'var(--muted)', marginTop: 4 }}>Anyone can supply dUSDC and earn the spread as an LP.</div></Card>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          <Card accent={PURPLE}><b>Agent fees (later)</b><div style={{ color: 'var(--muted)', marginTop: 4 }}>Opt-in auto-trading agents on a budget you set.</div></Card>
          <Card accent={YELLOW}><b>Volume flywheel</b><div style={{ color: 'var(--muted)', marginTop: 4 }}>Easier trading → more trades → deeper liquidity.</div></Card>
        </div>
      </div>
    ),
  },
  // 7 — COMPETITION
  {
    tag: 'why we win',
    render: () => (
      <div>
        <Kicker>07 · why we win</Kicker>
        <H>Everyone else picks one. We do both.</H>
        <Sub>Self-custody <i>and</i> grandma-simple — the quadrant nobody owns.</Sub>
        <div style={{ position: 'relative', marginTop: 22, height: 230, maxWidth: 460, border: '1px solid var(--border)', borderRadius: 16, background: '#fff' }}>
          <div className="nw-mono" style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', fontSize: 11, color: 'var(--muted2)' }}>easy ↑</div>
          <div className="nw-mono" style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', fontSize: 11, color: 'var(--muted2)' }}>↓ expert-only</div>
          <div className="nw-mono" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%) rotate(-90deg)', fontSize: 11, color: 'var(--muted2)' }}>custodial</div>
          <div className="nw-mono" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%) rotate(90deg)', fontSize: 11, color: 'var(--muted2)' }}>self-custody</div>
          <div style={{ position: 'absolute', left: '50%', top: 16, bottom: 16, width: 1, background: '#f0ece2' }} />
          <div style={{ position: 'absolute', top: '50%', left: 16, right: 16, height: 1, background: '#f0ece2' }} />
          {/* quadrant labels */}
          <span style={{ position: 'absolute', left: '14%', top: '24%', fontSize: 13, color: 'var(--muted)' }}>Robinhood,<br />Kalshi</span>
          <span style={{ position: 'absolute', right: '12%', bottom: '20%', fontSize: 13, color: 'var(--muted)' }}>Polymarket,<br />raw DEXs</span>
          <span style={{ position: 'absolute', left: '12%', bottom: '24%', fontSize: 13, color: 'var(--muted3)' }}>legacy<br />brokers</span>
          <span style={{ position: 'absolute', right: '8%', top: '16%', fontFamily: 'var(--font-display)', fontWeight: 800, color: GREEN, fontSize: 17 }}>Nanawise ★</span>
        </div>
      </div>
    ),
  },
  // 8 — TEAM
  {
    tag: 'team',
    render: () => (
      <div>
        <Kicker>08 · team</Kicker>
        <H>Builders who hate complexity.</H>
        <Sub>We shipped the full loop — zkLogin onboarding, sponsored on-chain trades, and an AI that takes voice notes — on Sui testnet, end to end.</Sub>
        <div className="nw-card" style={{ marginTop: 22, maxWidth: 560 }}>
          <div className="nw-mono" style={{ fontSize: 11, color: 'var(--muted2)' }}>FOUNDING TEAM</div>
          <div style={{ marginTop: 8, lineHeight: 1.6 }}>
            <b>You</b> — product + full-stack. <span style={{ color: 'var(--muted)' }}>Built Nanawise: Telegram bot, Sui Move integration, zkLogin, AI agent.</span>
          </div>
          <div className="nw-mono" style={{ fontSize: 11.5, color: 'var(--muted3)', marginTop: 10 }}>// edit this slide with your real names &amp; credentials</div>
        </div>
      </div>
    ),
  },
  // 9 — ASK / VISION
  {
    tag: 'the ask',
    render: () => (
      <div style={{ position: 'relative' }}>
        <Keycap ch="N" bg={BLUE} shadow="#1f6fe0" fg="#fff" size={60} rot={8} pos={{ right: 0, top: -36 }} />
        <Kicker>09 · the ask</Kicker>
        <H>Help us bring fearless trading<br />to the next billion.</H>
        <Sub>We&apos;re raising a pre-seed to grow liquidity, harden the protocol, and put Nanawise in front of everyday Telegram users.</Sub>
        <div style={{ display: 'flex', gap: 12, marginTop: 22, flexWrap: 'wrap' }}>
          <Card accent={BLUE}><b>50% Product</b><div style={{ color: 'var(--muted)', marginTop: 4 }}>mainnet, more markets, the AI agent</div></Card>
          <Card accent={GREEN}><b>30% Liquidity</b><div style={{ color: 'var(--muted)', marginTop: 4 }}>seed the vault, deepen books</div></Card>
          <Card accent={PURPLE}><b>20% Growth</b><div style={{ color: 'var(--muted)', marginTop: 4 }}>creators, referrals, runway</div></Card>
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, marginTop: 26, color: 'var(--ink)', maxWidth: 600, lineHeight: 1.25 }}>
          A world where anyone — yes, your grandma — can take a position on what happens next, in one sentence. 🌍
        </div>
      </div>
    ),
  },
];

export default function Pitch() {
  const [i, setI] = useState(0);
  const n = SLIDES.length;
  const cur = SLIDES[i] ?? SLIDES[0]!;
  const go = useCallback((d: number) => setI((x) => Math.min(n - 1, Math.max(0, x + d))), [n]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) {
        e.preventDefault();
        go(1);
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) {
        e.preventDefault();
        go(-1);
      } else if (e.key === 'Home') {
        setI(0);
      } else if (e.key === 'End') {
        setI(n - 1);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, n]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 22px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/logo.png" alt="Nanawise" style={{ width: 28, height: 28, borderRadius: '50%', boxShadow: '0 3px 0 #1f6fe0', objectFit: 'cover' }} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>Nanawise</span>
          <span className="nw-mono" style={{ fontSize: 11, color: 'var(--muted2)' }}>· pitch</span>
        </div>
        <span className="nw-mono" style={{ fontSize: 12, color: 'var(--muted2)' }}>{String(i + 1).padStart(2, '0')} / {String(n).padStart(2, '0')} · {cur.tag}</span>
      </div>

      {/* slide */}
      <div
        key={i}
        onClick={(e) => go((e as unknown as MouseEvent).clientX > window.innerWidth / 2 ? 1 : -1)}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '28px 26px', maxWidth: 820, width: '100%', margin: '0 auto', animation: 'nwfade .35s ease both', cursor: 'pointer' }}
      >
        {cur.render()}
      </div>

      {/* nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 22px 22px', gap: 14 }}>
        <button className="nw-ghost" style={{ width: 'auto', opacity: i === 0 ? 0.35 : 1 }} onClick={() => go(-1)} disabled={i === 0}>← Prev</button>
        <div style={{ display: 'flex', gap: 7 }}>
          {SLIDES.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setI(idx)}
              aria-label={`slide ${idx + 1}`}
              style={{ width: idx === i ? 22 : 8, height: 8, borderRadius: 6, border: 'none', cursor: 'pointer', padding: 0, background: idx === i ? BLUE : '#d8d2c4', transition: 'width .2s' }}
            />
          ))}
        </div>
        <button className="nw-ghost" style={{ width: 'auto', color: i === n - 1 ? 'var(--muted3)' : BLUE, opacity: i === n - 1 ? 0.35 : 1 }} onClick={() => go(1)} disabled={i === n - 1}>Next →</button>
      </div>
    </div>
  );
}
