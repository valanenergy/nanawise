import { OracleStatus } from '@nanawise/shared';
import type {
  MintRecord,
  OracleRef,
  OracleState,
  RangeMintRecord,
  RedeemRecord,
} from './types.js';
import { looseArray, looseObject, safeFetch } from './validate.js';

/**
 * predict-server REST wrappers. Response schemas are undocumented (docs/03 §10),
 * so we validate loosely and normalize defensively — extracting known fields from
 * several candidate key names and always preserving `raw` for inspection.
 *
 * Endpoint paths are best-effort and centralized here so they're easy to adjust
 * after the Phase 0 spike confirms the real shapes against the live server.
 */
export class PredictServer {
  constructor(private readonly baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /** Raw GET for probing/diagnosis (used by the spike to discover real shapes). */
  async rawGet(path: string): Promise<unknown> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const res = await fetch(url);
    const text = await res.text();
    try {
      return { status: res.status, ok: res.ok, json: JSON.parse(text) };
    } catch {
      return { status: res.status, ok: res.ok, text: text.slice(0, 1000) };
    }
  }

  async getOracles(): Promise<OracleRef[]> {
    const data = await safeFetch(`${this.baseUrl}/oracles`, looseArray.or(looseObject));
    const list = Array.isArray(data) ? data : extractArray(data);
    return list.map((o) => {
      const r = asRecord(o);
      return {
        oracleId: str(pick(r, ['oracleId', 'oracle_id', 'id', 'objectId'])) ?? '',
        underlyingAsset: str(pick(r, ['underlyingAsset', 'underlying_asset', 'asset', 'symbol'])),
        expiryMs: num(pick(r, ['expiry', 'expiryMs', 'expiry_ms'])),
        raw: o,
      };
    });
  }

  async getOracleState(oracleId: string): Promise<OracleState> {
    const data = await safeFetch(`${this.baseUrl}/oracles/${oracleId}/state`, looseObject);
    return normalizeOracleState(oracleId, data);
  }

  private query(qs?: Record<string, string>): string {
    if (!qs) return '';
    const p = new URLSearchParams(qs).toString();
    return p ? `?${p}` : '';
  }

  async getPositionsMinted(qs?: { oracle_id?: string }): Promise<MintRecord[]> {
    const data = await safeFetch(`${this.baseUrl}/positions/minted${this.query(qs)}`, looseArray);
    return data.map((o) => {
      const r = asRecord(o);
      return {
        managerId: str(pick(r, ['manager_id', 'managerId'])) ?? '',
        trader: str(pick(r, ['trader', 'owner'])) ?? '',
        oracleId: str(pick(r, ['oracle_id', 'oracleId'])) ?? '',
        expiry: big(pick(r, ['expiry'])) ?? 0n,
        strike: big(pick(r, ['strike'])) ?? 0n,
        isUp: pick(r, ['is_up', 'isUp']) === true,
        quantity: big(pick(r, ['quantity'])) ?? 0n,
        cost: big(pick(r, ['cost'])) ?? 0n,
        askPrice: big(pick(r, ['ask_price', 'askPrice'])) ?? 0n,
        digest: str(pick(r, ['digest'])) ?? '',
        checkpointMs: num(pick(r, ['checkpoint_timestamp_ms', 'checkpointMs'])) ?? 0,
        raw: o,
      };
    });
  }

  async getPositionsRedeemed(qs?: { oracle_id?: string }): Promise<RedeemRecord[]> {
    const data = await safeFetch(`${this.baseUrl}/positions/redeemed${this.query(qs)}`, looseArray);
    return data.map((o) => {
      const r = asRecord(o);
      return {
        managerId: str(pick(r, ['manager_id', 'managerId'])) ?? '',
        owner: str(pick(r, ['owner'])) ?? '',
        executor: str(pick(r, ['executor'])) ?? '',
        oracleId: str(pick(r, ['oracle_id', 'oracleId'])) ?? '',
        expiry: big(pick(r, ['expiry'])) ?? 0n,
        strike: big(pick(r, ['strike'])) ?? 0n,
        isUp: pick(r, ['is_up', 'isUp']) === true,
        quantity: big(pick(r, ['quantity'])) ?? 0n,
        payout: big(pick(r, ['payout'])) ?? 0n,
        bidPrice: big(pick(r, ['bid_price', 'bidPrice'])) ?? 0n,
        isSettled: pick(r, ['is_settled', 'isSettled']) === true,
        digest: str(pick(r, ['digest'])) ?? '',
        raw: o,
      };
    });
  }

  async getRangesMinted(qs?: { oracle_id?: string }): Promise<RangeMintRecord[]> {
    const data = await safeFetch(`${this.baseUrl}/ranges/minted${this.query(qs)}`, looseArray);
    return data.map((o) => {
      const r = asRecord(o);
      return {
        managerId: str(pick(r, ['manager_id', 'managerId'])) ?? '',
        trader: str(pick(r, ['trader', 'owner'])) ?? '',
        oracleId: str(pick(r, ['oracle_id', 'oracleId'])) ?? '',
        expiry: big(pick(r, ['expiry'])) ?? 0n,
        lowerStrike: big(pick(r, ['lower_strike', 'lowerStrike'])) ?? 0n,
        higherStrike: big(pick(r, ['higher_strike', 'higherStrike'])) ?? 0n,
        quantity: big(pick(r, ['quantity'])) ?? 0n,
        cost: big(pick(r, ['cost'])) ?? 0n,
        digest: str(pick(r, ['digest'])) ?? '',
        raw: o,
      };
    });
  }

  async getStatus(): Promise<{ ok: boolean; latestCheckpoint?: number; raw: unknown }> {
    const data = await safeFetch(`${this.baseUrl}/status`, looseObject);
    return {
      ok: String(pick(data, ['status'])) === 'OK',
      latestCheckpoint: num(pick(data, ['latest_onchain_checkpoint'])),
      raw: data,
    };
  }

  async getManagerPnl(
    managerId: string,
    range = 'ALL',
  ): Promise<{ unrealized: bigint; total: bigint; points: Array<{ t: number; v: bigint }> }> {
    const data = await safeFetch(`${this.baseUrl}/managers/${managerId}/pnl?range=${range}`, looseObject);
    const pts = Array.isArray(pick(data, ['points'])) ? (pick(data, ['points']) as unknown[]) : [];
    return {
      unrealized: big(pick(data, ['current_unrealized_pnl'])) ?? 0n,
      total: big(pick(data, ['current_total_pnl'])) ?? 0n,
      points: pts.map((o) => {
        const r = asRecord(o);
        return { t: num(pick(r, ['checkpoint_timestamp_ms', 't'])) ?? 0, v: big(pick(r, ['value', 'pnl', 'v'])) ?? 0n };
      }),
    };
  }

  /** SVI history for an oracle (each point carries a/b/rho/m/sigma with *_negative signs). */
  async getOracleSviHistory(oracleId: string): Promise<
    Array<{ t: number; a: bigint; b: bigint; rho: bigint; m: bigint; sigma: bigint }>
  > {
    const data = await safeFetch(`${this.baseUrl}/oracles/${oracleId}/svi`, looseArray);
    return data.map((o) => {
      const r = asRecord(o);
      return {
        t: num(pick(r, ['checkpoint_timestamp_ms', 'onchain_timestamp'])) ?? 0,
        a: big(pick(r, ['a'])) ?? 0n,
        b: big(pick(r, ['b'])) ?? 0n,
        rho: signedWithSibling(r, 'rho') ?? 0n,
        m: signedWithSibling(r, 'm') ?? 0n,
        sigma: big(pick(r, ['sigma'])) ?? 0n,
      };
    });
  }

  async getAskBounds(oracleId: string): Promise<{ min: number; max: number }> {
    const data = await safeFetch(`${this.baseUrl}/oracles/${oracleId}/ask-bounds`, looseObject);
    return {
      min: num(pick(data, ['min', 'minAsk', 'min_ask'])) ?? 10_000_000,
      max: num(pick(data, ['max', 'maxAsk', 'max_ask'])) ?? 990_000_000,
    };
  }
}

/**
 * Normalize the real predict-server `/oracles/:id/state` shape (verified live):
 *   { oracle: { status:"active|inactive|...", expiry, settlement_price, ... },
 *     latest_price: { spot, forward, onchain_timestamp },
 *     latest_svi:   { a, b, rho, rho_negative, m, m_negative, sigma } }
 * Signed SVI fields use a flat sibling boolean (`rho_negative`, `m_negative`).
 */
export function normalizeOracleState(oracleId: string, data: unknown): OracleState {
  const r = asRecord(data);
  const oracle = asRecord(pick(r, ['oracle', 'state']) ?? r);
  const price = asRecord(pick(r, ['latest_price', 'latestPrice', 'prices']) ?? {});
  const sviRaw = asRecord(pick(r, ['latest_svi', 'latestSvi', 'svi']) ?? {});

  const statusStr = str(pick(oracle, ['status']))?.toLowerCase();
  const expiryMs = num(pick(oracle, ['expiry', 'expiryMs', 'expiry_ms'])) ?? 0;
  const settlement = big(pick(oracle, ['settlement_price', 'settlementPrice']));
  const timestampMs =
    num(pick(price, ['onchain_timestamp', 'onchainTimestamp', 'timestamp', 'timestamp_ms'])) ??
    num(pick(oracle, ['activated_at', 'activatedAt'])) ??
    0;
  const spot = big(pick(price, ['spot', 'spotPrice'])) ?? 0n;
  const forward = big(pick(price, ['forward', 'forwardPrice'])) ?? spot;

  // rho, m are SIGNED — sign carried by `<field>_negative` sibling. Never silently zero.
  const rho = signedWithSibling(sviRaw, 'rho');
  const m = signedWithSibling(sviRaw, 'm');
  const svi = {
    a: big(pick(sviRaw, ['a'])) ?? 0n,
    b: big(pick(sviRaw, ['b'])) ?? 0n,
    rho: rho ?? 0n,
    m: m ?? 0n,
    sigma: big(pick(sviRaw, ['sigma'])) ?? 0n,
  };

  const now = Date.now();
  let status: OracleStatus;
  if (statusStr === 'settled' || settlement !== undefined) status = OracleStatus.SETTLED;
  else if (statusStr === 'pending_settlement' || statusStr === 'pending') status = OracleStatus.PENDING_SETTLEMENT;
  else if (statusStr === 'active') status = expiryMs && now >= expiryMs ? OracleStatus.PENDING_SETTLEMENT : OracleStatus.ACTIVE;
  else status = OracleStatus.INACTIVE;

  return {
    oracleId,
    status,
    active: status === OracleStatus.ACTIVE,
    timestampMs,
    expiryMs,
    spot1e9: spot,
    forward1e9: forward,
    settlementPrice1e9: settlement,
    svi,
    raw: data,
  };
}

// ── tiny defensive extraction helpers ───────────────────────────────────────────
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function extractArray(v: unknown): unknown[] {
  const r = asRecord(v);
  for (const k of ['oracles', 'data', 'items', 'results']) {
    if (Array.isArray(r[k])) return r[k] as unknown[];
  }
  return [];
}
function pick(r: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (r[k] !== undefined && r[k] !== null) return r[k];
  return undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function num(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return undefined;
}
function big(v: unknown): bigint | undefined {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isInteger(v)) return BigInt(v);
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return BigInt(v);
  return undefined;
}

const U64 = 1n << 64n;
const I64_SIGN = 1n << 63n;

/**
 * Decode a Move signed I64 from any of the shapes an indexer might emit:
 * a (possibly negative) integer/string, two's-complement `{bits}`, or a
 * `{value|magnitude, is_negative|negative|neg}` struct. Returns undefined if absent
 * or unrecognized.
 */
export function parseI64(v: unknown): bigint | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isInteger(v)) return BigInt(v);
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return BigInt(v);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.bits !== undefined) {
      const u = big(o.bits);
      if (u === undefined) return undefined;
      const x = ((u % U64) + U64) % U64;
      return x >= I64_SIGN ? x - U64 : x;
    }
    const mag = big(o.value ?? o.magnitude ?? o.abs);
    if (mag !== undefined) {
      const neg = o.is_negative === true || o.negative === true || o.neg === true;
      return neg ? -mag : mag;
    }
  }
  return undefined;
}

/**
 * Decode a signed magnitude whose sign is carried by a sibling boolean
 * (`<key>_negative` / `<key>Negative`), falling back to an embedded sign (parseI64).
 * Warns rather than silently zeroing a present-but-unparseable field.
 */
export function signedWithSibling(rec: Record<string, unknown>, key: string): bigint | undefined {
  const v = rec[key];
  if (v === undefined || v === null) return undefined;
  const mag = parseI64(v);
  if (mag === undefined) {
    console.warn(`[predict-sdk] unparseable signed SVI field "${key}":`, JSON.stringify(v));
    return undefined;
  }
  const neg = rec[`${key}_negative`] === true || rec[`${key}Negative`] === true;
  const abs = mag < 0n ? -mag : mag;
  return neg ? -abs : abs;
}
