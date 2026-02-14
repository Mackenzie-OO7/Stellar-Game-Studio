#![no_std]

//! # ZK Snake & Ladders
//!
//! A two-player "Double-Blind Dealer" race game where each player places
//! hidden traps (snakes) for their opponent. Moves are verified via
//! UltraHonk ZK proofs through a cross-contract call to a deployed verifier.
//!
//! **Game Flow:**
//! 1. `create_game`  → both players auth, GameHub locks points
//! 2. `setup_board` × 2 → each player commits their trap layout hash
//! 3. Loop: `roll_dice` → `submit_outcome` → until someone reaches 100
//! 4. On win: `GameHub.end_game`

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, vec, Address, Bytes,
    BytesN, Env, IntoVal, InvokeError, Symbol, Val, Vec,
};

// GameHub Interface 

#[soroban_sdk::contractclient(name = "GameHubClient")]
pub trait GameHub {
    fn start_game(
        env: Env,
        game_id: Address,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    );
    fn end_game(env: Env, session_id: u32, player1_won: bool);
}

// Errors

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    GameNotFound = 1,
    NotPlayer = 2,
    NotYourTurn = 3,
    GameNotActive = 4,
    GameAlreadyStarted = 5,
    BoardAlreadySet = 6,
    NoPendingRoll = 7,
    RollAlreadyPending = 8,
    InvalidDestination = 9,
    ProofVerificationFailed = 10,
    BoardsNotReady = 11,
    GameAlreadyEnded = 12,
    InvalidSnakeCount = 13,
}

// Data Types

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GameStatus {
    Setup,    // Waiting for both board commits
    Active,   // Game in progress
    Finished, // Winner determined
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GameState {
    pub player1: Address,
    pub player2: Address,
    pub player1_points: i128,
    pub player2_points: i128,
    pub p1_position: u32,
    pub p2_position: u32,
    /// Total snakes on board (6, 8, or 10). Each player places half.
    pub snake_count: u32,
    /// Hash of P1's traps (these affect P2)
    pub p1_board_hash: BytesN<32>,
    /// Hash of P2's traps (these affect P1)
    pub p2_board_hash: BytesN<32>,
    /// true = P1's turn, false = P2's turn
    pub p1_turn: bool,
    /// Dice roll waiting for proof submission
    pub pending_roll: Option<u32>,
    pub status: GameStatus,
    pub winner: Option<Address>,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Game(u32),
    Admin,
    GameHubAddress,
    VerifierAddress,
}

// Storage TTL

const GAME_TTL_LEDGERS: u32 = 518_400; // ~30 days

// Contract

#[contract]
pub struct SnakeLaddersContract;

#[contractimpl]
impl SnakeLaddersContract {
    // Constructor
    /// Deploy with admin, verifier contract address, and GameHub address.
    pub fn __constructor(env: Env, admin: Address, verifier: Address, game_hub: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::VerifierAddress, &verifier);
        env.storage()
            .instance()
            .set(&DataKey::GameHubAddress, &game_hub);
    }

    // Game Lifecycle
    /// Create a new game between two players with staked points.
    ///
    /// # Arguments
    /// * `snake_count` — Total snakes on board: 6, 8, or 10. Each player places half.
    pub fn create_game(
        env: Env,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
        snake_count: u32,
    ) -> Result<(), Error> {
        // Validate snake count: must be 6, 8, or 10
        if snake_count != 6 && snake_count != 8 && snake_count != 10 {
            return Err(Error::InvalidSnakeCount);
        }
        // Auth: both players consent
        player1.require_auth_for_args(vec![
            &env,
            session_id.into_val(&env),
            player1_points.into_val(&env),
        ]);
        player2.require_auth_for_args(vec![
            &env,
            session_id.into_val(&env),
            player2_points.into_val(&env),
        ]);

        // Lock points via GameHub
        let hub_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub not set");
        let hub = GameHubClient::new(&env, &hub_addr);
        hub.start_game(
            &env.current_contract_address(),
            &session_id,
            &player1,
            &player2,
            &player1_points,
            &player2_points,
        );

        // Initialize game state (boards are empty until setup_board)
        let game = GameState {
            player1: player1.clone(),
            player2: player2.clone(),
            player1_points,
            player2_points,
            p1_position: 0,
            p2_position: 0,
            snake_count,
            p1_board_hash: BytesN::from_array(&env, &[0u8; 32]),
            p2_board_hash: BytesN::from_array(&env, &[0u8; 32]),
            p1_turn: true,
            pending_roll: None,
            status: GameStatus::Setup,
            winner: None,
        };

        let key = DataKey::Game(session_id);
        env.storage().temporary().set(&key, &game);
        env.storage()
            .temporary()
            .extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        Ok(())
    }

    /// Each player commits their trap layout hash. Game becomes Active once both
    /// boards are set.
    pub fn setup_board(
        env: Env,
        session_id: u32,
        player: Address,
        board_hash: BytesN<32>,
    ) -> Result<(), Error> {
        player.require_auth();

        let key = DataKey::Game(session_id);
        let mut game: GameState = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if game.status != GameStatus::Setup {
            return Err(Error::GameAlreadyStarted);
        }

        let zero_hash = BytesN::from_array(&env, &[0u8; 32]);

        if player == game.player1 {
            if game.p1_board_hash != zero_hash {
                return Err(Error::BoardAlreadySet);
            }
            game.p1_board_hash = board_hash;
        } else if player == game.player2 {
            if game.p2_board_hash != zero_hash {
                return Err(Error::BoardAlreadySet);
            }
            game.p2_board_hash = board_hash;
        } else {
            return Err(Error::NotPlayer);
        }

        // Both boards set? → go Active
        if game.p1_board_hash != zero_hash && game.p2_board_hash != zero_hash {
            game.status = GameStatus::Active;
        }

        env.storage().temporary().set(&key, &game);
        Ok(())
    }

    // Turn Actions

    /// Roll the dice for the current player. Uses on-chain PRNG.
    /// The opponent (dealer) must then submit a proof via `submit_outcome`.
    pub fn roll_dice(env: Env, session_id: u32) -> Result<u32, Error> {
        let key = DataKey::Game(session_id);
        let mut game: GameState = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if game.status != GameStatus::Active {
            return Err(Error::GameNotActive);
        }
        if game.pending_roll.is_some() {
            return Err(Error::RollAlreadyPending);
        }

        // Current player must auth
        let current_player = if game.p1_turn {
            &game.player1
        } else {
            &game.player2
        };
        current_player.require_auth();

        // Generate roll (1-6) via env.prng()
        let roll: u64 = env.prng().gen_range(1..=6);
        let roll_u32 = roll as u32;

        game.pending_roll = Some(roll_u32);
        env.storage().temporary().set(&key, &game);

        Ok(roll_u32)
    }

    /// The opponent (dealer) submits a ZK proof verifying the move outcome.
    ///
    /// # Arguments
    /// * `session_id` — game ID
    /// * `proof_bytes` — UltraHonk proof
    /// * `public_inputs` — serialized public inputs matching circuit
    /// * `claimed_dest` — where the mover ends up
    /// * `is_snake_hit` — whether a snake was triggered
    /// * `new_board_hash` — updated board hash (changes only on snake hit)
    pub fn submit_outcome(
        env: Env,
        session_id: u32,
        proof_bytes: Bytes,
        public_inputs: Bytes,
        claimed_dest: u32,
        is_snake_hit: bool,
        new_board_hash: BytesN<32>,
    ) -> Result<(), Error> {
        let key = DataKey::Game(session_id);
        let mut game: GameState = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if game.status != GameStatus::Active {
            return Err(Error::GameNotActive);
        }

        let _roll = game.pending_roll.ok_or(Error::NoPendingRoll)?;

        // The "dealer" (opponent) submits the proof
        let dealer = if game.p1_turn {
            // P1 is moving → P2 is the dealer (P2 controls the traps affecting P1)
            &game.player2
        } else {
            &game.player1
        };
        dealer.require_auth();

        // Verify the ZK proof via cross-contract call
        let verifier: Address = env
            .storage()
            .instance()
            .get(&DataKey::VerifierAddress)
            .expect("Verifier not set");

        Self::verify_zk_proof(&env, &verifier, public_inputs, proof_bytes)?;

        // Sanity: destination must be valid (0..=100)
        if claimed_dest > 100 {
            return Err(Error::InvalidDestination);
        }

        // Update position
        if game.p1_turn {
            game.p1_position = claimed_dest;
            // Update P2's board hash (P2's traps affect P1, and may have reshuffled)
            if is_snake_hit {
                game.p2_board_hash = new_board_hash;
            }
        } else {
            game.p2_position = claimed_dest;
            // Update P1's board hash (P1's traps affect P2)
            if is_snake_hit {
                game.p1_board_hash = new_board_hash;
            }
        }

        // Clear pending roll and advance turn
        game.pending_roll = None;
        game.p1_turn = !game.p1_turn;

        // Check win condition
        if game.p1_position >= 100 || game.p2_position >= 100 {
            let winner = if game.p1_position >= 100 {
                game.player1.clone()
            } else {
                game.player2.clone()
            };
            game.winner = Some(winner.clone());
            game.status = GameStatus::Finished;

            // Report to GameHub
            let hub_addr: Address = env
                .storage()
                .instance()
                .get(&DataKey::GameHubAddress)
                .expect("GameHub not set");
            let hub = GameHubClient::new(&env, &hub_addr);
            let p1_won = game.p1_position >= 100;
            hub.end_game(&session_id, &p1_won);
        }

        env.storage().temporary().set(&key, &game);
        Ok(())
    }

    // Query game state.
    pub fn get_game(env: Env, session_id: u32) -> Result<GameState, Error> {
        env.storage()
            .temporary()
            .get(&DataKey::Game(session_id))
            .ok_or(Error::GameNotFound)
    }

    // Admin
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set")
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    // Internal: ZK proof verification

    /// Cross-contract call to the UltraHonk verifier.
    /// Pattern taken from tornado_classic/mixer.rs.
    fn verify_zk_proof(
        env: &Env,
        verifier: &Address,
        public_inputs: Bytes,
        proof_bytes: Bytes,
    ) -> Result<(), Error> {
        let mut args: Vec<Val> = Vec::new(env);
        args.push_back(public_inputs.into_val(env));
        args.push_back(proof_bytes.into_val(env));
        env.try_invoke_contract::<(), InvokeError>(
            verifier,
            &Symbol::new(env, "verify_proof"),
            args,
        )
        .map_err(|_| Error::ProofVerificationFailed)?
        .map_err(|_| Error::ProofVerificationFailed)
    }
}

#[cfg(test)]
mod test;

#[cfg(test)]
mod integration_test;
