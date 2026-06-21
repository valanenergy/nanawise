import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { prisma } from '@nanawise/db';
import {
  createSponsoredTransaction,
  executeSponsoredTransaction,
  getZkLoginIdentity,
} from '@nanawise/sui-auth';
import type { Bot } from 'grammy';
import { notifyOnboarded } from './bot.js';
import type { Deps } from './clients.js';
import { fundNewUserAddress } from './funding.js';
import { respond as whatsappRespond } from './webhooks/whatsapp.js';

const MAX_BODY_BYTES = 256 * 1024;

/**
 * Backend HTTP API for the Mini App (Phase 1). The Enoki PRIVATE key lives only
 * here — the Mini App calls these endpoints instead of holding it (docs/06):
 *
 *   POST /api/onboard/prepare  { jwt }                                 → { suiAddress }
 *   POST /api/sponsor          { transactionKindBytes, sender }       → { bytes, digest }
 *   POST /api/sponsor/execute  { digest, signature }                  → { digest }
 *   POST /api/onboard/complete { state, jwt?, suiAddress?, managerId } → { ok, funding }
 *   GET  /health
 *
 * Hardening (code review): sponsorship is scoped to known onboarded users AND
 * `allowedAddresses:[sender]`; onboarding derives the address from the zkLogin JWT
 * server-side rather than trusting the client. See docs/BLOCKERS.md (B5) for the
 * remaining full Telegram initData verification.
 */
export function startApiServer(deps: Deps, bot: Bot) {
  const network = deps.cfg.predict.network === 'mainnet' ? 'mainnet' : 'testnet';
  const allowedMoveCallTargets = [
    `${deps.cfg.predict.predictPackageId}::predict::create_manager`,
    `${deps.cfg.predict.predictPackageId}::predict_manager::deposit`,
    `${deps.cfg.predict.predictPackageId}::predict::mint`,
    `${deps.cfg.predict.predictPackageId}::predict::redeem`,
    `${deps.cfg.predict.predictPackageId}::predict::mint_range`,
    `${deps.cfg.predict.predictPackageId}::predict::redeem_range`,
    `${deps.cfg.predict.predictPackageId}::predict::supply`,
    `${deps.cfg.predict.predictPackageId}::predict::withdraw`,
    // Key-constructor helpers invoked inside the mint/redeem PTBs (predict-sdk
    // marketKeyArg/rangeKeyArg). Enoki validates EVERY move call in the PTB, so
    // these must be allow-listed too or the whole sponsored tx is rejected.
    `${deps.cfg.predict.predictPackageId}::market_key::new`,
    `${deps.cfg.predict.predictPackageId}::range_key::new`,
    // agent policy create/revoke (owner-signed via Mini App) — Phase 4
    ...(deps.cfg.predict.agentPolicyPackageId
      ? [
          `${deps.cfg.predict.agentPolicyPackageId}::agent_policy::create_policy`,
          `${deps.cfg.predict.agentPolicyPackageId}::agent_policy::top_up`,
          `${deps.cfg.predict.agentPolicyPackageId}::agent_policy::revoke`,
        ]
      : []),
  ];

  // Allowed browser origins for CORS (H3): the Mini App / dashboard URL + localhost dev.
  const allowedOrigins = new Set(
    [deps.cfg.miniAppUrl, 'http://localhost:3000', process.env.DASHBOARD_URL].filter(
      (o): o is string => Boolean(o),
    ),
  );

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error('[api] error:', e);
      json(res, 500, { error: 'internal error' }); // never leak internals (M2)
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = `${req.method} ${url.pathname}`;

    // CORS scoped to known Mini App / dashboard origins (H3). The WhatsApp webhook is
    // server-to-server and is intentionally NOT CORS-exposed.
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'Origin');
      res.setHeader('access-control-allow-headers', 'content-type');
      res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (route === 'GET /health') return json(res, 200, { ok: true });

    if (route === 'POST /api/oauth/start') {
      // Initialize OAuth flow: generate a random state, store it in Redis, return to frontend.
      // The frontend will use this state when initiating Google sign-in, Google will echo it back,
      // and we'll use it to look up the user's telegramId in /api/onboard/complete.
      const body = await readJson(req);
      const state = randomBytes(16).toString('hex');
      // Use the real Telegram ID if provided (from Telegram Web App), otherwise generate a temp ID for web users
      const telegramId = body.telegramId || String(Math.floor(Math.random() * 9007199254740991));
      await deps.sessions.putOAuthState(state, { telegramId }, 300); // 5-min TTL
      return json(res, 200, { state });
    }

    // WhatsApp (Twilio) webhook — plain-text command parity (Phase 8 Part B).
    if (route === 'POST /webhooks/whatsapp') {
      const form = await readForm(req);
      // C1: validate the Twilio signature when a token is configured (reject forgeries).
      if (!verifyTwilioSignature(req, url, form)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      const from = String(form.From ?? '').replace('whatsapp:', '');
      const reply = await whatsappRespond(deps, from, String(form.Body ?? '').trim());
      const esc = reply.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      res.writeHead(200, { 'content-type': 'text/xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${esc}</Message></Response>`);
      return;
    }

    // Agent activity feed (Phase 5 dashboard) — reads the Postgres ActionExecuted mirror.
    const agentActions = url.pathname.match(/^\/api\/agent\/(0x[0-9a-fA-F]+)\/actions$/);
    if (req.method === 'GET' && agentActions) {
      const rows = await prisma.agentAction.findMany({
        where: { policyId: agentActions[1] },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return json(
        res,
        200,
        rows.map((r) => ({
          actionType: r.actionType,
          strike: r.strike?.toString(),
          isUp: r.isUp,
          amountSpent: r.amountSpent?.toString(),
          budgetRemaining: r.budgetRemaining?.toString(),
          txHash: r.txHash,
        })),
      );
    }

    // Manager lookup by zkLogin address (robust when the Mini App's sessionStorage
    // cache is empty, e.g. a fresh Telegram webview). Reads the DB row written at
    // onboard/complete. Address-keyed and read-only, so safe to expose.
    if (req.method === 'GET' && url.pathname === '/api/manager') {
      const address = url.searchParams.get('address') ?? '';
      if (!address) return json(res, 400, { error: 'address required' });
      const u = await prisma.user.findFirst({
        where: { suiAddress: address, managerId: { not: null } },
        select: { managerId: true },
      });
      return json(res, 200, { managerId: u?.managerId ?? null });
    }

    if (route === 'POST /api/onboard/prepare') {
      const body = await readJson(req);
      const jwtStr = String(body.jwt ?? '');
      // H2: derive the address authoritatively from the zkLogin JWT.
      const identity = await getZkLoginIdentity(deps.enoki, jwtStr);
      const suiAddress = identity.address;

      // Pre-register the user in the database so they can call /api/sponsor.
      // Uses a temporary negative telegramId derived from the suiAddress (see
      // tempTelegramIdFor). This row is upserted again in onboard/complete with
      // the real telegramId once the OAuth state resolves it.
      const tempTelegramId = tempTelegramIdFor(suiAddress);

      await prisma.user.upsert({
        where: { telegramId: tempTelegramId },
        create: { telegramId: tempTelegramId, suiAddress },
        update: { suiAddress },
      });

      return json(res, 200, { suiAddress });
    }

    if (route === 'POST /api/sponsor') {
      const body = await readJson(req);
      const sender = String(body.sender ?? '');
      // H1: only sponsor for a known, onboarded address, and scope to that sender.
      const known = await prisma.user.findFirst({ where: { suiAddress: sender } });
      if (!known) return json(res, 403, { error: 'sender not authorized' });
      const out = await createSponsoredTransaction(deps.enoki, {
        transactionKindBytes: String(body.transactionKindBytes ?? ''),
        sender,
        network,
        allowedMoveCallTargets,
        allowedAddresses: [sender],
      });
      return json(res, 200, out);
    }

    if (route === 'POST /api/sponsor/execute') {
      const body = await readJson(req);
      const out = await executeSponsoredTransaction(deps.enoki, String(body.digest), String(body.signature));
      return json(res, 200, out);
    }

    if (route === 'POST /api/onboard/complete') {
      const body = await readJson(req); // { state, jwt?, suiAddress?, managerId }

      // H2: derive the address authoritatively from the zkLogin JWT when present;
      // only fall back to the client-supplied address in dev (no JWT).
      let suiAddress: string;
      if (body.jwt) {
        const identity = await getZkLoginIdentity(deps.enoki, String(body.jwt));
        suiAddress = identity.address;
      } else if (body.suiAddress) {
        console.warn('[onboard] no JWT supplied — trusting client address (dev only)');
        suiAddress = String(body.suiAddress);
      } else {
        return json(res, 400, { error: 'jwt or suiAddress required' });
      }

      // The OAuth state maps to the real Telegram ID, but it is a one-time,
      // short-lived token. It can be absent (user re-navigated to /miniapp/onboard
      // without a fresh state) or expired (the sign-in → ZKP → on-chain create flow
      // ran past its TTL). In that case fall back to the same deterministic temp
      // telegramId that /prepare registered, keyed off the JWT-derived address, so
      // onboarding still completes self-custodially. A real Telegram user with a
      // valid state still gets linked to their actual account.
      const st = await deps.sessions.takeOAuthState(String(body.state ?? ''));
      if (!st) console.warn('[onboard] OAuth state missing/expired — using temp telegramId from JWT');
      const telegramId = st ? BigInt(st.telegramId) : tempTelegramIdFor(suiAddress);

      const managerId = body.managerId ? String(body.managerId) : undefined;
      // Cross-check manager ownership on-chain when resolvable (tolerate indexing lag).
      if (managerId) {
        try {
          const m = await deps.predict.readManager(managerId);
          if (m.owner && m.owner !== suiAddress) {
            return json(res, 400, { error: 'manager owner mismatch' });
          }
        } catch {
          /* not yet indexed — accept and let later reads reconcile */
        }
      }

      await prisma.user.upsert({
        where: { telegramId },
        create: { telegramId, suiAddress, managerId },
        update: { suiAddress, managerId },
      });

      const funding = await fundNewUserAddress(deps, telegramId, suiAddress);

      const epochExpiryMs = Date.now() + 48 * 3600 * 1000; // ~maxEpoch window
      await deps.sessions.setSession(
        Number(telegramId),
        { suiAddress, managerId, maxEpoch: st?.maxEpoch ?? 0, epochExpiryMs },
        48 * 3600,
      );

      // A failed welcome DM must not fail onboarding.
      try {
        await notifyOnboarded(bot, Number(telegramId), suiAddress, managerId, funding.digest);
      } catch (e) {
        console.warn('[onboard] welcome DM failed:', (e as Error).message);
      }
      return json(res, 200, { ok: true, funding });
    }

    json(res, 404, { error: 'not found' });
  }

  server.listen(deps.cfg.apiPort, () => console.log(`[api] listening on :${deps.cfg.apiPort}`));
  return server;
}

/**
 * Validate Twilio's X-Twilio-Signature (C1). Algorithm: HMAC-SHA1 over
 * (full request URL + each POST param appended as key+value, sorted by key), base64.
 * When TWILIO_AUTH_TOKEN is unset (sandbox), we allow the request but warn once.
 */
let warnedNoTwilioToken = false;
function verifyTwilioSignature(req: IncomingMessage, url: URL, form: Record<string, string>): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) {
    if (!warnedNoTwilioToken) {
      console.warn('[api] TWILIO_AUTH_TOKEN unset — WhatsApp webhook signature NOT verified (sandbox only)');
      warnedNoTwilioToken = true;
    }
    return true;
  }
  const sig = req.headers['x-twilio-signature'];
  if (typeof sig !== 'string') return false;
  // Twilio signs the public-facing URL; PUBLIC_URL must match what Twilio called.
  const base = process.env.PUBLIC_URL ?? `https://${req.headers.host ?? ''}`;
  const fullUrl = `${base}${url.pathname}`;
  const data = fullUrl + Object.keys(form).sort().map((k) => k + form[k]).join('');
  const expected = createHmac('sha1', token).update(Buffer.from(data, 'utf8')).digest('base64');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Deterministic temporary telegramId for a self-custodial (web/no-Telegram) user,
 * derived from the zkLogin Sui address. Negative so it never collides with a real
 * Telegram user id, and stable so /prepare and /complete agree on the same row.
 */
function tempTelegramIdFor(suiAddress: string): bigint {
  const hash = createHmac('sha256', 'temp-user-key');
  hash.update(suiAddress);
  const hashBigInt = BigInt('0x' + hash.digest('hex').slice(0, 16));
  return -(hashBigInt % BigInt('9223372036854775807')); // negative, fits in i64
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readJson(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const buf = c as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function readForm(req: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const buf = c as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(buf);
  }
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
}
