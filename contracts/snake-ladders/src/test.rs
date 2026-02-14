#![cfg(test)]

//! Game flow unit tests.
//!
//! These use a mock verifier to focus on game logic: turns, positions, win conditions.
//! For **real ZK proof verification**, see `integration_test.rs` which deploys the
//! actual UltraHonk verifier WASM with real VK and proof artifacts.

use soroban_sdk::{
    contract, contractimpl, testutils::Address as _, Address, Bytes, BytesN, Env,
};

use crate::{GameStatus, SnakeLaddersContract, SnakeLaddersContractClient};

// Mock GameHub (accepts all start_game/end_game calls)

#[contract]
pub struct MockGameHub;

#[contractimpl]
impl MockGameHub {
    pub fn start_game(
        _env: Env,
        _game_id: Address,
        _session_id: u32,
        _player1: Address,
        _player2: Address,
        _player1_points: i128,
        _player2_points: i128,
    ) {
        // No-op: just accept the call
    }

    pub fn end_game(_env: Env, _session_id: u32, _player1_won: bool) {
        // No-op: just accept the call
    }
}

// Mock Verifier (accepts all proofs for game flow testing only)

#[contract]
pub struct MockVerifier;

#[contractimpl]
impl MockVerifier {
    pub fn verify_proof(
        _env: Env,
        _public_inputs: Bytes,
        _proof_bytes: Bytes,
    ) {
        // Always passes
    }
}

// Helper to set up a full game environment

struct TestEnv<'a> {
    env: Env,
    client: SnakeLaddersContractClient<'a>,
    player1: Address,
    player2: Address,
}

fn setup() -> TestEnv<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);

    // Deploy mocks
    let hub_id = env.register(MockGameHub, ());
    let verifier_id = env.register(MockVerifier, ());

    // Deploy game contract
    let contract_id =
        env.register(SnakeLaddersContract, (&admin, &verifier_id, &hub_id));
    let client = SnakeLaddersContractClient::new(&env, &contract_id);

    TestEnv {
        env,
        client,
        player1,
        player2,
    }
}

// Tests

#[test]
fn test_create_game() {
    let t = setup();
    t.client
        .create_game(&1u32, &t.player1, &t.player2, &100, &100, &10);

    let game = t.client.get_game(&1u32);
    assert_eq!(game.status, GameStatus::Setup);
    assert_eq!(game.p1_position, 0);
    assert_eq!(game.p2_position, 0);
    assert_eq!(game.snake_count, 10);
    assert_eq!(game.player1_points, 100);
}

#[test]
fn test_setup_board_and_activate() {
    let t = setup();
    t.client
        .create_game(&1u32, &t.player1, &t.player2, &100, &100, &10);

    let hash1 = BytesN::from_array(&t.env, &[1u8; 32]);
    let hash2 = BytesN::from_array(&t.env, &[2u8; 32]);

    // P1 sets board
    t.client.setup_board(&1u32, &t.player1, &hash1);
    let game = t.client.get_game(&1u32);
    assert_eq!(game.status, GameStatus::Setup); // still setup

    // P2 sets board → now Active
    t.client.setup_board(&1u32, &t.player2, &hash2);
    let game = t.client.get_game(&1u32);
    assert_eq!(game.status, GameStatus::Active);
}

#[test]
fn test_roll_dice() {
    let t = setup();
    t.client
        .create_game(&1u32, &t.player1, &t.player2, &100, &100, &10);

    let hash1 = BytesN::from_array(&t.env, &[1u8; 32]);
    let hash2 = BytesN::from_array(&t.env, &[2u8; 32]);
    t.client.setup_board(&1u32, &t.player1, &hash1);
    t.client.setup_board(&1u32, &t.player2, &hash2);

    let roll = t.client.roll_dice(&1u32);
    assert!(roll >= 1 && roll <= 6);

    // Verify pending roll is set
    let game = t.client.get_game(&1u32);
    assert_eq!(game.pending_roll, Some(roll));
}

#[test]
fn test_full_game_safe_move() {
    let t = setup();
    t.client
        .create_game(&1u32, &t.player1, &t.player2, &100, &100, &10);

    let hash1 = BytesN::from_array(&t.env, &[1u8; 32]);
    let hash2 = BytesN::from_array(&t.env, &[2u8; 32]);
    t.client.setup_board(&1u32, &t.player1, &hash1);
    t.client.setup_board(&1u32, &t.player2, &hash2);

    // P1's turn: roll
    let roll = t.client.roll_dice(&1u32);

    // P2 (dealer) submits outcome: safe move
    let proof = Bytes::from_array(&t.env, &[0u8; 32]);
    let pub_inputs = Bytes::from_array(&t.env, &[0u8; 32]);

    t.client.submit_outcome(
        &1u32,
        &proof,
        &pub_inputs,
        &roll,       // claimed_dest = roll (starting from 0)
        &false,      // no snake hit
        &hash2,      // board unchanged
    );

    let game = t.client.get_game(&1u32);
    assert_eq!(game.p1_position, roll);
    assert_eq!(game.p1_turn, false); // P2's turn
    assert!(game.pending_roll.is_none());
}

#[test]
fn test_full_game_snake_hit() {
    let t = setup();
    t.client
        .create_game(&1u32, &t.player1, &t.player2, &100, &100, &10);

    let hash1 = BytesN::from_array(&t.env, &[1u8; 32]);
    let hash2 = BytesN::from_array(&t.env, &[2u8; 32]);
    t.client.setup_board(&1u32, &t.player1, &hash1);
    t.client.setup_board(&1u32, &t.player2, &hash2);

    // P1 rolls
    let _roll = t.client.roll_dice(&1u32);

    // P2 submits outcome: snake hit! Player sent back to position 2.
    let proof = Bytes::from_array(&t.env, &[0u8; 32]);
    let pub_inputs = Bytes::from_array(&t.env, &[0u8; 32]);
    let new_hash = BytesN::from_array(&t.env, &[3u8; 32]); // Board changed after reshuffle

    t.client.submit_outcome(
        &1u32,
        &proof,
        &pub_inputs,
        &2u32,      // penalty destination
        &true,       // snake hit
        &new_hash,   // new board after reshuffle
    );

    let game = t.client.get_game(&1u32);
    assert_eq!(game.p1_position, 2);
    assert_eq!(game.p2_board_hash, new_hash); // Board was updated
    assert_eq!(game.p1_turn, false);
}

#[test]
fn test_win_condition() {
    let t = setup();
    t.client
        .create_game(&1u32, &t.player1, &t.player2, &100, &100, &10);

    let hash1 = BytesN::from_array(&t.env, &[1u8; 32]);
    let hash2 = BytesN::from_array(&t.env, &[2u8; 32]);
    t.client.setup_board(&1u32, &t.player1, &hash1);
    t.client.setup_board(&1u32, &t.player2, &hash2);

    // P1 rolls
    let _roll = t.client.roll_dice(&1u32);

    // P2 submits outcome: P1 reaches 100!
    let proof = Bytes::from_array(&t.env, &[0u8; 32]);
    let pub_inputs = Bytes::from_array(&t.env, &[0u8; 32]);

    t.client.submit_outcome(
        &1u32,
        &proof,
        &pub_inputs,
        &100u32,     // reached the end!
        &false,
        &hash2,
    );

    let game = t.client.get_game(&1u32);
    assert_eq!(game.status, GameStatus::Finished);
    assert_eq!(game.winner, Some(t.player1.clone()));
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn test_cannot_roll_twice() {
    let t = setup();
    t.client
        .create_game(&1u32, &t.player1, &t.player2, &100, &100, &10);

    let hash1 = BytesN::from_array(&t.env, &[1u8; 32]);
    let hash2 = BytesN::from_array(&t.env, &[2u8; 32]);
    t.client.setup_board(&1u32, &t.player1, &hash1);
    t.client.setup_board(&1u32, &t.player2, &hash2);

    t.client.roll_dice(&1u32); // First roll OK
    t.client.roll_dice(&1u32); // Second roll should fail: RollAlreadyPending = 8
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn test_invalid_snake_count() {
    let t = setup();
    // snake_count = 5 is not valid (must be 6, 8, or 10)
    t.client
        .create_game(&1u32, &t.player1, &t.player2, &100, &100, &5);
}

