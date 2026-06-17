/// tournament — a trustless prize-pool escrow for group competitions (Phase 7, docs/07).
///
/// A `PredictManager`'s deposit is owner-gated, so it can't accept third-party entry
/// fees — this custom object solves that (the DeFi-track "conditional payments"
/// bullet). It holds `Balance<Quote>` (dUSDC), `join()` adds each entrant's coin, and
/// an admin/bot-only `payout()` releases the whole pool to the declared winner.
///
/// Trust model: entrants' fees are physically escrowed; the admin can only RELEASE
/// the pool (it can't withdraw arbitrary amounts), exactly once, after which the
/// tournament is settled. Ranking is computed off-chain from on-chain settlement
/// events; the keeper is the sole caller of `payout`.
module tournament::tournament;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::event;

const ENotAdmin: u64 = 0;
const EAlreadyJoined: u64 = 1;
const EClosed: u64 = 2;
const EAlreadySettled: u64 = 3;
const EWrongFee: u64 = 4;
const ENotEntrant: u64 = 5;
const ETooEarly: u64 = 6;
const EBadFee: u64 = 7;

const MAX_PLATFORM_FEE_BPS: u64 = 1_000; // ≤10% cap

public struct Tournament<phantom Quote> has key {
    id: UID,
    admin: address, // bot/keeper — only one who can pay out
    entry_fee: u64,
    pool: Balance<Quote>,
    entrants: vector<address>,
    platform_fee_bps: u64, // basis points skimmed to admin on payout (e.g. 250 = 2.5%)
    start_ms: u64,
    end_ms: u64,
    settled: bool,
}

public struct TournamentCreated has copy, drop {
    tournament_id: ID,
    admin: address,
    entry_fee: u64,
    end_ms: u64,
}

public struct TournamentJoined has copy, drop {
    tournament_id: ID,
    entrant: address,
    pool: u64,
}

public struct TournamentPaid has copy, drop {
    tournament_id: ID,
    winner: address,
    prize: u64,
    platform_fee: u64,
}

/// Create a tournament. `admin` (the bot/keeper) settles it later.
public fun create<Quote>(
    entry_fee: u64,
    platform_fee_bps: u64,
    start_ms: u64,
    end_ms: u64,
    ctx: &mut TxContext,
): ID {
    assert!(platform_fee_bps <= MAX_PLATFORM_FEE_BPS, EBadFee);
    let admin = ctx.sender();
    let t = Tournament<Quote> {
        id: object::new(ctx),
        admin,
        entry_fee,
        pool: balance::zero<Quote>(),
        entrants: vector[],
        platform_fee_bps,
        start_ms,
        end_ms,
        settled: false,
    };
    let id = object::id(&t);
    event::emit(TournamentCreated { tournament_id: id, admin, entry_fee, end_ms });
    transfer::share_object(t);
    id
}

/// Join by paying exactly `entry_fee`. One entry per address, before `end_ms`.
public fun join<Quote>(t: &mut Tournament<Quote>, fee: Coin<Quote>, now_ms: u64, ctx: &TxContext) {
    assert!(!t.settled, EAlreadySettled);
    assert!(now_ms < t.end_ms, EClosed);
    assert!(fee.value() == t.entry_fee, EWrongFee);
    let who = ctx.sender();
    assert!(!t.entrants.contains(&who), EAlreadyJoined);
    t.entrants.push_back(who);
    t.pool.join(fee.into_balance());
    event::emit(TournamentJoined { tournament_id: object::id(t), entrant: who, pool: t.pool.value() });
}

/// Admin-only: release the pool to `winner` (minus the platform fee), exactly once,
/// and only AFTER `end_ms` (H2 — no early settlement). `winner` must be an entrant.
/// Winner selection is trusted to the admin (keeper), derived from on-chain settlement
/// events off-chain; the on-chain guarantees are: admin-only, post-end, entrant-only, once.
public fun payout<Quote>(
    t: &mut Tournament<Quote>,
    winner: address,
    now_ms: u64,
    ctx: &mut TxContext,
): Coin<Quote> {
    assert!(ctx.sender() == t.admin, ENotAdmin);
    assert!(!t.settled, EAlreadySettled);
    assert!(now_ms >= t.end_ms, ETooEarly);
    assert!(t.entrants.contains(&winner), ENotEntrant);
    t.settled = true;

    let total = t.pool.value();
    let fee = (total * t.platform_fee_bps) / 10_000;
    let prize = total - fee;

    let prize_coin = coin::from_balance(t.pool.split(prize), ctx);
    transfer::public_transfer(prize_coin, winner);
    event::emit(TournamentPaid { tournament_id: object::id(t), winner, prize, platform_fee: fee });

    // remaining balance (= fee) returned to the admin caller
    let remaining = t.pool.value();
    coin::from_balance(t.pool.split(remaining), ctx)
}

// --- read accessors ---
public fun pool<Quote>(t: &Tournament<Quote>): u64 { t.pool.value() }
public fun entry_fee<Quote>(t: &Tournament<Quote>): u64 { t.entry_fee }
public fun entrant_count<Quote>(t: &Tournament<Quote>): u64 { t.entrants.length() }
public fun is_settled<Quote>(t: &Tournament<Quote>): bool { t.settled }
public fun admin<Quote>(t: &Tournament<Quote>): address { t.admin }
public fun has_joined<Quote>(t: &Tournament<Quote>, who: address): bool { t.entrants.contains(&who) }
public fun end_ms<Quote>(t: &Tournament<Quote>): u64 { t.end_ms }
