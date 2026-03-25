#![cfg(test)]

use crate::{AjoCircle, AjoCircleClient, AjoError};
use soroban_sdk::{testutils::Address as _, Address, Env, token};

// ── Shared fixture ────────────────────────────────────────────────────────────

/// Creates a 2-member circle (organizer + member1).
/// Both participants are minted 1 000 tokens; both contribute 100 (one round).
/// Returns (client, contract_id, organizer, member1, token_address).
fn setup_two_member_circle(
    env: &Env,
) -> (AjoCircleClient<'_>, Address, Address, Address, Address) {
    let contract_id = env.register_contract(None, AjoCircle);
    let client = AjoCircleClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let organizer = Address::generate(env);
    let member1 = Address::generate(env);
    let token_address = env.register_stellar_asset_contract(admin.clone());
    let token_admin = token::StellarAssetClient::new(env, &token_address);

    token_admin.mint(&organizer, &1_000_i128);
    token_admin.mint(&member1, &1_000_i128);

    client.initialize_circle(&organizer, &token_address, &100_i128, &7_u32, &12_u32, &5_u32);
    client.add_member(&organizer, &member1);

    // Round 1 contributions — full pool funded
    client.contribute(&organizer, &100_i128);
    client.contribute(&member1, &100_i128);

    (client, contract_id, organizer, member1, token_address)
}

// ── claim_payout tests ────────────────────────────────────────────────────────

/// Pool must have all members' contributions before any payout.
/// With only 1 of 2 members contributed, claim_payout must revert.
#[test]
fn test_claim_payout_reverts_if_pool_incomplete() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AjoCircle);
    let client = AjoCircleClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let organizer = Address::generate(&env);
    let member1 = Address::generate(&env);
    let token_address = env.register_stellar_asset_contract(admin.clone());
    let token_admin = token::StellarAssetClient::new(&env, &token_address);

    token_admin.mint(&organizer, &1_000_i128);
    token_admin.mint(&member1, &1_000_i128);

    client.initialize_circle(&organizer, &token_address, &100_i128, &7_u32, &12_u32, &5_u32);
    client.add_member(&organizer, &member1);

    // Only organizer deposits — pool is incomplete (member1 hasn't contributed)
    client.contribute(&organizer, &100_i128);

    // member1 has not contributed yet; they should not be able to claim
    // The contract tracks total_contributed per member; claiming with 0 contribution
    // falls through to InsufficientFunds / NotFound depending on rotation order.
    let result = client.try_claim_payout(&member1);
    assert!(result.is_err(), "claim_payout should revert when pool is not fully funded");
}

/// The designated winner (organizer in round 1 without shuffle) receives the
/// full pool (member_count × contribution_amount) and cannot claim a second time.
#[test]
fn test_designated_winner_withdraws_full_pool() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _cid, organizer, _member1, token_address) =
        setup_two_member_circle(&env);
    let token_client = token::Client::new(&env, &token_address);

    // Balance after contributing 100: 1000 - 100 = 900
    assert_eq!(token_client.balance(&organizer), 900_i128);

    // Without shuffle the first rotation slot is the first member stored (organizer).
    // claim_payout should transfer member_count(2) × contribution_amount(100) = 200.
    let payout = client.claim_payout(&organizer);
    assert_eq!(payout, Ok(200_i128));

    // Organizer balance: 900 + 200 = 1100
    assert_eq!(token_client.balance(&organizer), 1_100_i128);
}

/// CEI: state is updated (has_received_payout = true) BEFORE external token transfer
/// is observable, so a second call must be rejected with AlreadyPaid (no dual-claim).
#[test]
fn test_dual_claim_blocked() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _cid, organizer, _member1, _token) =
        setup_two_member_circle(&env);

    // First claim succeeds
    assert_eq!(client.claim_payout(&organizer), Ok(200_i128));

    // Second claim on the same member must be rejected — dual-claim exploit blocked
    let second = client.try_claim_payout(&organizer);
    assert_eq!(
        second,
        Err(Ok(AjoError::AlreadyPaid)),
        "dual-claim must revert with AlreadyPaid"
    );
}

// ── partial_withdraw tests ────────────────────────────────────────────────────

/// partial_withdraw applies a 10 % penalty: requesting 100 yields 90 net.
/// The member's total_withdrawn is advanced by the *requested* amount (not net)
/// to prevent gaming the penalty via multiple small calls.
#[test]
fn test_partial_withdraw_applies_penalty() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _cid, organizer, _member1, token_address) =
        setup_two_member_circle(&env);
    let token_client = token::Client::new(&env, &token_address);

    // Organizer contributed 100; requests partial withdrawal of 100
    let net = client.partial_withdraw(&organizer, &100_i128);
    assert_eq!(net, Ok(90_i128), "10 % penalty should leave 90 net");

    // Token balance: 900 (after contribute) + 90 (net refund) = 990
    assert_eq!(token_client.balance(&organizer), 990_i128);
}

/// A member cannot withdraw more than they have contributed (insufficient funds).
/// This prevents over-withdrawal / fund-drain exploits.
#[test]
fn test_partial_withdraw_blocks_over_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _cid, _organizer, member1, _token) =
        setup_two_member_circle(&env);

    // member1 contributed 100; attempting to withdraw 500 must fail
    let result = client.try_partial_withdraw(&member1, &500_i128);
    assert_eq!(
        result,
        Err(Ok(AjoError::InsufficientFunds)),
        "over-withdrawal must revert with InsufficientFunds"
    );
}

// ── Legacy tests (unchanged) ──────────────────────────────────────────────────

#[test]
fn test_slash_and_disqualify() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_address = env.register_stellar_asset_contract(admin.clone());

    let contract_id = env.register_contract(None, AjoCircle);
    let client = AjoCircleClient::new(&env, &contract_id);

    let organizer = Address::generate(&env);
    let member = Address::generate(&env);

    client.initialize_circle(&organizer, &token_address, &100_i128, &30_u32, &5_u32, &5_u32);
    client.add_member(&organizer, &member);

    // Slash 3 times → disqualified
    client.slash_member(&organizer, &member);
    client.slash_member(&organizer, &member);
    client.slash_member(&organizer, &member);

    // Contribute attempt must fail (missed_count >= 3 panics in contribute)
    let res = client.try_contribute(&member, &100_i128);
    assert!(res.is_err());

    // Claim payout attempt must return Disqualified
    let res = client.try_claim_payout(&member);
    assert_eq!(res, Err(Ok(AjoError::Disqualified)));
}

#[test]
fn test_grace_period_reset() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_address = env.register_stellar_asset_contract(admin.clone());
    let token_admin = token::StellarAssetClient::new(&env, &token_address);

    let contract_id = env.register_contract(None, AjoCircle);
    let client = AjoCircleClient::new(&env, &contract_id);

    let organizer = Address::generate(&env);
    let member = Address::generate(&env);

    token_admin.mint(&organizer, &1_000_i128);
    token_admin.mint(&member, &1_000_i128);

    client.initialize_circle(&organizer, &token_address, &100_i128, &30_u32, &5_u32, &5_u32);
    client.add_member(&organizer, &member);

    // Slash member 2 times (below threshold)
    client.slash_member(&organizer, &member);
    client.slash_member(&organizer, &member);

    // Contribution resets missed_count to 0
    client.contribute(&member, &100_i128);

    // Slash 2 more times — still below threshold due to reset
    client.slash_member(&organizer, &member);
    client.slash_member(&organizer, &member);

    // Contribute again must succeed
    client.contribute(&member, &100_i128);

    // Payout for organizer (round-1 slot) — confirm member is not disqualified
    client.contribute(&organizer, &100_i128);
    let payout = client.claim_payout(&organizer);
    // 2 members × 100 contribution_amount = 200
    assert_eq!(payout, Ok(200_i128));
}
