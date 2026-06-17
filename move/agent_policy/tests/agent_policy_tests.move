#[test_only]
module agent_policy::agent_policy_tests;

use agent_policy::agent_policy::{Self as ap, AgentPolicy};
use sui::clock;
use sui::coin;
use sui::test_scenario::{Self as ts, Scenario};

public struct TUSD has drop {}

const OWNER: address = @0xA;
const AGENT: address = @0xB;
const STRANGER: address = @0xC;

// Mirror of the module's private abort codes (for expected_failure assertions).
const ENotOwner: u64 = 0;
const ENotAgent: u64 = 1;
const ERevoked: u64 = 2;
const EExpired: u64 = 3;
const EInsufficient: u64 = 4;

fun new_policy(sc: &mut Scenario, amount: u64, expiry: u64) {
    let ctx = sc.ctx();
    let funding = coin::mint_for_testing<TUSD>(amount, ctx);
    let _ = ap::create_policy<TUSD>(AGENT, expiry, b"vol-harvest", funding, ctx);
}

#[test]
fun create_and_read() {
    let mut sc = ts::begin(OWNER);
    new_policy(&mut sc, 1_000_000, 5);
    sc.next_tx(OWNER);
    let policy = sc.take_shared<AgentPolicy<TUSD>>();
    assert!(ap::budget_remaining(&policy) == 1_000_000, 0);
    assert!(ap::budget_cap(&policy) == 1_000_000, 1);
    assert!(ap::spent(&policy) == 0, 2);
    assert!(!ap::is_revoked(&policy), 3);
    assert!(ap::owner(&policy) == OWNER, 4);
    assert!(ap::agent(&policy) == AGENT, 5);
    assert!(ap::expiry_epoch(&policy) == 5, 6);
    ts::return_shared(policy);
    sc.end();
}

#[test]
fun request_decrements_and_returns_coin() {
    let mut sc = ts::begin(OWNER);
    new_policy(&mut sc, 1_000_000, 5);
    sc.next_tx(AGENT);
    let mut policy = sc.take_shared<AgentPolicy<TUSD>>();
    let clk = clock::create_for_testing(sc.ctx());
    let c = ap::request_funds<TUSD>(&mut policy, 400_000, &clk, sc.ctx());
    assert!(coin::value(&c) == 400_000, 0);
    assert!(ap::budget_remaining(&policy) == 600_000, 1);
    assert!(ap::spent(&policy) == 400_000, 2);
    coin::burn_for_testing(c);
    clock::destroy_for_testing(clk);
    ts::return_shared(policy);
    sc.end();
}

#[test, expected_failure(abort_code = EInsufficient, location = agent_policy::agent_policy)]
fun over_budget_aborts() {
    let mut sc = ts::begin(OWNER);
    new_policy(&mut sc, 1_000_000, 5);
    sc.next_tx(AGENT);
    let mut policy = sc.take_shared<AgentPolicy<TUSD>>();
    let clk = clock::create_for_testing(sc.ctx());
    let c = ap::request_funds<TUSD>(&mut policy, 2_000_000, &clk, sc.ctx());
    coin::burn_for_testing(c);
    clock::destroy_for_testing(clk);
    ts::return_shared(policy);
    sc.end();
}

#[test, expected_failure(abort_code = ENotAgent, location = agent_policy::agent_policy)]
fun non_agent_request_aborts() {
    let mut sc = ts::begin(OWNER);
    new_policy(&mut sc, 1_000_000, 5);
    sc.next_tx(STRANGER);
    let mut policy = sc.take_shared<AgentPolicy<TUSD>>();
    let clk = clock::create_for_testing(sc.ctx());
    let c = ap::request_funds<TUSD>(&mut policy, 100_000, &clk, sc.ctx());
    coin::burn_for_testing(c);
    clock::destroy_for_testing(clk);
    ts::return_shared(policy);
    sc.end();
}

#[test, expected_failure(abort_code = ERevoked, location = agent_policy::agent_policy)]
fun revoked_request_aborts() {
    let mut sc = ts::begin(OWNER);
    new_policy(&mut sc, 1_000_000, 5);
    // owner revokes
    sc.next_tx(OWNER);
    let mut policy = sc.take_shared<AgentPolicy<TUSD>>();
    let refund = ap::revoke<TUSD>(&mut policy, sc.ctx());
    coin::burn_for_testing(refund);
    ts::return_shared(policy);
    // agent now tries to pull → ERevoked
    sc.next_tx(AGENT);
    let mut policy2 = sc.take_shared<AgentPolicy<TUSD>>();
    let clk = clock::create_for_testing(sc.ctx());
    let c = ap::request_funds<TUSD>(&mut policy2, 100_000, &clk, sc.ctx());
    coin::burn_for_testing(c);
    clock::destroy_for_testing(clk);
    ts::return_shared(policy2);
    sc.end();
}

#[test, expected_failure(abort_code = EExpired, location = agent_policy::agent_policy)]
fun expired_request_aborts() {
    let mut sc = ts::begin(OWNER);
    new_policy(&mut sc, 1_000_000, 0); // expiry at epoch 0
    sc.next_epoch(AGENT); // advance to epoch 1 > 0
    let mut policy = sc.take_shared<AgentPolicy<TUSD>>();
    let clk = clock::create_for_testing(sc.ctx());
    let c = ap::request_funds<TUSD>(&mut policy, 100_000, &clk, sc.ctx());
    coin::burn_for_testing(c);
    clock::destroy_for_testing(clk);
    ts::return_shared(policy);
    sc.end();
}

#[test]
fun revoke_returns_all_and_flags() {
    let mut sc = ts::begin(OWNER);
    new_policy(&mut sc, 1_000_000, 5);
    // agent spends some first
    sc.next_tx(AGENT);
    let mut policy = sc.take_shared<AgentPolicy<TUSD>>();
    let clk = clock::create_for_testing(sc.ctx());
    let spent = ap::request_funds<TUSD>(&mut policy, 250_000, &clk, sc.ctx());
    coin::burn_for_testing(spent);
    clock::destroy_for_testing(clk);
    ts::return_shared(policy);
    // owner revokes → gets remaining 750_000
    sc.next_tx(OWNER);
    let mut policy2 = sc.take_shared<AgentPolicy<TUSD>>();
    let refund = ap::revoke<TUSD>(&mut policy2, sc.ctx());
    assert!(coin::value(&refund) == 750_000, 0);
    assert!(ap::is_revoked(&policy2), 1);
    assert!(ap::budget_remaining(&policy2) == 0, 2);
    coin::burn_for_testing(refund);
    ts::return_shared(policy2);
    sc.end();
}

#[test, expected_failure(abort_code = ENotOwner, location = agent_policy::agent_policy)]
fun non_owner_revoke_aborts() {
    let mut sc = ts::begin(OWNER);
    new_policy(&mut sc, 1_000_000, 5);
    sc.next_tx(STRANGER);
    let mut policy = sc.take_shared<AgentPolicy<TUSD>>();
    let refund = ap::revoke<TUSD>(&mut policy, sc.ctx());
    coin::burn_for_testing(refund);
    ts::return_shared(policy);
    sc.end();
}

#[test]
fun top_up_increases_budget() {
    let mut sc = ts::begin(OWNER);
    new_policy(&mut sc, 1_000_000, 5);
    sc.next_tx(OWNER);
    let mut policy = sc.take_shared<AgentPolicy<TUSD>>();
    let more = coin::mint_for_testing<TUSD>(500_000, sc.ctx());
    ap::top_up<TUSD>(&mut policy, more, sc.ctx());
    assert!(ap::budget_remaining(&policy) == 1_500_000, 0);
    assert!(ap::budget_cap(&policy) == 1_500_000, 1);
    ts::return_shared(policy);
    sc.end();
}

#[test, expected_failure(abort_code = ERevoked, location = agent_policy::agent_policy)]
fun top_up_after_revoke_aborts() {
    let mut sc = ts::begin(OWNER);
    new_policy(&mut sc, 1_000_000, 5);
    sc.next_tx(OWNER);
    let mut policy = sc.take_shared<AgentPolicy<TUSD>>();
    let refund = ap::revoke<TUSD>(&mut policy, sc.ctx());
    coin::burn_for_testing(refund);
    let more = coin::mint_for_testing<TUSD>(500_000, sc.ctx());
    ap::top_up<TUSD>(&mut policy, more, sc.ctx()); // aborts ERevoked
    ts::return_shared(policy);
    sc.end();
}

#[test]
fun return_funds_adds_back() {
    let mut sc = ts::begin(OWNER);
    new_policy(&mut sc, 1_000_000, 5);
    sc.next_tx(AGENT);
    let mut policy = sc.take_shared<AgentPolicy<TUSD>>();
    let clk = clock::create_for_testing(sc.ctx());
    let pulled = ap::request_funds<TUSD>(&mut policy, 400_000, &clk, sc.ctx());
    assert!(ap::budget_remaining(&policy) == 600_000, 0);
    // simulate sweeping a profit/residual back
    ap::return_funds<TUSD>(&mut policy, pulled);
    assert!(ap::budget_remaining(&policy) == 1_000_000, 1);
    clock::destroy_for_testing(clk);
    ts::return_shared(policy);
    sc.end();
}

#[test]
fun request_at_expiry_epoch_boundary_ok() {
    let mut sc = ts::begin(OWNER);
    new_policy(&mut sc, 1_000_000, 0); // expiry epoch 0
    sc.next_tx(AGENT); // still epoch 0 (next_tx does not advance epoch)
    let mut policy = sc.take_shared<AgentPolicy<TUSD>>();
    let clk = clock::create_for_testing(sc.ctx());
    let c = ap::request_funds<TUSD>(&mut policy, 100_000, &clk, sc.ctx()); // epoch == expiry → OK (<=)
    assert!(coin::value(&c) == 100_000, 0);
    coin::burn_for_testing(c);
    clock::destroy_for_testing(clk);
    ts::return_shared(policy);
    sc.end();
}

#[test]
fun return_funds_is_permissionless() {
    let mut sc = ts::begin(OWNER);
    new_policy(&mut sc, 1_000_000, 5);
    sc.next_tx(STRANGER); // anyone can fund-in (intentional, docs/04)
    let mut policy = sc.take_shared<AgentPolicy<TUSD>>();
    let c = coin::mint_for_testing<TUSD>(50_000, sc.ctx());
    ap::return_funds<TUSD>(&mut policy, c);
    assert!(ap::budget_remaining(&policy) == 1_050_000, 0);
    ts::return_shared(policy);
    sc.end();
}
