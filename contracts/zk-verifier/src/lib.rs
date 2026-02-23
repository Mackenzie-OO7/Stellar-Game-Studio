//! ZK Verifier Contract — wraps the UltraHonk verifier library.
//!
//! Stores the verification key (VK) in contract storage.
//! Exposes `verify_proof(public_inputs, proof)` for cross-contract calls
//! from the Snake & Ladders game contract.

#![no_std]
extern crate alloc;


pub mod debug;
pub mod ec;
pub mod field;
pub mod hash;
pub mod relations;
pub mod shplemini;
pub mod sumcheck;
pub mod transcript;
pub mod types;
pub mod utils;
pub mod verifier;

pub const PROOF_FIELDS: usize = 456;
pub const PROOF_BYTES: usize = PROOF_FIELDS * 32;

pub use verifier::UltraHonkVerifier;

use soroban_sdk::{contract, contractimpl, contracttype, Bytes, BytesN, Env};

#[contracttype]
pub enum DataKey {
    Vk,
    Admin,
}

#[contract]
pub struct ZkVerifierContract;

#[contractimpl]
impl ZkVerifierContract {
    /// Deploy with admin address and the serialised verification key.
    pub fn __constructor(env: Env, admin: soroban_sdk::Address, vk_bytes: Bytes) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Vk, &vk_bytes);
    }

    /// Verify a ZK proof against stored VK.
    /// Called cross-contract by the Snake & Ladders game.
    pub fn verify_proof(env: Env, public_inputs: Bytes, proof: Bytes) {
        let vk_bytes: Bytes = env
            .storage()
            .instance()
            .get(&DataKey::Vk)
            .expect("VK not set");

        let verifier = UltraHonkVerifier::new(&env, &vk_bytes)
            .expect("Failed to parse VK");

        verifier
            .verify(&proof, &public_inputs)
            .expect("Proof verification failed");
    }

    /// Update the verification key (admin only).
    pub fn set_vk(env: Env, new_vk: Bytes) {
        let admin: soroban_sdk::Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.storage().instance().set(&DataKey::Vk, &new_vk);
    }

    /// Upgrade contract WASM (admin only).
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: soroban_sdk::Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}
