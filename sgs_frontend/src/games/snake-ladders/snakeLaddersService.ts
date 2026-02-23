/**
 * Service layer for Snake & Ladders contract interactions.
 *
 * Supports two modes:
 *   - **Mock mode** (default): Local in-memory game state for UI testing
 *   - **Contract mode**: Real Soroban contract calls when signer is provided
 *
 * Game flow: create_game → setup_board (×2) → [roll_dice → submit_outcome]* → winner
 */

import { Client as SnakeLaddersClient, type GameState, type GameStatus, contract } from './bindings';
import { xdr } from '@stellar/stellar-sdk';
import * as StellarSdk from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import {
    NETWORK_PASSPHRASE,
    RPC_URL,
    DEFAULT_METHOD_OPTIONS,
    DEFAULT_AUTH_TTL_MINUTES,
    SNAKE_LADDERS_CONTRACT,
} from '@/utils/constants';
import { signAndSendViaLaunchtube } from '@/utils/transactionHelper';
import { calculateValidUntilLedger } from '@/utils/ledgerUtils';
import { injectSignedAuthEntry } from '@/utils/authEntryUtils';

const MULTI_SIG_AUTH_TTL_MINUTES = 60; // 1 Hour for Player 2 to import

// Board helpers

/** Convert a 1-based position (1-100) to {row, col} on a 10×10 board. */
export function posToRowCol(pos: number): { row: number; col: number } {
    if (pos <= 0) return { row: 9, col: 0 };
    const idx = pos - 1;
    const row = 9 - Math.floor(idx / 10);
    const rawCol = idx % 10;
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

/** Generate a board hash from snake positions + salt. */
export function computeBoardHash(positions: number[], salt: number): string {
    let hash = salt;
    for (const p of positions) {
        hash = ((hash << 5) - hash + p) | 0;
    }
    return Math.abs(hash).toString(16).padStart(64, '0');
}

// Snake placement types and validation

export interface SnakeDef {
    head: number;
    tail: number;
    species: string;
}

const SNAKE_SPECIES = ['cobra', 'python', 'boa', 'rattlesnake'] as const;

export const MIN_SNAKE_ROW_SPAN = 2;
export const MAX_SNAKE_ROW_SPAN = 4;

export function computeTailForHead(head: number, preferredSpan?: number): number | null {
    const { row: headRow, col: headCol } = posToRowCol(head);

    const span = preferredSpan ?? 3;
    const tailRow = headRow + span;
    if (tailRow <= 9) {
        const tail = rowColToPos(tailRow, headCol);
        if (tail >= 1 && tail <= 100) return tail;
    }

    for (let s = MIN_SNAKE_ROW_SPAN; s <= MAX_SNAKE_ROW_SPAN; s++) {
        if (s === span) continue;
        const tr = headRow + s;
        if (tr <= 9) {
            const t = rowColToPos(tr, headCol);
            if (t >= 1 && t <= 100) return t;
        }
    }

    return null;
}

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

export function randomSpecies(): string {
    return SNAKE_SPECIES[Math.floor(Math.random() * SNAKE_SPECIES.length)];
}

// Ladder definitions (fixed on every board)

export interface LadderDef {
    bottom: number;
    top: number;
}

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

// Local mock state for mock mode
const mockGames = new Map<number, GameState>();

type Signer = Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>;

/**
 * Dual-mode service: runs locally in mock mode, or on-chain when signer is provided.
 */
export class SnakeLaddersService {
    private contractId: string;
    private useContract: boolean;
    private baseClient: SnakeLaddersClient | null = null;

    constructor(contractId?: string) {
        this.contractId = contractId || SNAKE_LADDERS_CONTRACT;
        this.useContract = !!this.contractId;
        if (this.useContract) {
            try {
                this.baseClient = new SnakeLaddersClient({
                    contractId: this.contractId,
                    networkPassphrase: NETWORK_PASSPHRASE,
                    rpcUrl: RPC_URL,
                });
            } catch {
                console.warn('[SnakeLaddersService] Failed to init contract client, falling back to mock mode');
                this.useContract = false;
            }
        }
    }

    private createSigningClient(
        publicKey: string,
        signer: Signer
    ): SnakeLaddersClient {
        return new SnakeLaddersClient({
            contractId: this.contractId,
            networkPassphrase: NETWORK_PASSPHRASE,
            rpcUrl: RPC_URL,
            publicKey,
            ...signer,
        });
    }

    /**
     * Create a new game session.
     * In mock mode, no signer is needed and the game is created locally.
     */
    async createGame(
        sessionId: number,
        player1: string,
        player2: string,
        player1Points: bigint,
        player2Points: bigint,
        snakeCount: number,
        signer?: Signer,
        authTtlMinutes?: number
    ): Promise<void> {
        if (snakeCount !== 6 && snakeCount !== 8 && snakeCount !== 10) {
            throw new Error('Snake count must be 6, 8, or 10');
        }

        if (this.useContract && signer) {
            // 1. Create the transaction XDR using the client (which builds the invokeHost call)
            // We use a temporary client just to build the tx, but we handle signing manually
            // to support multi-sig (Player 1 + Player 2)
            const client = this.createSigningClient(player1, signer);

            // We need to construct the transaction manually or intercept it.
            // The generated bindings 'create_game' method typically signs and sends if a signer is present.
            // To support dual auth, we need to:
            // a) Build the transaction
            // b) Sign with Player 1 (user)
            // c) Sign with Player 2 (if dev/bot)
            // d) Submit

            // Since the bindings don't easily export "build only", we'll rely on the fact that
            // our 'signer' wrapper (from useWallet) might return the signed XDR without sending
            // if we used 'signTransaction'.
            // However, the current `signAndSendViaLaunchtube` helper sends it.

            // Let's use the raw `create_game` builder from the contract client if possible, 
            // OR we assume `signer.signTransaction` returns the signed tx string.

            const tx = await client.create_game({
                session_id: sessionId,
                player1,
                player2,
                player1_points: player1Points,
                player2_points: player2Points,
                snake_count: snakeCount,
            }, {
                ...DEFAULT_METHOD_OPTIONS,
                simulateTransaction: {
                    defaultAuthMode: 'record_allow_nonroot'
                }
            } as any);

            if (!tx.built) {
                console.error("No built transaction found in AssembledTransaction:", tx);
                throw new Error('Failed to assemble transaction (tx.built is undefined)');
            }

            // Real wallets like Freighter reject transactions with sequence number 0 or no fee.
            // When skipSimulation is true, the SDK might not populate these.
            // Let's manually populate them using the Stellar SDK if needed.
            const sourceAccount = tx.built.source;
            // The generated bindings usually use `TransactionBuilder` under the hood.
            // If the tx is already fully formed by the builder, toXDR() works.
            // However, to satisfy Freighter, we must ensure it has a fee and sequence number.

            // Reconstruct the transaction to ensure it has fee and sequence
            let xdrBuffer;
            try {
                xdrBuffer = tx.built?.toXDR();
            } catch (e) {
                console.warn("Extraction failed, attempting reconstruction", e);
                throw new Error("Transaction assembly failed: " + (e as Error).message);
            }

            if (!xdrBuffer) {
                throw new Error("Could not extract XDR from simulation");
            }

            // 2. Extract and patch Auth Entries for Player 2 (if dev wallet)
            const devService = (await import('../../services/devWalletService')).devWalletService;
            const p2Key = await devService.getPublicKeyFor(2);
            const validUntilLedgerSeq = await calculateValidUntilLedger(
                RPC_URL, authTtlMinutes ?? DEFAULT_AUTH_TTL_MINUTES
            );

            let patchedTx = tx;
            if (player2 === p2Key && player1 !== player2) {
                const authEntries = patchedTx.simulationData?.result?.auth;
                if (authEntries) {
                    const devSigner = await devService.getSignerFor(2);
                    for (let i = 0; i < authEntries.length; i++) {
                        const entry = authEntries[i];
                        try {
                            if (entry.credentials().switch().name === 'sorobanCredentialsAddress') {
                                const entryAddressStr = StellarSdk.Address.fromScAddress(entry.credentials().address().address()).toString();
                                if (entryAddressStr === player2) {
                                    const signedEntry = await StellarSdk.authorizeEntry(
                                        entry,
                                        async (preimage) => {
                                            const signResult = await devSigner.signAuthEntry!(preimage.toXDR('base64'), {
                                                networkPassphrase: NETWORK_PASSPHRASE,
                                                address: player2
                                            });
                                            const signedStr = typeof signResult === 'string' ? signResult : signResult.signedAuthEntry!;
                                            return Buffer.from(signedStr, 'base64');
                                        },
                                        validUntilLedgerSeq,
                                        NETWORK_PASSPHRASE
                                    );
                                    authEntries[i] = signedEntry;
                                }
                            }
                        } catch (e) { /* ignore */ }
                    }
                    patchedTx.simulationData!.result.auth = authEntries;
                }
            }

            // 3. Rebuild the transaction XDR with the patched auth entries
            let builtTx;
            try {
                // @ts-ignore - assembleTransaction is available in newer SDKs
                if (typeof StellarSdk.assembleTransaction === 'function') {
                    // @ts-ignore
                    builtTx = StellarSdk.assembleTransaction(tx.built!, patchedTx.simulationData!).build();
                } else {
                    builtTx = tx.built!;
                }
            } catch (e) {
                console.warn("Could not re-assemble transaction natively, falling back to original built tx:", e);
                builtTx = tx.built!;
            }
            const rawXdrObj = builtTx.toXDR();
            const rawXdr = typeof rawXdrObj === 'string' ? rawXdrObj : Buffer.from(rawXdrObj).toString('base64');

            // 4. Sign the overall transaction envelope with Player 1's wallet
            if (!signer.signTransaction) throw new Error("Signer does not support signTransaction");
            const signResult = await signer.signTransaction(rawXdr, { networkPassphrase: NETWORK_PASSPHRASE });
            let envelopeXdr = typeof signResult === 'string' ? signResult : signResult.signedTxXdr!;

            // Optional: If P2 needs to pay fees/sequence (unlikely since P1 is source), sign envelope
            const p1Key = await devService.getPublicKeyFor(1);
            if (player2 === p2Key && player1 !== player2) {
                envelopeXdr = await devService.signTransactionFor(envelopeXdr, 2, NETWORK_PASSPHRASE);
            }

            // 5. Submit the explicitly signed string XDR
            const sentTx = await signAndSendViaLaunchtube(
                envelopeXdr, // Passing STRING bypasses the AssembledTransaction resimulation!
                DEFAULT_METHOD_OPTIONS.timeoutInSeconds,
                validUntilLedgerSeq
            );

            if (sentTx.getTransactionResponse?.status === 'FAILED') {
                throw new Error('create_game transaction failed');
            }
            return;
        }

        // Mock mode
        const game: GameState = {
            player1,
            player2,
            player1_points: player1Points as any,
            player2_points: player2Points as any,
            p1_position: 1,
            p2_position: 1,
            snake_count: snakeCount,
            p1_board_hash: '' as any,
            p2_board_hash: '' as any,
            p1_turn: true,
            pending_roll: undefined,
            status: 'Setup' as any,
            winner: undefined,
        };
        mockGames.set(sessionId, game);
    }

    /**
     * STEP 1 (Player 1): Prepare a start game transaction and export signed auth entry
     * - Creates transaction with Player 2 as the transaction source
     * - Simulates to get auth entries
     * - Player 1 signs their auth entry
     * - Returns ONLY Player 1's signed auth entry XDR (not full transaction)
     *
     * Uses extended TTL (60 minutes) for multi-sig flow to allow time for both players to sign
     */
    async prepareStartGame(
        sessionId: number,
        player1: string,
        player2: string,
        player1Points: bigint,
        player2Points: bigint,
        snakeCount: number,
        player1Signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
        authTtlMinutes?: number
    ): Promise<string> {
        // Step 1: Build transaction with Player 2 as the transaction source
        const buildClient = new SnakeLaddersClient({
            contractId: this.contractId,
            networkPassphrase: NETWORK_PASSPHRASE,
            rpcUrl: RPC_URL,
            publicKey: player2, // Player 2 is the transaction source
        });

        const tx = await buildClient.create_game({
            session_id: sessionId,
            player1,
            player2,
            player1_points: player1Points,
            player2_points: player2Points,
            snake_count: snakeCount
        }, DEFAULT_METHOD_OPTIONS);

        console.log('[prepareStartGame] Transaction built and simulated, extracting auth entries');

        // Step 2: Extract Player 1's STUBBED auth entry from simulation
        if (!tx.simulationData?.result?.auth) {
            throw new Error('No auth entries found in simulation');
        }

        const authEntries = tx.simulationData.result.auth;
        let player1AuthEntry = null;

        for (let i = 0; i < authEntries.length; i++) {
            const entry = authEntries[i];
            try {
                const entryAddress = entry.credentials().address().address();
                const entryAddressString = StellarSdk.Address.fromScAddress(entryAddress).toString();

                if (entryAddressString === player1) {
                    player1AuthEntry = entry;
                    break;
                }
            } catch (err) {
                continue;
            }
        }

        if (!player1AuthEntry) {
            throw new Error(`No auth entry found for Player 1 (${player1}).`);
        }

        // Step 3: Calculate extended TTL
        const validUntilLedgerSeq = authTtlMinutes
            ? await calculateValidUntilLedger(RPC_URL, authTtlMinutes)
            : await calculateValidUntilLedger(RPC_URL, MULTI_SIG_AUTH_TTL_MINUTES);

        // Step 4: Sign the auth entry using authorizeEntry helper
        if (!player1Signer.signAuthEntry) {
            throw new Error('signAuthEntry function not available');
        }

        const signedAuthEntry = await StellarSdk.authorizeEntry(
            player1AuthEntry,
            async (preimage: StellarSdk.xdr.HashIdPreimage) => {
                if (!player1Signer.signAuthEntry) throw new Error('Wallet does not support auth entry signing');

                const signResult = await player1Signer.signAuthEntry(
                    preimage.toXDR('base64'),
                    { networkPassphrase: NETWORK_PASSPHRASE, address: player1 }
                );

                if (signResult.error) {
                    throw new Error(`Failed to sign auth entry: ${signResult.error.message}`);
                }

                return Buffer.from(signResult.signedAuthEntry, 'base64');
            },
            validUntilLedgerSeq,
            NETWORK_PASSPHRASE,
        );

        return signedAuthEntry.toXDR('base64');
    }

    /**
     * Parse a signed auth entry to extract game parameters
     */
    parseAuthEntry(authEntryXdr: string): {
        sessionId: number;
        player1: string;
        player1Points: bigint;
        functionName: string;
    } {
        try {
            const authEntry = StellarSdk.xdr.SorobanAuthorizationEntry.fromXDR(authEntryXdr, 'base64');
            const credentials = authEntry.credentials();

            const player1Address = credentials.address().address();
            const player1 = StellarSdk.Address.fromScAddress(player1Address).toString();

            const rootInvocation = authEntry.rootInvocation();
            const contractFn = rootInvocation.function().contractFn();
            const functionName = contractFn.functionName().toString();

            if (functionName !== 'create_game') {
                throw new Error(`Unexpected function: ${functionName}. Expected create_game.`);
            }

            const args = contractFn.args();
            if (args.length !== 2) {
                throw new Error(`Expected 2 arguments for create_game auth entry, got ${args.length}`);
            }

            const sessionId = args[0].u32();
            const player1Points = args[1].i128().lo().toBigInt();

            return {
                sessionId,
                player1,
                player1Points,
                functionName,
            };
        } catch (err: any) {
            throw new Error(`Failed to parse auth entry: ${err.message}`);
        }
    }

    /**
     * STEP 2 (Player 2): Import Player 1's signed auth entry and rebuild transaction
     */
    async importAndSignAuthEntry(
        player1SignedAuthEntryXdr: string,
        player2Address: string,
        player2Points: bigint,
        snakeCount: number,
        player2Signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
        authTtlMinutes?: number
    ): Promise<string> {
        const gameParams = this.parseAuthEntry(player1SignedAuthEntryXdr);

        if (player2Address === gameParams.player1) {
            throw new Error('Cannot play against yourself. Player 2 must be different from Player 1.');
        }

        // Step 1: Build a new transaction with Player 2 as the source
        const buildClient = new SnakeLaddersClient({
            contractId: this.contractId,
            networkPassphrase: NETWORK_PASSPHRASE,
            rpcUrl: RPC_URL,
            publicKey: player2Address,
        });

        const tx = await buildClient.create_game({
            session_id: gameParams.sessionId,
            player1: gameParams.player1,
            player2: player2Address,
            player1_points: gameParams.player1Points,
            player2_points: player2Points,
            snake_count: snakeCount
        }, DEFAULT_METHOD_OPTIONS);

        // Step 2: Inject Player 1's signed auth entry
        const validUntilLedgerSeq = authTtlMinutes
            ? await calculateValidUntilLedger(RPC_URL, authTtlMinutes)
            : await calculateValidUntilLedger(RPC_URL, MULTI_SIG_AUTH_TTL_MINUTES);

        const txWithInjectedAuth = await injectSignedAuthEntry(
            tx,
            player1SignedAuthEntryXdr,
            player2Address,
            player2Signer,
            validUntilLedgerSeq
        );

        // Step 4: Create a signing client and import the transaction
        const player2Client = this.createSigningClient(player2Address, player2Signer);
        const player2Tx = player2Client.txFromXDR(txWithInjectedAuth.toXDR());

        // Step 5: Check if Player 2 needs to sign an auth entry
        const needsSigning = await player2Tx.needsNonInvokerSigningBy();
        if (needsSigning.includes(player2Address)) {
            await player2Tx.signAuthEntries({ expiration: validUntilLedgerSeq });
        }

        return player2Tx.toXDR();
    }

    /**
     * STEP 3 (Player 1 or Player 2): Finalize and submit the transaction
     */
    async finalizeStartGame(
        xdr: string,
        signerAddress: string,
        signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
        authTtlMinutes?: number
    ) {
        const client = this.createSigningClient(signerAddress, signer);

        // Import the transaction with all auth entries signed
        const tx = client.txFromXDR(xdr);

        // CRITICAL: Must simulate again after auth entries are signed
        await tx.simulate();

        const validUntilLedgerSeq = authTtlMinutes
            ? await calculateValidUntilLedger(RPC_URL, authTtlMinutes)
            : await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);

        // Sign the transaction envelope and submit
        const sentTx = await signAndSendViaLaunchtube(
            tx,
            DEFAULT_METHOD_OPTIONS.timeoutInSeconds,
            validUntilLedgerSeq
        );
        return sentTx.result;
    }

    /**
     * Commit a board hash for a player.
     */
    async setupBoard(
        sessionId: number,
        player: string,
        boardHash: string,
        signer?: Signer,
        authTtlMinutes?: number
    ): Promise<void> {
        if (this.useContract && signer) {
            const hashBytes = Buffer.from(boardHash.padStart(64, '0'), 'hex');
            const client = this.createSigningClient(player, signer);
            const tx = await client.setup_board({
                session_id: sessionId,
                player,
                board_hash: hashBytes,
            }, DEFAULT_METHOD_OPTIONS);

            const validUntilLedgerSeq = await calculateValidUntilLedger(
                RPC_URL, authTtlMinutes ?? DEFAULT_AUTH_TTL_MINUTES
            );
            const sentTx = await signAndSendViaLaunchtube(
                tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds, validUntilLedgerSeq
            );
            if (sentTx.getTransactionResponse?.status === 'FAILED') {
                throw new Error('setup_board transaction failed');
            }
            return;
        }

        // Mock mode
        const game = mockGames.get(sessionId);
        if (!game) throw new Error('Game not found');
        if ((game.status as any) !== 'Setup') throw new Error('Game not in setup phase');

        if (player === game.player1) {
            game.p1_board_hash = boardHash as any;
        } else if (player === game.player2) {
            game.p2_board_hash = boardHash as any;
        } else {
            throw new Error('Not a player in this game');
        }

        if (game.p1_board_hash && game.p2_board_hash) {
            game.status = 'Active' as any;
        }
    }

    /**
     * Roll dice for the current player.
     * Returns a pair [die1, die2] in mock mode.
     * In contract mode, the contract returns a single total; we split it for UI.
     */
    async rollDice(
        sessionId: number,
        playerAddress?: string,
        signer?: Signer,
        authTtlMinutes?: number
    ): Promise<[number, number]> {
        if (this.useContract && signer && playerAddress) {
            const client = this.createSigningClient(playerAddress, signer);
            const tx = await client.roll_dice({
                session_id: sessionId,
            }, DEFAULT_METHOD_OPTIONS);

            const validUntilLedgerSeq = await calculateValidUntilLedger(
                RPC_URL, authTtlMinutes ?? DEFAULT_AUTH_TTL_MINUTES
            );
            const sentTx = await signAndSendViaLaunchtube(
                tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds, validUntilLedgerSeq
            );
            if (sentTx.getTransactionResponse?.status === 'FAILED') {
                throw new Error('roll_dice transaction failed');
            }

            // Contract returns a single total. Split into two dice for UI display.
            const total = Number(sentTx.result);
            const die1 = Math.min(6, Math.max(1, Math.ceil(total / 2)));
            const die2 = total - die1;
            return [die1, die2];
        }

        // Mock mode
        const game = mockGames.get(sessionId);
        if (!game) throw new Error('Game not found');
        if ((game.status as any) !== 'Active') throw new Error('Game not active');
        if (game.pending_roll !== undefined && game.pending_roll !== null) {
            throw new Error('Roll already pending');
        }

        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        game.pending_roll = die1 + die2;
        return [die1, die2];
    }

    /**
     * Submit move outcome.
     * In contract mode, includes ZK proof data.
     */
    async submitOutcome(
        sessionId: number,
        claimedDest: number,
        isSnakeHit: boolean,
        newBoardHash: string,
        proofBytes?: Uint8Array,
        publicInputs?: Uint8Array,
        signerAddress?: string,
        signer?: Signer,
        authTtlMinutes?: number
    ): Promise<void> {
        if (this.useContract && signer && signerAddress && proofBytes && publicInputs) {
            const hashBytes = Buffer.from(newBoardHash.padStart(64, '0'), 'hex');
            const client = this.createSigningClient(signerAddress, signer);
            const tx = await client.submit_outcome({
                session_id: sessionId,
                proof_bytes: Buffer.from(proofBytes),
                public_inputs: Buffer.from(publicInputs),
                claimed_dest: claimedDest,
                is_snake_hit: isSnakeHit,
                new_board_hash: hashBytes,
            }, DEFAULT_METHOD_OPTIONS);

            const validUntilLedgerSeq = await calculateValidUntilLedger(
                RPC_URL, authTtlMinutes ?? DEFAULT_AUTH_TTL_MINUTES
            );
            const sentTx = await signAndSendViaLaunchtube(
                tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds, validUntilLedgerSeq
            );
            if (sentTx.getTransactionResponse?.status === 'FAILED') {
                throw new Error('submit_outcome transaction failed');
            }
            return;
        }

        // Mock mode
        const game = mockGames.get(sessionId);
        if (!game) throw new Error('Game not found');
        if (game.pending_roll === undefined || game.pending_roll === null) {
            throw new Error('No roll pending');
        }

        if (game.p1_turn) {
            game.p1_position = claimedDest;
        } else {
            game.p2_position = claimedDest;
        }

        if (claimedDest >= 100) {
            game.status = 'Finished' as any;
            game.winner = game.p1_turn ? game.player1 : game.player2;
        }

        game.p1_turn = !game.p1_turn;
        game.pending_roll = undefined;
    }

    /**
     * Get game state.
     * Tries contract first (if available), falls back to mock.
     */
    async getGame(sessionId: number): Promise<GameState | null> {
        if (this.useContract && this.baseClient) {
            try {
                const tx = await this.baseClient.get_game({ session_id: sessionId });
                const result = await tx.simulate();
                if (result.result.isOk()) {
                    return result.result.unwrap();
                }
                console.log('[getGame] Game not found on-chain for session:', sessionId);
            } catch (err) {
                console.log('[getGame] Contract call failed, trying mock:', err);
            }
        }

        // Mock fallback — return a shallow clone so React detects state changes
        // (mock methods mutate the original object in-place)
        const game = mockGames.get(sessionId);
        return game ? { ...game } : null;
    }
}
