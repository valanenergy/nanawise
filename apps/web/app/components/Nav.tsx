'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/dashboard', label: 'Market' },
  { href: '/surface', label: 'Vol' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/vault', label: 'Vault' },
  { href: '/leaderboard', label: 'Ranks' },
  { href: '/agent', label: 'Agent' },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav
      style={{
        display: 'flex',
        gap: 4,
        overflowX: 'auto',
        padding: '8px 0 14px',
        borderBottom: '1px solid var(--border)',
        marginBottom: 8,
      }}
    >
      {TABS.map((t) => {
        const active = path === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              textDecoration: 'none',
              color: active ? 'white' : 'var(--muted)',
              background: active ? 'var(--accent)' : 'transparent',
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
