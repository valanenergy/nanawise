#[test_only]
module tournament::tournament_tests;

use sui::coin;
use sui::test_scenario::{Self as ts, Scenario};
use tournament::tournament::{Self as tm, Tournament};

public struct TUSD has drop {}

const ADMIN: address = @0xA;
const ALICE: address = @0xB;
const BOB: address = @0xC;
const STRANGER: address = @0xD;

const ENotAdmin: u64 = 0;
const EAlreadyJoined: u64 = 1;
const EWrongFee: u64 = 4;
const ENotEntrant: u64 = 5;
const EAlreadySettled: u64 = 3;
const ETooEarly: u64 = 6;

fun create(sc: &mut Scenario, fee: u64, bps: u64) {
    let ctx = sc.ctx();
    let _ = tm::create<TUSD>(fee, bps, 0, 1_000_000, ctx);
}

fun joinAs(sc: &mut Scenario, who: address, amount: u64) {
    sc.next_tx(who);
    let mut t = sc.take_shared<Tournament<TUSD>>();
    let c = coin::mint_for_testing<TUSD>(amount, sc.ctx());
    tm::join<TUSD>(&mut t, c, 100, sc.ctx());
    ts::return_shared(t);
}

#[test]
fun create_join_payout_flow() {
    let mut sc = ts::begin(ADMIN);
    create(&mut sc, 1_000_000, 250); // 1 dUSDC fee, 2.5% platform
    joinAs(&mut sc, ALICE, 1_000_000);
    joinAs(&mut sc, BOB, 1_000_000);

    sc.next_tx(ADMIN);
    let mut t = sc.take_shared<Tournament<TUSD>>();
    assert!(tm::pool(&t) == 2_000_000, 0);
    assert!(tm::entrant_count(&t) == 2, 1);
    let feeCoin = tm::payout<TUSD>(&mut t, ALICE, 2_000_000, sc.ctx());
    // platform fee = 2_000_000 * 250 / 10000 = 50_000
    assert!(coin::value(&feeCoin) == 50_000, 2);
    assert!(tm::is_settled(&t), 3);
    assert!(tm::pool(&t) == 0, 4);
    coin::burn_for_testing(feeCoin);
    ts::return_shared(t);

    // Alice received the prize (1_950_000)
    sc.next_tx(ALICE);
    let prize = sc.take_from_sender<coin::Coin<TUSD>>();
    assert!(coin::value(&prize) == 1_950_000, 5);
    coin::burn_for_testing(prize);
    sc.end();
}

#[test, expected_failure(abort_code = EWrongFee, location = tournament::tournament)]
fun wrong_fee_aborts() {
    let mut sc = ts::begin(ADMIN);
    create(&mut sc, 1_000_000, 0);
    joinAs(&mut sc, ALICE, 500_000); // underpays
    sc.end();
}

#[test, expected_failure(abort_code = EAlreadyJoined, location = tournament::tournament)]
fun double_join_aborts() {
    let mut sc = ts::begin(ADMIN);
    create(&mut sc, 1_000_000, 0);
    joinAs(&mut sc, ALICE, 1_000_000);
    joinAs(&mut sc, ALICE, 1_000_000);
    sc.end();
}

#[test, expected_failure(abort_code = ENotAdmin, location = tournament::tournament)]
fun non_admin_payout_aborts() {
    let mut sc = ts::begin(ADMIN);
    create(&mut sc, 1_000_000, 0);
    joinAs(&mut sc, ALICE, 1_000_000);
    sc.next_tx(STRANGER);
    let mut t = sc.take_shared<Tournament<TUSD>>();
    let c = tm::payout<TUSD>(&mut t, ALICE, 2_000_000, sc.ctx());
    coin::burn_for_testing(c);
    ts::return_shared(t);
    sc.end();
}

#[test, expected_failure(abort_code = ETooEarly, location = tournament::tournament)]
fun payout_before_end_aborts() {
    let mut sc = ts::begin(ADMIN);
    create(&mut sc, 1_000_000, 0); // end_ms = 1_000_000
    joinAs(&mut sc, ALICE, 1_000_000);
    sc.next_tx(ADMIN);
    let mut t = sc.take_shared<Tournament<TUSD>>();
    let c = tm::payout<TUSD>(&mut t, ALICE, 500_000, sc.ctx()); // now < end_ms
    coin::burn_for_testing(c);
    ts::return_shared(t);
    sc.end();
}

#[test, expected_failure(abort_code = ENotEntrant, location = tournament::tournament)]
fun payout_to_non_entrant_aborts() {
    let mut sc = ts::begin(ADMIN);
    create(&mut sc, 1_000_000, 0);
    joinAs(&mut sc, ALICE, 1_000_000);
    sc.next_tx(ADMIN);
    let mut t = sc.take_shared<Tournament<TUSD>>();
    let c = tm::payout<TUSD>(&mut t, STRANGER, 2_000_000, sc.ctx()); // never joined
    coin::burn_for_testing(c);
    ts::return_shared(t);
    sc.end();
}

#[test, expected_failure(abort_code = EAlreadySettled, location = tournament::tournament)]
fun double_payout_aborts() {
    let mut sc = ts::begin(ADMIN);
    create(&mut sc, 1_000_000, 0);
    joinAs(&mut sc, ALICE, 1_000_000);
    sc.next_tx(ADMIN);
    let mut t = sc.take_shared<Tournament<TUSD>>();
    let c1 = tm::payout<TUSD>(&mut t, ALICE, 2_000_000, sc.ctx());
    coin::burn_for_testing(c1);
    let c2 = tm::payout<TUSD>(&mut t, ALICE, 2_000_000, sc.ctx()); // already settled
    coin::burn_for_testing(c2);
    ts::return_shared(t);
    sc.end();
}
