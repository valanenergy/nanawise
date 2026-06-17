#[test_only]
module activity_log::activity_log_tests;

use activity_log::activity_log as al;
use sui::clock;
use sui::test_scenario::{Self as ts};

#[test]
fun emits_one_action_event() {
    let mut sc = ts::begin(@0xA);
    let clk = clock::create_for_testing(sc.ctx());
    al::emit_action(
        object::id_from_address(@0x1), // policy_id
        @0xB, // agent
        @0xA, // owner
        0, // action_type = mint
        @0x2, // oracle_id
        65_000_000_000_000, // strike (1e9-scaled $65,000)
        true, // is_up
        1_000_000, // quantity
        10_000, // amount_spent
        90_000, // budget_remaining
        b"vol-harvest",
        &clk,
    );
    clock::destroy_for_testing(clk);
    let effects = sc.end();
    assert!(ts::num_user_events(&effects) == 1, 0);
}
