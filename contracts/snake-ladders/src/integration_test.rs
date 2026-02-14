#![cfg(test)]

//! Integration test: UltraHonk verifier + VK + proof
//! Proves the full ZK pipeline works end-to-end within the game contract.

use soroban_sdk::{
    contract, contractimpl, testutils::Address as _, Address, Bytes, BytesN, Env,
};

use crate::{GameStatus, SnakeLaddersContract, SnakeLaddersContractClient};

mod ultrahonk_verifier {
    soroban_sdk::contractimport!(
        file = "test_artifacts/rs_soroban_ultrahonk.wasm"
    );
}

// Mock GameHub (game logic, not ZK)

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
    }
    pub fn end_game(_env: Env, _session_id: u32, _player1_won: bool) {}
}

// VK + Proof artifacts from circuit build

const VK_BYTES: &[u8] = include_bytes!("../test_artifacts/vk");
const PROOF_BYTES: &[u8] = include_bytes!("../test_artifacts/proof");
const PUBLIC_INPUTS_BYTES: &[u8] = include_bytes!("../test_artifacts/public_inputs");

// Integration Tests

/// Deploys the  UltraHonk verifier with our circuit's VK, then runs a
/// full game turn through the contract, proving the ZK pipeline works on-chain.
#[test]
fn test_verifier_proof_accepted() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();

    let admin = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);

    // Deploy verifier with our VK
    let vk = Bytes::from_slice(&env, VK_BYTES);
    let verifier_id = env.register(ultrahonk_verifier::WASM, (vk,));

    // Deploy mock GameHub
    let hub_id = env.register(MockGameHub, ());

    // Deploy game contract with verifier
    let contract_id = env.register(
        SnakeLaddersContract,
        (&admin, &verifier_id, &hub_id),
    );
    let client = SnakeLaddersContractClient::new(&env, &contract_id);

    //Game Flow

    // Create game
    client.create_game(&1u32, &player1, &player2, &100, &100, &10);

    // Setup boards
    let hash1 = BytesN::from_array(&env, &[1u8; 32]);
    let hash2 = BytesN::from_array(&env, &[2u8; 32]);
    client.setup_board(&1u32, &player1, &hash1);
    client.setup_board(&1u32, &player2, &hash2);

    // P1 rolls
    let roll = client.roll_dice(&1u32);
    assert!(roll >= 1 && roll <= 6);

    // P2 (dealer) submits outcome with proof and public inputs
    let proof = Bytes::from_slice(&env, PROOF_BYTES);
    let pub_inputs = Bytes::from_slice(&env, PUBLIC_INPUTS_BYTES);

    client.submit_outcome(
        &1u32,
        &proof,
        &pub_inputs,
        &roll,       // claimed destination
        &false,      // no snake hit
        &hash2,      // board unchanged
    );

    // Verify the game state updated correctly
    let game = client.get_game(&1u32);
    assert_eq!(game.p1_position, roll);
    assert_eq!(game.p1_turn, false); // Turn advanced to P2
    assert_eq!(game.status, GameStatus::Active);
}

/// Verify that a tampered proof is rejected by the real verifier.
#[test]
#[should_panic]
fn test_verifier_rejects_bad_proof() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();

    let admin = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);

    // Deploy verifier
    let vk = Bytes::from_slice(&env, VK_BYTES);
    let verifier_id = env.register(ultrahonk_verifier::WASM, (vk,));
    let hub_id = env.register(MockGameHub, ());

    let contract_id = env.register(
        SnakeLaddersContract,
        (&admin, &verifier_id, &hub_id),
    );
    let client = SnakeLaddersContractClient::new(&env, &contract_id);

    client.create_game(&1u32, &player1, &player2, &100, &100, &10);

    let hash1 = BytesN::from_array(&env, &[1u8; 32]);
    let hash2 = BytesN::from_array(&env, &[2u8; 32]);
    client.setup_board(&1u32, &player1, &hash1);
    client.setup_board(&1u32, &player2, &hash2);

    let roll = client.roll_dice(&1u32);

    // TAMPERED proof: flip some bytes
    let mut bad_proof_data = [0u8; 14592]; // Same size as real proof
    bad_proof_data[..PROOF_BYTES.len()].copy_from_slice(PROOF_BYTES);
    bad_proof_data[0] ^= 0xFF; // Corrupt first byte
    bad_proof_data[100] ^= 0xFF; // Corrupt another byte
    let bad_proof = Bytes::from_slice(&env, &bad_proof_data);
    let pub_inputs = Bytes::from_slice(&env, PUBLIC_INPUTS_BYTES);

    // This MUST panic — the verifier should reject the tampered proof
    client.submit_outcome(
        &1u32,
        &bad_proof,
        &pub_inputs,
        &roll,
        &false,
        &hash2,
    );
}
