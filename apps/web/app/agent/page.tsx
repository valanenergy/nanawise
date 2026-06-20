'use client';

import { useEffect, useState } from 'react';
import { formatStrike, formatUsdc } from '@nanawise/shared';
import type { AgentPolicyState } from '@nanawise/predict-sdk';
import { Nav } from '../components/Nav';
import { BudgetMeter, Spinner, TxLink } from '../components/ui';
import { predictClient } from '../../lib/predict';

interface Action {
  actionType: string;
  strike?: string;
  isUp?: boolean;
  amountSpent?: string;
  budgetRemaining?: string;
  txHash: string;
}

export default function Agent() {
  const [policyId, setPolicyId] = useState<string | null>(null);
  const [policy, setPolicy] = useState<AgentPolicyState | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const pid = typeof window !== 'undefined' ? sessionStorage.getItem('nanawise.policyId') : null;
    setPolicyId(pid);
    (async () => {
      if (pid) {
        try {
          setPolicy(await predictClient().readAgentPolicy(pid));
        } catch {
          /* not deployed / not found */
        }
        try {
          const base = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8787';
          const res = await fetch(`${base}/api/agent/${pid}/actions`);
          if (res.ok) setActions(await res.json());
        } catch {
          /* api offline */
        }
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <main><Nav /><Spinner /></main>;

  if (!policyId || !policy)
    return (
      <main>
        <Nav />
        <h2 style={{ marginTop: 0 }}>Agent Wallet</h2>
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>
            No agent budget yet. From the bot: <b>/policy &lt;budget&gt; &lt;hours&gt;</b> to fund a
            budget escrow, then <b>/auto &lt;strategy&gt;</b> to start.
          </p>
          <p className="muted" style={{ fontSize: 13 }}>
            The agent trades within an on-chain escrow it can never overspend. You can revoke anytime
            and reclaim what is unspent — enforced by the Move VM.
          </p>
        </div>
      </main>
    );

  const remaining = Number(policy.budgetRemaining) / 1e6;
  const cap = Number(policy.budgetCap) / 1e6;

  return (
    <main>
      <Nav />
      <h2 style={{ marginTop: 0 }}>Agent Wallet</h2>
      <div className="card">
        <div className="row">
          <span className="muted">Strategy</span>
          <span>{policy.strategy || '—'}</span>
        </div>
        <div className="row">
          <span className="muted">Status</span>
          <span style={{ color: policy.revoked ? 'var(--down)' : 'var(--up)' }}>
            {policy.revoked ? 'revoked' : 'active'}
          </span>
        </div>
        <div style={{ marginTop: 10 }}>
          <BudgetMeter remaining={remaining} cap={cap} />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <span className="muted">Spent</span>
          <span>{formatUsdc(policy.spent)} dUSDC</span>
        </div>
        <a
          className="muted"
          style={{ fontSize: 12 }}
          href={`https://testnet.suivision.xyz/object/${policy.policyId}`}
          target="_blank"
          rel="noreferrer"
        >
          policy object ↗
        </a>
      </div>

      <div className="card">
        <div className="muted" style={{ marginBottom: 8 }}>Activity ({actions.length})</div>
        {actions.length === 0 && <p className="muted">No trades yet.</p>}
        {actions.map((a, i) => (
          <div className="row" key={i}>
            <span>
              {a.actionType} {a.isUp != null ? (a.isUp ? 'UP' : 'DOWN') : ''}{' '}
              {a.strike ? `$${formatStrike(BigInt(a.strike))}` : ''}
            </span>
            <span className="muted">
              {a.budgetRemaining ? `${formatUsdc(BigInt(a.budgetRemaining))} left` : ''}{' '}
              {a.txHash && <TxLink digest={a.txHash} />}
            </span>
          </div>
        ))}
      </div>
    </main>
  );
}
