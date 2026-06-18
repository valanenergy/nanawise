import { bcs } from '@mysten/sui/bcs';
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { priceToImpliedProb } from '@nanawise/shared';
import {
  buildAgentTrade,
  buildCreatePolicy,
  buildReturnFunds,
  buildRevoke,
  buildTopUp,
} from './agent-ptb.js';
import {
  buildCreateManager,
  buildDeposit,
  buildGetRangeTradeAmounts,
  buildGetTradeAmounts,
  buildManagerBalance,
  buildManagerPosition,
  buildMint,
  buildMintRange,
  buildRedeem,
  buildRedeemPermissionless,
  buildRedeemRange,
  buildSupply,
  buildWithdraw,
} from './ptb.js';
import { PredictServer } from './server.js';
import { assertTradable, mapExecutionError } from './tradable.js';
import type {
  AgentPolicyState,
  AgentTradeParams,
  CreatePolicyParams,
  DepositParams,
  ManagerObject,
  MintParams,
  MintRecord,
  OracleRef,
  OracleState,
  PredictSdkConfig,
  RangeMintParams,
  RangeMintRecord,
  RangeRedeemParams,
  RedeemParams,
  RedeemPermissionlessParams,
  RedeemRecord,
  TradeAmounts,
} from './types.js';

const ZERO_ADDRESS = `0x${'0'.repeat(64)}`;

/**
 * Unified DeepBook Predict access: predict-server reads, on-chain devInspect reads,
 * and unsigned PTB builders. The SDK never signs or sponsors (docs/02 boundary).
 */
export class PredictClient {
  readonly server: PredictServer;

  constructor(
    private readonly sui: SuiJsonRpcClient,
    readonly cfg: PredictSdkConfig,
  ) {
    this.server = new PredictServer(cfg.serverUrl);
  }

  // ── predict-server reads ──────────────────────────────────────────────────────
  getOracles(): Promise<OracleRef[]> {
    return this.server.getOracles();
  }
  getOracleState(oracleId: string): Promise<OracleState> {
    return this.server.getOracleState(oracleId);
  }
  getAskBounds(oracleId: string): Promise<{ min: number; max: number }> {
    return this.server.getAskBounds(oracleId);
  }
  getPositionsMinted(qs?: { oracle_id?: string }): Promise<MintRecord[]> {
    return this.server.getPositionsMinted(qs);
  }
  getPositionsRedeemed(qs?: { oracle_id?: string }): Promise<RedeemRecord[]> {
    return this.server.getPositionsRedeemed(qs);
  }
  getRangesMinted(qs?: { oracle_id?: string }): Promise<RangeMintRecord[]> {
    return this.server.getRangesMinted(qs);
  }
  getStatus() {
    return this.server.getStatus();
  }
  getManagerPnl(managerId: string, range = 'ALL') {
    return this.server.getManagerPnl(managerId, range);
  }
  getOracleSviHistory(oracleId: string) {
    return this.server.getOracleSviHistory(oracleId);
  }

  /**
   * Unredeemed BINARY positions for a settled oracle = minted − redeemed, netted by
   * (manager, strike, direction). Returns positive remaining quantities only. The
   * keeper uses this to drive redeem_permissionless (docs/03 §10, Phase 3).
   */
  async unredeemedBinaries(oracleId: string): Promise<
    Array<{ managerId: string; owner: string; strike: bigint; isUp: boolean; expiry: bigint; quantity: bigint }>
  > {
    const [minted, redeemed] = await Promise.all([
      this.getPositionsMinted({ oracle_id: oracleId }),
      this.getPositionsRedeemed({ oracle_id: oracleId }),
    ]);
    const key = (m: { managerId: string; strike: bigint; isUp: boolean; expiry: bigint }) =>
      `${m.managerId}|${m.strike}|${m.isUp}|${m.expiry}`;
    const net = new Map<
      string,
      { managerId: string; owner: string; strike: bigint; isUp: boolean; expiry: bigint; quantity: bigint }
    >();
    for (const m of minted) {
      const k = key(m);
      const cur = net.get(k);
      if (cur) cur.quantity += m.quantity;
      else net.set(k, { managerId: m.managerId, owner: m.trader, strike: m.strike, isUp: m.isUp, expiry: m.expiry, quantity: m.quantity });
    }
    for (const r of redeemed) {
      const k = key({ managerId: r.managerId, strike: r.strike, isUp: r.isUp, expiry: r.expiry });
      const cur = net.get(k);
      if (cur) cur.quantity -= r.quantity;
    }
    return [...net.values()].filter((p) => p.quantity > 0n);
  }

  // ── on-chain reads (devInspect) ───────────────────────────────────────────────
  /** Preview (mint_cost, redeem_payout) for a binary at `quantity` via get_trade_amounts. */
  async previewMint(
    p: Pick<MintParams, 'oracleId' | 'expiry' | 'strike' | 'isUp' | 'quantity'>,
    sender: string = ZERO_ADDRESS,
  ): Promise<TradeAmounts> {
    const tx = buildGetTradeAmounts(this.cfg, p);
    const vals = await this.devInspectU64s(tx, sender, 2);
    const cost = vals[0]!;
    const payout = vals[1]!;
    const impliedProb = p.quantity > 0n ? priceToImpliedProb(Number((cost * 1_000_000_000n) / p.quantity)) : 0;
    return { cost, payout, impliedProb };
  }

  /** Spendable dUSDC balance INSIDE the manager (what mint actually spends). */
  async getManagerBalance(managerId: string, coinType: string, sender: string = ZERO_ADDRESS): Promise<bigint> {
    const tx = buildManagerBalance(this.cfg, managerId, coinType);
    const vals = await this.devInspectU64s(tx, sender, 1);
    return vals[0]!;
  }

  /** Preview redeem payout for a binary position (second return of get_trade_amounts). */
  async previewRedeem(
    p: Pick<MintParams, 'oracleId' | 'expiry' | 'strike' | 'isUp' | 'quantity'>,
    sender: string = ZERO_ADDRESS,
  ): Promise<{ payout: bigint }> {
    const tx = buildGetTradeAmounts(this.cfg, p);
    const vals = await this.devInspectU64s(tx, sender, 2);
    return { payout: vals[1]! };
  }

  /** Preview (cost, payout) for a range position via get_range_trade_amounts. */
  async previewMintRange(
    p: Pick<RangeMintParams, 'oracleId' | 'expiry' | 'lowerStrike' | 'higherStrike' | 'quantity'>,
    sender: string = ZERO_ADDRESS,
  ): Promise<{ cost: bigint; payout: bigint }> {
    const tx = buildGetRangeTradeAmounts(this.cfg, p);
    const vals = await this.devInspectU64s(tx, sender, 2);
    return { cost: vals[0]!, payout: vals[1]! };
  }

  /** Preview range redeem payout. */
  async previewRedeemRange(
    p: Pick<RangeMintParams, 'oracleId' | 'expiry' | 'lowerStrike' | 'higherStrike' | 'quantity'>,
    sender: string = ZERO_ADDRESS,
  ): Promise<{ payout: bigint }> {
    const tx = buildGetRangeTradeAmounts(this.cfg, p);
    const vals = await this.devInspectU64s(tx, sender, 2);
    return { payout: vals[1]! };
  }

  /** Throw a typed, human error if the oracle isn't tradable right now. */
  assertTradable = assertTradable;
  /** Map a post-trade abort to a human message. */
  mapExecutionError = mapExecutionError;

  /** Position quantity held by the manager for a given market key. */
  async getManagerPosition(
    managerId: string,
    f: { oracleId: string; expiry: bigint; strike: bigint; isUp: boolean },
    sender: string = ZERO_ADDRESS,
  ): Promise<bigint> {
    const tx = buildManagerPosition(this.cfg, managerId, f);
    const vals = await this.devInspectU64s(tx, sender, 1);
    return vals[0]!;
  }

  /** Read the PredictManager object and parse its owner. */
  async readManager(managerId: string): Promise<ManagerObject> {
    const obj = await this.sui.getObject({ id: managerId, options: { showContent: true, showOwner: true } });
    const content = obj.data?.content;
    if (!content || content.dataType !== 'moveObject') {
      throw new Error(`manager ${managerId} not found or not a Move object`);
    }
    const fields = content.fields as Record<string, unknown>;
    const owner = typeof fields.owner === 'string' ? fields.owner : '';
    return { managerId, owner, raw: obj.data };
  }

  /** Read the Predict object's vault + limiter state on-chain (Phase 5/6 read-only). */
  async readVault(): Promise<{
    balance: bigint;
    totalMtm: bigint;
    totalMaxPayout: bigint;
    plpSupply: bigint;
    tradingPaused: boolean;
    limiter: { available: bigint; capacity: bigint; refillRatePerMs: bigint; enabled: boolean };
  }> {
    const obj = await this.sui.getObject({ id: this.cfg.predictObjectId, options: { showContent: true } });
    const content = obj.data?.content;
    if (!content || content.dataType !== 'moveObject') throw new Error('Predict object not found');
    const f = content.fields as Record<string, unknown>;
    const v = (f.vault as { fields?: Record<string, unknown> })?.fields ?? {};
    const lim = (f.withdrawal_limiter as { fields?: Record<string, unknown> })?.fields ?? {};
    const b = (x: unknown): bigint => BigInt((x as string) ?? '0');
    // PLP supply lives in treasury_cap.total_supply.value (TreasuryCap wrapped in Predict).
    const tc = (f.treasury_cap as { fields?: Record<string, unknown> })?.fields ?? {};
    const ts = (tc.total_supply as { fields?: Record<string, unknown> })?.fields ?? {};
    // M5: warn loudly if the supply path shape changed — a silent 0 makes plpPrice wrong.
    if (ts.value === undefined) {
      console.warn('[predict-sdk] readVault: PLP total_supply.value not found — share math may be wrong');
    }
    return {
      balance: b(v.balance),
      totalMtm: b(v.total_mtm),
      totalMaxPayout: b(v.total_max_payout),
      plpSupply: b(ts.value),
      tradingPaused: f.trading_paused === true,
      limiter: {
        available: b(lim.available),
        capacity: b(lim.capacity),
        refillRatePerMs: b(lim.refill_rate_per_ms),
        enabled: lim.enabled === true,
      },
    };
  }

  /** User-held PLP coin balance (PLP is NOT in the manager — docs/03 §8). */
  async getPlpBalance(owner: string): Promise<bigint> {
    const r = await this.sui.getBalance({ owner, coinType: this.cfg.plpType });
    return BigInt(r.totalBalance);
  }

  /** Read and parse an AgentPolicy escrow object (Phase 4). */
  async readAgentPolicy(policyId: string): Promise<AgentPolicyState> {
    const obj = await this.sui.getObject({ id: policyId, options: { showContent: true } });
    const content = obj.data?.content;
    if (!content || content.dataType !== 'moveObject') {
      throw new Error(`agent policy ${policyId} not found or not a Move object`);
    }
    const f = content.fields as Record<string, unknown>;
    // escrow is a Balance<Quote>; SDK serializes a Balance as its inner u64 value (string).
    const escrowField = f.escrow as unknown;
    const budgetRemaining = BigInt(
      typeof escrowField === 'object' && escrowField
        ? ((escrowField as Record<string, unknown>).value as string) ?? '0'
        : (escrowField as string) ?? '0',
    );
    const strategyBytes = f.strategy as number[] | string | undefined;
    const strategy = Array.isArray(strategyBytes)
      ? new TextDecoder().decode(Uint8Array.from(strategyBytes))
      : String(strategyBytes ?? '');
    return {
      policyId,
      owner: String(f.owner ?? ''),
      agent: String(f.agent ?? ''),
      budgetRemaining,
      budgetCap: BigInt((f.budget_cap as string) ?? '0'),
      spent: BigInt((f.spent as string) ?? '0'),
      expiryEpoch: BigInt((f.expiry_epoch as string) ?? '0'),
      revoked: f.revoked === true,
      strategy,
      raw: obj.data,
    };
  }

  /** Find the created AgentPolicy id from a create_policy transaction's effects. */
  async findCreatedPolicyId(digest: string): Promise<string | undefined> {
    const tx = await this.sui.getTransactionBlock({ digest, options: { showObjectChanges: true } });
    const re = /::agent_policy::AgentPolicy(?:<|$)/;
    for (const ch of tx.objectChanges ?? []) {
      if (ch.type === 'created' && re.test(ch.objectType)) return ch.objectId;
    }
    return undefined;
  }

  /** Find the created PredictManager id from a create_manager transaction's effects. */
  async findCreatedManagerId(digest: string): Promise<string | undefined> {
    const tx = await this.sui.getTransactionBlock({ digest, options: { showObjectChanges: true } });
    const changes = tx.objectChanges ?? [];
    const re = /::predict_manager::PredictManager(?:<|$)/;
    for (const ch of changes) {
      if (ch.type === 'created' && re.test(ch.objectType)) return ch.objectId;
    }
    return undefined;
  }

  waitFor(digest: string) {
    return this.sui.waitForTransaction({ digest, options: { showEffects: true, showObjectChanges: true } });
  }

  // ── unsigned builders (bound to cfg) ──────────────────────────────────────────
  buildCreateManager(tx?: Transaction): Transaction {
    return buildCreateManager(this.cfg, tx);
  }
  buildDeposit(p: DepositParams, tx?: Transaction): Transaction {
    return buildDeposit(this.cfg, p, tx);
  }
  buildMint(p: MintParams, tx?: Transaction): Transaction {
    return buildMint(this.cfg, p, tx);
  }
  buildRedeem(p: RedeemParams, tx?: Transaction): Transaction {
    return buildRedeem(this.cfg, p, tx);
  }
  buildRedeemPermissionless(p: RedeemPermissionlessParams, tx?: Transaction): Transaction {
    return buildRedeemPermissionless(this.cfg, p, tx);
  }
  buildMintRange(p: RangeMintParams, tx?: Transaction): Transaction {
    return buildMintRange(this.cfg, p, tx);
  }
  buildRedeemRange(p: RangeRedeemParams, tx?: Transaction): Transaction {
    return buildRedeemRange(this.cfg, p, tx);
  }
  // ── vault LP (Phase 6) ──
  buildSupply(p: { amount: bigint; sender: string }, tx?: Transaction): Transaction {
    return buildSupply(this.cfg, p, tx);
  }
  buildWithdraw(p: { plpAmount: bigint; sender: string }, tx?: Transaction): Transaction {
    return buildWithdraw(this.cfg, p, tx);
  }
  // ── agent (Phase 4) ──
  buildCreatePolicy(p: CreatePolicyParams, tx?: Transaction): Transaction {
    return buildCreatePolicy(this.cfg, p, tx);
  }
  buildTopUp(p: { policyId: string; amount: bigint }, tx?: Transaction): Transaction {
    return buildTopUp(this.cfg, p, tx);
  }
  buildRevoke(p: { policyId: string; ownerAddress: string }, tx?: Transaction): Transaction {
    return buildRevoke(this.cfg, p, tx);
  }
  buildReturnFunds(p: { policyId: string; amount: bigint }, tx?: Transaction): Transaction {
    return buildReturnFunds(this.cfg, p, tx);
  }
  buildAgentTrade(agentAddress: string, p: AgentTradeParams, tx?: Transaction): Transaction {
    return buildAgentTrade(this.cfg, agentAddress, p, tx);
  }

  // ── internals ─────────────────────────────────────────────────────────────────
  private async devInspectU64s(tx: Transaction, sender: string, expected: number): Promise<bigint[]> {
    const res = await this.sui.devInspectTransactionBlock({ sender, transactionBlock: tx });
    if (res.error) throw new Error(`devInspect failed: ${res.error}`);
    // The last command holds the function's return values.
    const last = res.results?.[res.results.length - 1];
    const returnValues = last?.returnValues ?? [];
    const out: bigint[] = [];
    for (let i = 0; i < Math.min(expected, returnValues.length); i++) {
      const entry = returnValues[i];
      if (!entry) continue;
      const [bytes] = entry as [number[], string];
      out.push(BigInt(bcs.u64().parse(Uint8Array.from(bytes))));
    }
    if (out.length < expected) {
      throw new Error(`devInspect returned ${out.length} value(s), expected ${expected}`);
    }
    return out;
  }
}
