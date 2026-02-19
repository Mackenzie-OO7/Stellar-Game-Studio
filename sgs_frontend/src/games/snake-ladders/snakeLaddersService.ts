/**
 * Service layer for Snake & Ladders contract interactions.
 *
 * For the MVP, ZK proof generation is simulated.  The game flow is:
 *   create_game → setup_board (×2) → [roll_dice → submit_outcome]* → winner
 *
 * Because the contract is not yet deployed, all contract calls are stubbed with
 * a local mock that mirrors the on-chain state machine.  This lets us build and
 * test the full UI without a live deployment.
 */

import type { GameState, GameStatus } from './bindings';

// Board helpers

/** Convert a 1-based position (1-100) to {row, col} on a 10×10 board. */
export function posToRowCol(pos: number): { row: number; col: number } {
    if (pos <= 0) return { row: 9, col: 0 }; // start position (off-board)
    const idx = pos - 1;
    const row = 9 - Math.floor(idx / 10);
    const rawCol = idx % 10;
    // Rows zigzag: even rows (from bottom) go left→right, odd go right→left
    const fromBottom = Math.floor(idx / 10);
    const col = fromBottom % 2 === 0 ? rawCol : 9 - rawCol;
    return { row, col };
}

/** Return the tile number for a given grid cell (row 0 = top, col 0 = left). */
export function rowColToPos(row: number, col: number): number {
    const fromBottom = 9 - row;
    const actualCol = fromBottom % 2 === 0 ? col : 9 - col;
    return fromBottom * 10 + actualCol + 1;
}

/** Generate a simple deterministic hash from snake positions + salt. */
export function computeBoardHash(positions: number[], salt: number): string {
    // Simplified hash for MVP — real implementation uses Pedersen hash
    let hash = salt;
    for (const p of positions) {
        hash = ((hash << 5) - hash + p) | 0;
    }
    return Math.abs(hash).toString(16).padStart(64, '0');
}

// Snake placement validation

export interface SnakeDef {
    head: number;   // tile number of the snake head (higher)
    tail: number;   // tile number of the snake tail (lower)
    species: string; // 'cobra' | 'python' | 'boa' | 'rattlesnake'
}

const SNAKE_SPECIES = ['cobra', 'python', 'boa', 'rattlesnake'] as const;

/**
 * Snake row span range — tails land 2 to 4 rows below the head.
 * This allows placing snakes across the entire board including the
 * 10–40 tile region (rows 7–9 from top).
 */
export const MIN_SNAKE_ROW_SPAN = 2;
export const MAX_SNAKE_ROW_SPAN = 4;

/**
 * Given a head tile, compute the valid tail tile.
 * The tail lands a random number of rows (2–4) below the head.
 * If none of those spans produce a valid tail, returns null.
 *
 * For deterministic placement (e.g. hover preview), a fixed span of 3 is used.
 */
export function computeTailForHead(head: number, preferredSpan?: number): number | null {
    const { row: headRow, col: headCol } = posToRowCol(head);

    // Try the preferred span first, then fall back to alternatives
    const span = preferredSpan ?? 3;
    const tailRow = headRow + span;
    if (tailRow <= 9) {
        const tail = rowColToPos(tailRow, headCol);
        if (tail >= 1 && tail <= 100) return tail;
    }

    // If preferred span didn't work, try other valid spans
    for (let s = MIN_SNAKE_ROW_SPAN; s <= MAX_SNAKE_ROW_SPAN; s++) {
        if (s === span) continue; // already tried
        const tr = headRow + s;
        if (tr <= 9) {
            const t = rowColToPos(tr, headCol);
            if (t >= 1 && t <= 100) return t;
        }
    }

    return null;
}

/**
 * Validate a set of snake placements.
 * Returns an error message or null if valid.
 */
export function validateSnakePlacements(
    snakes: SnakeDef[],
    expectedCount: number
): string | null {
    if (snakes.length !== expectedCount) {
        return `Place exactly ${expectedCount} snakes`;
    }

    const usedHeads = new Set<number>();
    const usedTails = new Set<number>();

    for (const s of snakes) {
        if (s.head <= s.tail) return `Snake head (${s.head}) must be higher than tail (${s.tail})`;
        if (usedHeads.has(s.head)) return `Duplicate snake head at tile ${s.head}`;
        if (usedTails.has(s.tail)) return `Duplicate snake tail at tile ${s.tail}`;
        if (s.head === 100) return 'Cannot place a snake head on tile 100 (finish)';
        if (s.tail === 1) return 'Cannot place a snake tail on tile 1 (start)';
        usedHeads.add(s.head);
        usedTails.add(s.tail);
    }

    return null;
}

/** Pick a random species for a snake. */
export function randomSpecies(): string {
    return SNAKE_SPECIES[Math.floor(Math.random() * SNAKE_SPECIES.length)];
}

// Ladder definitions (fixed on every board)

export interface LadderDef {
    bottom: number;
    top: number;
}

/** Fixed ladder positions — same for every game. */
export const LADDERS: LadderDef[] = [
    { bottom: 4, top: 25 },
    { bottom: 13, top: 46 },
    { bottom: 27, top: 53 },
    { bottom: 42, top: 63 },
    { bottom: 50, top: 69 },
    { bottom: 56, top: 84 },
    { bottom: 66, top: 92 },
    { bottom: 74, top: 96 },
];

// Mock game engine (until contract is deployed)

const games = new Map<number, GameState>();

export class SnakeLaddersService {
    /**
     * Create a new game session.
     */
    async createGame(
        sessionId: number,
        player1: string,
        player2: string,
        player1Points: bigint,
        player2Points: bigint,
        snakeCount: number,
    ): Promise<void> {
        if (snakeCount !== 6 && snakeCount !== 8 && snakeCount !== 10) {
            throw new Error('Snake count must be 6, 8, or 10');
        }
        const game: GameState = {
            player1,
            player2,
            player1_points: player1Points as any,
            player2_points: player2Points as any,
            p1_position: 1,
            p2_position: 1,
            snake_count: snakeCount,
            p1_board_hash: '',
            p2_board_hash: '',
            p1_turn: true,
            pending_roll: undefined,
            status: 'Setup' as GameStatus,
            winner: undefined,
        };
        games.set(sessionId, game);
    }

    /**
     * Commit a board hash for a player.
     */
    async setupBoard(
        sessionId: number,
        player: string,
        boardHash: string,
    ): Promise<void> {
        const game = games.get(sessionId);
        if (!game) throw new Error('Game not found');
        if (game.status !== 'Setup') throw new Error('Game not in setup phase');

        if (player === game.player1) {
            game.p1_board_hash = boardHash;
        } else if (player === game.player2) {
            game.p2_board_hash = boardHash;
        } else {
            throw new Error('Not a player in this game');
        }

        // If both boards are set, activate
        if (game.p1_board_hash && game.p2_board_hash) {
            game.status = 'Active';
        }
    }

    /**
     * Roll two dice for the current player.
     * Returns a pair [die1, die2].
     */
    async rollDice(sessionId: number): Promise<[number, number]> {
        const game = games.get(sessionId);
        if (!game) throw new Error('Game not found');
        if (game.status !== 'Active') throw new Error('Game not active');
        if (game.pending_roll !== undefined && game.pending_roll !== null) {
            throw new Error('Roll already pending');
        }

        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        game.pending_roll = die1 + die2;
        return [die1, die2];
    }

    /**
     * Submit move outcome (simulated ZK proof verification).
     */
    async submitOutcome(
        sessionId: number,
        claimedDest: number,
        isSnakeHit: boolean,
        _newBoardHash: string,
    ): Promise<void> {
        const game = games.get(sessionId);
        if (!game) throw new Error('Game not found');
        if (game.pending_roll === undefined || game.pending_roll === null) {
            throw new Error('No roll pending');
        }

        // Move the current player
        if (game.p1_turn) {
            game.p1_position = claimedDest;
        } else {
            game.p2_position = claimedDest;
        }

        // Check win
        if (claimedDest >= 100) {
            game.status = 'Finished';
            game.winner = game.p1_turn ? game.player1 : game.player2;
        }

        // Advance turn
        game.p1_turn = !game.p1_turn;
        game.pending_roll = undefined;
    }

    /**
     * Get game state.
     */
    async getGame(sessionId: number): Promise<GameState | null> {
        return games.get(sessionId) ?? null;
    }
}
