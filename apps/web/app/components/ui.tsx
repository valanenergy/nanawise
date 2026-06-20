'use client';

import { OracleStatus } from '@nanawise/shared';

export function TxLink({ digest, label = 'tx' }: { digest: string; label?: string }) {
  return (
    <a href={`https://testnet.suivision.xyz/txblock/${digest}`} target="_blank" rel="noreferrer">
      {label} ↗
    </a>
  );
}

export function LifecycleBadge({ status }: { status: OracleStatus }) {
  const map: Record<OracleStatus, [string, string]> = {
    [OracleStatus.ACTIVE]: ['LIVE', 'var(--up)'],
    [OracleStatus.PENDING_SETTLEMENT]: ['SETTLING', '#e6a23c'],
    [OracleStatus.SETTLED]: ['SETTLED', 'var(--muted)'],
    [OracleStatus.INACTIVE]: ['INACTIVE', 'var(--muted)'],
  };
  const [label, color] = map[status];
  return (
    <span style={{ color, border: `1px solid ${color}`, borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>
      {label}
    </span>
  );
}

export function BudgetMeter({ remaining, cap }: { remaining: number; cap: number }) {
  const pct = cap > 0 ? Math.max(0, Math.min(100, (remaining / cap) * 100)) : 0;
  return (
    <div>
      <div style={{ height: 10, background: 'var(--border)', borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} />
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        {remaining.toFixed(2)} / {cap.toFixed(2)} dUSDC remaining
      </div>
    </div>
  );
}

export function Spinner() {
  return <div className="spinner" />;
}

export function ErrorBox({ message }: { message: string }) {
  return <p className="err">{message}</p>;
}
