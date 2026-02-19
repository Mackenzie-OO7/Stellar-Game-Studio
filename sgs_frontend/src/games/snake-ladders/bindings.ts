/**
 * Snake & Ladders contract bindings (contract not yet deployed).
 * Mirrors types from contracts/snake-ladders/src/lib.rs
 */

import type { u32, i128, Option } from '@stellar/stellar-sdk/contract';

// Re-export SDK so consumers can do `import { contract } from './bindings'`
export * from '@stellar/stellar-sdk';
export * as contract from '@stellar/stellar-sdk/contract';
export * as rpc from '@stellar/stellar-sdk/rpc';

// Contract types
export type GameStatus = 'Setup' | 'Active' | 'Finished';

export interface GameState {
    player1: string;
    player2: string;
    player1_points: i128;
    player2_points: i128;
    p1_position: u32;
    p2_position: u32;
    /** Total snakes on board (6, 8, or 10). Each player places half. */
    snake_count: u32;
    /** Hash of P1's traps (these affect P2) */
    p1_board_hash: string; // hex representation of BytesN<32>
    /** Hash of P2's traps (these affect P1) */
    p2_board_hash: string;
    /** true = P1's turn, false = P2's turn */
    p1_turn: boolean;
    /** Dice roll waiting for proof submission */
    pending_roll: Option<u32>;
    status: GameStatus;
    winner: Option<string>;
}

export const Errors = {
    1: { message: 'GameNotFound' },
    2: { message: 'NotPlayer' },
    3: { message: 'NotYourTurn' },
    4: { message: 'GameNotActive' },
    5: { message: 'GameAlreadyStarted' },
    6: { message: 'BoardAlreadySet' },
    7: { message: 'BoardNotSet' },
    8: { message: 'RollAlreadyPending' },
    9: { message: 'NoRollPending' },
    10: { message: 'ProofVerificationFailed' },
    11: { message: 'InvalidDestination' },
    12: { message: 'GameNotFinished' },
    13: { message: 'InvalidSnakeCount' },
} as const;
