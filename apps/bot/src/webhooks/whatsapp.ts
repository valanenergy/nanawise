import { formatStrike, OracleStatus } from '@nanawise/shared';
import type { Deps } from '../clients.js';

/**
 * WhatsApp (Twilio) command parity (Phase 8 Part B). Same commands as Telegram; only
 * formatting/interaction differs — plain text + numbered menus + web links instead of
 * inline keyboards and Mini App buttons. The webhook route in api.ts parses Twilio's
 * form POST and replies with TwiML wrapping `respond()`.
 *
 * Twilio signature validation (X-Twilio-Signature) is applied in api.ts when
 * TWILIO_AUTH_TOKEN is set; the sandbox runs without it.
 */
export async function respond(deps: Deps, from: string, text: string): Promise<string> {
  const [cmd] = text.replace(/^\//, '').split(/\s+/);
  const link = deps.cfg.miniAppUrl;
  switch ((cmd ?? '').toLowerCase()) {
    case 'start':
      return `Welcome to Nanawise — trade BTC up/down, no seed phrase, no gas.\nSet up your wallet: ${link}/?wa=${encodeURIComponent(from)}`;
    case 'market': {
      const o = await activeBtc(deps);
      if (!o) return 'No BTC round is open right now — try again shortly.';
      return [
        `BTC market — spot $${formatStrike(o.spot1e9)} (${OracleStatus[o.status]})`,
        `Expires ${new Date(o.expiryMs).toLocaleTimeString()}`,
        `Trade: ${link}/miniapp/trade?oracleId=${o.oracleId}`,
      ].join('\n');
    }
    case 'pnl':
    case 'positions':
      return `Open your portfolio: ${link}/portfolio`;
    case 'vault':
      return `Liquidity vault: ${link}/vault`;
    case 'help':
    default:
      return [
        'Nanawise (WhatsApp):',
        '1. start — set up wallet',
        '2. market — live BTC prices',
        '3. pnl — your portfolio',
        '4. vault — earn the spread',
        `Full app: ${link}`,
      ].join('\n');
  }
}

async function activeBtc(deps: Deps) {
  const now = Date.now();
  const oracles = await deps.predict.getOracles();
  const btc = oracles
    .filter((o) => /btc/i.test(o.underlyingAsset ?? '') && (o.expiryMs ?? 0) > now)
    .sort((a, b) => (a.expiryMs ?? 0) - (b.expiryMs ?? 0));
  for (const o of btc.slice(0, 6)) {
    const st = await deps.predict.getOracleState(o.oracleId);
    if (st.active) return st;
  }
  return undefined;
}
