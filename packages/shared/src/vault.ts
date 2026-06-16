import { binaryUpPrice, type SVIParams } from './svi.js';

/**
 * PLP vault math (Phase 6, docs/06). Pure functions for share pricing, the
 * withdrawal limiter, and the "What If" simulator. All amounts are base units
 * (6-decimal dUSDC/PLP); prices are decimal $.
 *
 * Vault NAV (net asset value) = balance − total_mtm (outstanding liability the vault
 * owes open positions). PLP price = NAV / plpSupply.
 */

export interface VaultSnapshot {
  balance: bigint; // 1e6
  totalMtm: bigint; // 1e6 liability
  totalMaxPayout: bigint; // 1e6
  plpSupply: bigint; // 1e6
}

/** Net asset value (never below zero for display). */
export function vaultNav(v: VaultSnapshot): bigint {
  return v.balance > v.totalMtm ? v.balance - v.totalMtm : 0n;
}

/** PLP price in dUSDC (1.0 if no supply yet). Returns a float for display. */
export function plpPrice(v: VaultSnapshot): number {
  if (v.plpSupply === 0n) return 1;
  return Number(vaultNav(v)) / Number(v.plpSupply);
}

/** Expected PLP minted for a dUSDC supply (first depositor 1:1, else pro-rata of NAV). */
export function previewSupplyPlp(v: VaultSnapshot, amount: bigint): bigint {
  const nav = vaultNav(v);
  if (v.plpSupply === 0n || nav === 0n) return amount; // 1:1 bootstrap
  return (amount * v.plpSupply) / nav;
}

/** Expected dUSDC for burning `plp` (pro-rata of NAV). */
export function previewWithdrawDusdc(v: VaultSnapshot, plp: bigint): bigint {
  if (v.plpSupply === 0n) return 0n;
  return (plp * vaultNav(v)) / v.plpSupply;
}

export interface LimiterSnapshot {
  available: bigint;
  capacity: bigint;
  refillRatePerMs: bigint;
  enabled: boolean;
  lastUpdatedMs: number;
}

/** Limiter available now, refilled to `nowMs` (capped at capacity). */
export function limiterAvailableNow(l: LimiterSnapshot, nowMs: number): bigint {
  if (!l.enabled) return l.capacity; // disabled → no extra constraint
  const elapsed = BigInt(Math.max(0, nowMs - l.lastUpdatedMs));
  const refilled = l.available + elapsed * l.refillRatePerMs;
  return refilled > l.capacity ? l.capacity : refilled;
}

/** maxWithdrawable = min(NAV-coverage available, limiter available). */
export function maxWithdrawable(v: VaultSnapshot, l: LimiterSnapshot, nowMs: number): bigint {
  const coverage = v.balance > v.totalMaxPayout ? v.balance - v.totalMaxPayout : 0n;
  if (!l.enabled) return coverage;
  const lim = limiterAvailableNow(l, nowMs);
  return lim < coverage ? lim : coverage;
}

/**
 * "What If" simulator: given a hypothetical BTC move, recompute the vault's MTM
 * liability for one binary market and estimate the PLP price impact. This is a
 * single-market approximation for intuition (the real vault aggregates all markets).
 */
export interface WhatIfInput {
  vault: VaultSnapshot;
  spot: number; // current $
  forward: number; // current $
  svi: SVIParams;
  strike: number; // representative open strike $
  openUpQty: bigint; // 1e6 contracts the vault is short on UP
  pctMove: number; // e.g. +0.05 = +5%
}

export interface WhatIfResult {
  newForward: number;
  liabilityBefore: bigint; // 1e6
  liabilityAfter: bigint; // 1e6
  plpPriceBefore: number;
  plpPriceAfter: number;
  plpPriceChangePct: number;
}

export function whatIf(input: WhatIfInput): WhatIfResult {
  const probBefore = binaryUpPrice(input.strike, input.forward, input.svi);
  const newForward = input.forward * (1 + input.pctMove);
  const probAfter = binaryUpPrice(input.strike, newForward, input.svi);

  // Vault is short the UP contracts → its liability = qty · P(UP) · $1 face.
  const qty = input.openUpQty;
  const liabilityBefore = (qty * BigInt(Math.round(probBefore * 1e6))) / 1_000_000n;
  const liabilityAfter = (qty * BigInt(Math.round(probAfter * 1e6))) / 1_000_000n;

  const navBefore = vaultNav(input.vault);
  const deltaLiab = liabilityAfter - liabilityBefore;
  const navAfter = navBefore - deltaLiab > 0n ? navBefore - deltaLiab : 0n;

  const plpBefore = input.vault.plpSupply === 0n ? 1 : Number(navBefore) / Number(input.vault.plpSupply);
  const plpAfter = input.vault.plpSupply === 0n ? 1 : Number(navAfter) / Number(input.vault.plpSupply);
  return {
    newForward,
    liabilityBefore,
    liabilityAfter,
    plpPriceBefore: plpBefore,
    plpPriceAfter: plpAfter,
    plpPriceChangePct: plpBefore > 0 ? ((plpAfter - plpBefore) / plpBefore) * 100 : 0,
  };
}
