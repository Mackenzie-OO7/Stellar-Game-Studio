/**
 * SnakeLaddersGame.tsx — Main game component with 4 phases:
 *
 *   1. Create / Join — mode toggle, game mode selection (vs Computer / vs Player),
 *      quickstart, avatar & snake count selection
 *   2. Setup — place snakes on the board (both players in local mode)
 *   3. Active — roll dice (two dice), move tokens, ZK proof flow
 *   4. Complete — confetti, winner banner, stats
 *
 * Two game modes:
 *   - vs Computer: opponent auto-plays on a timer
 *   - vs Player (Local): both players manually control via player switching
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Board } from './components/Board';
import { Dice3D } from './components/Dice3D';
import { SnakePlacement } from './components/SnakePlacement';
import { Confetti } from './components/Confetti';
import {
    SnakeLaddersService,
    computeBoardHash,
    computeTailForHead,
    LADDERS,
    type SnakeDef,
} from './snakeLaddersService';
import { useWallet } from '@/hooks/useWallet';
import { devWalletService, DevWalletService } from '@/services/devWalletService';
import type { GameState } from './bindings';
import './SnakeLaddersGame.css';

// Service singleton
const service = new SnakeLaddersService();

const createRandomSessionId = (): number => {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        let value = 0;
        const buffer = new Uint32Array(1);
        while (value === 0) {
            crypto.getRandomValues(buffer);
            value = buffer[0];
        }
        return value;
    }
    return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
};

// Props
interface SnakeLaddersGameProps {
    userAddress: string;
    currentEpoch: number;
    availablePoints: bigint;
    onBack: () => void;
    onStandingsRefresh: () => void;
    onGameComplete: () => void;
}

// Types
type GamePhase = 'create' | 'setup' | 'active' | 'complete';
type CreateMode = 'create' | 'import' | 'load';
type GameMode = 'computer' | 'local';
type Avatar = 'mongoose' | 'mouse';

/** Which player is currently placing snakes or rolling dice in local mode */
type ActivePlayer = 1 | 2;

interface GameStats {
    totalMoves: number;
    snakesHit: number;
    laddersClimbed: number;
}

const DEFAULT_POINTS = '0.1';
const POINTS_DECIMALS = 7;
const COMPUTER_TURN_DELAY = 1500; // ms before computer auto-rolls


// Component

export function SnakeLaddersGame({
    userAddress,
    availablePoints,
    onBack,
    onStandingsRefresh,
    onGameComplete,
}: SnakeLaddersGameProps) {
    const { walletType } = useWallet();

    // --- Create Phase ---
    const [sessionId, setSessionId] = useState(() => createRandomSessionId());
    const [player1Address, setPlayer1Address] = useState(userAddress);
    const [player1Points, setPlayer1Points] = useState(DEFAULT_POINTS);
    const [createMode, setCreateMode] = useState<CreateMode>('create');
    const [gameMode, setGameMode] = useState<GameMode>('computer');
    const [snakeCountOption, setSnakeCountOption] = useState<6 | 8 | 10>(6);
    const [p1Avatar, setP1Avatar] = useState<Avatar>('mongoose');
    const [p2Avatar, setP2Avatar] = useState<Avatar>('mouse');

    // Import/Load mode
    const [loadSessionId, setLoadSessionId] = useState('');

    // --- Game State ---
    const [phase, setPhase] = useState<GamePhase>('create');
    const [gameState, setGameState] = useState<GameState | null>(null);
    const [mySnakes, setMySnakes] = useState<SnakeDef[]>([]);
    const [opponentSnakes, setOpponentSnakes] = useState<SnakeDef[]>([]);
    const [revealedOpponentSnakes, setRevealedOpponentSnakes] = useState<SnakeDef[]>([]);
    const [revealedMySnakes, setRevealedMySnakes] = useState<SnakeDef[]>([]);
    const [p1BoardCommitted, setP1BoardCommitted] = useState(false);
    const [p2BoardCommitted, setP2BoardCommitted] = useState(false);

    // --- Active Phase ---
    const [diceValue, setDiceValue] = useState<[number, number] | null>(null);
    const [rolling, setRolling] = useState(false);
    const [hitSnake, setHitSnake] = useState<SnakeDef | null>(null);
    const [showProofPanel, setShowProofPanel] = useState(false);
    const [lastProofHash, setLastProofHash] = useState<string | null>(null);
    const [p1IntermediatePos, setP1IntermediatePos] = useState<number | undefined>(undefined);
    const [p2IntermediatePos, setP2IntermediatePos] = useState<number | undefined>(undefined);


    // --- Stats ---
    const statsRef = useRef<GameStats>({ totalMoves: 0, snakesHit: 0, laddersClimbed: 0 });

    // --- UI ---
    const [loading, setLoading] = useState(false);
    const [quickstartLoading, setQuickstartLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [showConfetti, setShowConfetti] = useState(false);
    const [computerThinking, setComputerThinking] = useState(false);

    const isBusy = loading || quickstartLoading;
    const actionLock = useRef(false);
    const computerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const quickstartAvailable = walletType === 'dev'
        && DevWalletService.isDevModeAvailable()
        && DevWalletService.isPlayerAvailable(1)
        && DevWalletService.isPlayerAvailable(2);

    // Keep player1Address in sync with wallet
    useEffect(() => {
        setPlayer1Address(userAddress);
    }, [userAddress]);

    // Use isPrepared to show logic
    const [isPrepared, setIsPrepared] = useState(false);
    const [mockAuthEntry, setMockAuthEntry] = useState('');

    // Derived
    const isP1Turn = gameState?.p1_turn ?? true;
    const amPlayer1 = gameState?.player1 === userAddress;
    const amPlayer2 = gameState?.player2 === userAddress;
    const isMyTurn = isP1Turn ? amPlayer1 : amPlayer2;

    // Helpers
    const parsePoints = (value: string): bigint | null => {
        try {
            const cleaned = value.replace(/[^\d.]/g, '');
            if (!cleaned || cleaned === '.') return null;
            const [whole = '0', fraction = ''] = cleaned.split('.');
            const paddedFraction = fraction.padEnd(POINTS_DECIMALS, '0').slice(0, POINTS_DECIMALS);
            return BigInt(whole + paddedFraction);
        } catch {
            return null;
        }
    };

    const runAction = async (action: () => Promise<void>) => {
        if (actionLock.current || isBusy) return;
        actionLock.current = true;
        try {
            await action();
        } finally {
            actionLock.current = false;
        }
    };

    // Clean up computer timer on unmount
    useEffect(() => {
        return () => {
            if (computerTimerRef.current) clearTimeout(computerTimerRef.current);
        };
    }, []);

    // --- Use ref to track latest game state for computer turn ---
    const gameStateRef = useRef(gameState);
    gameStateRef.current = gameState;
    const mySnakesRef = useRef(mySnakes);
    mySnakesRef.current = mySnakes;
    const opponentSnakesRef = useRef(opponentSnakes);
    opponentSnakesRef.current = opponentSnakes;

    // --- Helpers ---
    /**
     * Determine actual move distance based on dice and current position.
     * Special rule for endgame (tiles 98, 99): if either die matches the exact distance needed
     * to win, use that single die. Otherwise, use the sum.
     */
    const determineMove = (currentPos: number, d1: number, d2: number): number => {
        const distToWin = 100 - currentPos;
        // User requested this specifically for the "last two tiles"
        if (currentPos >= 98) {
            if (d1 === distToWin || d2 === distToWin) {
                return distToWin;
            }
        }
        return d1 + d2;
    };

    // --- Computer auto-play: trigger when it's opponent's turn in vs Computer mode ---
    useEffect(() => {
        if (phase !== 'active' || !gameState || gameMode !== 'computer') return;
        if (gameState.status === 'Finished') return;

        const isComputerTurn = !isP1Turn !== !amPlayer1; // XOR: computer plays when it's NOT player's turn
        if (!isComputerTurn || rolling) return;

        setComputerThinking(true);
        const timer = setTimeout(async () => {
            try {
                const gs = gameStateRef.current;
                if (!gs) return;

                setHitSnake(null);

                const [die1, die2] = await service.rollDice(sessionId);

                // NO dice animation for computer — just compute and move silently
                // Don't update diceValue or rolling for computer turns

                const currentIsP1 = gs.p1_turn;
                const currentPos = currentIsP1 ? gs.p1_position : gs.p2_position;

                // Use endgame rule
                const moveAmount = determineMove(currentPos, die1, die2);
                let diceDestination = currentPos + moveAmount;
                if (diceDestination > 100) diceDestination = currentPos;

                let dest = diceDestination;
                let needsIntermediate = false;

                // Computer checks YOUR snakes (mySnakes = player's snakes)
                const enemySnakes = currentIsP1 ? opponentSnakesRef.current : mySnakesRef.current;
                const snakeHit = enemySnakes.find((s) => s.head === dest);
                let isSnake = false;
                if (snakeHit) {
                    dest = snakeHit.tail;
                    isSnake = true;
                    needsIntermediate = true;
                    setHitSnake(snakeHit);
                }

                const ladderHit = LADDERS.find((l) => l.bottom === dest);
                if (ladderHit && !isSnake) {
                    dest = ladderHit.top;
                    needsIntermediate = true;
                }

                // Set intermediate position for two-phase animation
                if (needsIntermediate) {
                    if (currentIsP1) {
                        setP1IntermediatePos(diceDestination);
                    } else {
                        setP2IntermediatePos(diceDestination);
                    }
                }

                // Generate full proof hash (64 hex chars)
                const proofBytes = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
                setLastProofHash(`0x${proofBytes}`);
                const newHash = computeBoardHash([dest], createRandomSessionId());
                await service.submitOutcome(sessionId, dest, isSnake, newHash);

                const updated = await service.getGame(sessionId);
                setGameState(updated);

                if (updated?.status === 'Finished') {
                    setPhase('complete');
                    setShowConfetti(true);
                    onGameComplete();
                    onStandingsRefresh();
                }

                // Clear intermediate position after animation completes
                if (needsIntermediate) {
                    setTimeout(() => {
                        setP1IntermediatePos(undefined);
                        setP2IntermediatePos(undefined);
                    }, 2000);
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Computer roll failed');
            } finally {
                setComputerThinking(false);
            }
        }, COMPUTER_TURN_DELAY);

        return () => clearTimeout(timer);
    }, [phase, gameState?.p1_turn, gameState?.status, gameMode, rolling]);  // eslint-disable-line react-hooks/exhaustive-deps

    // ----- Handlers -----

    /** Quickstart — creates and signs for both dev wallets in one click */
    const handleQuickStart = async () => {
        await runAction(async () => {
            try {
                setQuickstartLoading(true);
                setError(null);
                setSuccess(null);

                if (walletType !== 'dev') {
                    throw new Error('Quickstart only works with dev wallets in the Games Library.');
                }

                if (!DevWalletService.isDevModeAvailable() || !DevWalletService.isPlayerAvailable(1) || !DevWalletService.isPlayerAvailable(2)) {
                    throw new Error('Quickstart requires both dev wallets. Run "bun run setup" and connect a dev wallet.');
                }

                const p1Points = parsePoints(player1Points);
                if (!p1Points || p1Points <= 0n) {
                    throw new Error('Enter a valid points amount');
                }

                const originalPlayer = devWalletService.getCurrentPlayer();
                let p1Addr = '';
                let p2Addr = '';

                try {
                    await devWalletService.initPlayer(1);
                    p1Addr = devWalletService.getPublicKey();

                    await devWalletService.initPlayer(2);
                    p2Addr = devWalletService.getPublicKey();
                } finally {
                    if (originalPlayer) {
                        await devWalletService.initPlayer(originalPlayer);
                    }
                }

                if (p1Addr === p2Addr) {
                    throw new Error('Quickstart requires two different dev wallets.');
                }

                const qsSessionId = createRandomSessionId();
                setSessionId(qsSessionId);
                setPlayer1Address(p1Addr);

                // Create game in mock engine
                await service.createGame(qsSessionId, p1Addr, p2Addr, p1Points, p1Points, snakeCountOption);

                const game = await service.getGame(qsSessionId);
                setGameState(game);
                setPhase('setup');

                onStandingsRefresh();
                setSuccess('Quickstart complete! Place your snakes.');
                setTimeout(() => setSuccess(null), 3000);
            } catch (err) {
                console.error('Quickstart error:', err);
                setError(err instanceof Error ? err.message : 'Quickstart failed');
            } finally {
                setQuickstartLoading(false);
            }
        });
    };

    /** Create Game — creates the game and moves to setup */
    const handlePrepareTransaction = async () => {
        await runAction(async () => {
            try {
                setLoading(true);
                setError(null);
                setSuccess(null);

                const p1Points = parsePoints(player1Points);
                if (!p1Points || p1Points <= 0n) {
                    throw new Error('Enter a valid points amount');
                }

                const p2Address = gameMode === 'computer'
                    ? 'COMPUTER_OPPONENT'
                    : 'Your Opponent (P2)'; // Placeholder for prepare flow

                await service.createGame(sessionId, player1Address, p2Address, p1Points, p1Points, snakeCountOption);

                const game = await service.getGame(sessionId);
                setGameState(game);
                setPhase('setup');
                setSuccess('Game created! Place your snakes.');
                setTimeout(() => setSuccess(null), 3000);
            } catch (err) {
                console.error('Prepare transaction error:', err);
                setError(err instanceof Error ? err.message : 'Failed to create game');
            } finally {
                setLoading(false);
            }
        });
    };

    /** Load Existing */
    const handleLoadExistingGame = async () => {
        await runAction(async () => {
            try {
                setLoading(true);
                setError(null);
                setSuccess(null);

                const parsedSessionId = parseInt(loadSessionId.trim());
                if (isNaN(parsedSessionId) || parsedSessionId <= 0) {
                    throw new Error('Enter a valid session ID');
                }

                const game = await service.getGame(parsedSessionId);
                if (!game) throw new Error('Game not found');

                setSessionId(parsedSessionId);
                setGameState(game);
                setLoadSessionId('');

                if (game.status === 'Finished') {
                    setPhase('complete');
                } else if (game.status === 'Active') {
                    setPhase('active');
                } else {
                    setPhase('setup');
                }
                setSuccess('Game loaded!');
                setTimeout(() => setSuccess(null), 2000);
            } catch (err) {
                console.error('Load game error:', err);
                setError(err instanceof Error ? err.message : 'Failed to load game');
            } finally {
                setLoading(false);
            }
        });
    };

    /** Auto-generate computer snakes */
    const generateComputerSnakes = useCallback((existingPositions: Set<number>, count: number): SnakeDef[] => {
        const compSnakes: SnakeDef[] = [];
        const usedPositions = new Set(existingPositions);
        let placed = 0;
        const speciesList = ['cobra', 'python', 'boa', 'rattlesnake'];

        // Try positions across the whole board
        for (let head = 95; head > 5 && placed < count; head -= 5) {
            if (usedPositions.has(head) || head === 100) continue;
            const tail = computeTailForHead(head);
            if (tail === null || usedPositions.has(tail)) continue;

            compSnakes.push({ head, tail, species: speciesList[placed % 4] });
            usedPositions.add(head);
            usedPositions.add(tail);
            placed++;
        }
        return compSnakes;
    }, []);

    /** Commit snake layout for a player */
    const handleCommitBoard = useCallback(
        async (snakes: SnakeDef[], forPlayer: ActivePlayer) => {
            try {
                setLoading(true);
                setError(null);

                const positions = snakes.flatMap((s) => [s.head, s.tail]);
                const salt = createRandomSessionId();
                const hash = computeBoardHash(positions, salt);
                const gs = gameState;
                if (!gs) throw new Error('No game state');

                if (forPlayer === 1) {
                    setMySnakes(snakes);
                    await service.setupBoard(sessionId, gs.player1, hash);
                    setP1BoardCommitted(true);

                    if (gameMode === 'computer') {
                        // Auto-generate opponent snakes — truly random positions
                        const usedPositions = new Set(positions);
                        // Also exclude ladder tiles to avoid conflicts
                        const ladderTiles = new Set(LADDERS.flatMap((l) => [l.bottom, l.top]));
                        const halfCount = snakeCountOption / 2;
                        const compSnakes: SnakeDef[] = [];
                        const speciesList = ['cobra', 'python', 'boa', 'rattlesnake'];

                        // Build pool of valid head positions (shuffled)
                        const candidates: number[] = [];
                        for (let h = 2; h <= 99; h++) {
                            if (usedPositions.has(h) || ladderTiles.has(h)) continue;
                            const tail = computeTailForHead(h);
                            if (tail === null || usedPositions.has(tail) || ladderTiles.has(tail)) continue;
                            candidates.push(h);
                        }
                        // Fisher-Yates shuffle for true randomness
                        for (let i = candidates.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
                        }

                        for (const head of candidates) {
                            if (compSnakes.length >= halfCount) break;
                            if (usedPositions.has(head)) continue;
                            const tail = computeTailForHead(head);
                            if (tail === null || usedPositions.has(tail)) continue;
                            compSnakes.push({ head, tail, species: speciesList[compSnakes.length % 4] });
                            usedPositions.add(head);
                            usedPositions.add(tail);
                        }
                        setOpponentSnakes(compSnakes);

                        const oppPositions = compSnakes.flatMap((s) => [s.head, s.tail]);
                        const oppHash = computeBoardHash(oppPositions, createRandomSessionId());
                        await service.setupBoard(sessionId, gs.player2, oppHash);

                        const updated = await service.getGame(sessionId);
                        setGameState(updated);
                        if (updated?.status === 'Active') {
                            setPhase('active');
                            setSuccess('Game is active! Roll the dice.');
                        }
                    } else {
                        // Local mode: wait for player 2
                        setSuccess('Player 1 snakes committed! Switch to Player 2 to place theirs.');
                    }
                } else {
                    // Player 2 committing
                    setOpponentSnakes(snakes);
                    await service.setupBoard(sessionId, gs.player2, hash);
                    setP2BoardCommitted(true);

                    const updated = await service.getGame(sessionId);
                    setGameState(updated);
                    if (updated?.status === 'Active') {
                        setPhase('active');
                        setSuccess('Both players committed! Game is active. Roll the dice.');
                    }
                }

                setTimeout(() => setSuccess(null), 3000);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to commit board');
            } finally {
                setLoading(false);
            }
        },
        [sessionId, gameState, snakeCountOption, gameMode]
    );

    /** Execute a turn (player or computer) */
    const executeTurn = useCallback(async (isPlayerTurn: boolean) => {
        if (!gameState || rolling) return;
        try {
            setError(null);
            setRolling(true);
            setHitSnake(null);
            setP1IntermediatePos(undefined);
            setP2IntermediatePos(undefined);

            const [die1, die2] = await service.rollDice(sessionId);

            // Show rolling animation for 1.2s
            await new Promise((r) => setTimeout(r, 1200));
            setDiceValue([die1, die2]);
            setRolling(false);

            // Compute destination
            const currentIsP1 = gameState.p1_turn;
            const currentPos = currentIsP1 ? gameState.p1_position : gameState.p2_position;

            // Use endgame rule
            const moveAmount = determineMove(currentPos, die1, die2);
            let diceDestination = currentPos + moveAmount;
            if (diceDestination > 100) diceDestination = currentPos; // Overshoot — stay put

            let dest = diceDestination;
            let needsIntermediate = false;

            // Check for snake hit (enemy snakes)
            const enemySnakes = currentIsP1 ? opponentSnakes : mySnakes;
            const snakeHit = enemySnakes.find((s) => s.head === dest);
            let isSnake = false;
            if (snakeHit) {
                dest = snakeHit.tail;
                isSnake = true;
                needsIntermediate = true;
                setHitSnake(snakeHit);
                // If it's P1 turn, reveal opponent snake. If P2 turn, reveal P1 snake.
                if (currentIsP1) {
                    setRevealedOpponentSnakes((prev) =>
                        prev.some((s) => s.head === snakeHit.head) ? prev : [...prev, snakeHit]
                    );
                } else {
                    setRevealedMySnakes((prev) =>
                        prev.some((s) => s.head === snakeHit.head) ? prev : [...prev, snakeHit]
                    );
                }
                if (isPlayerTurn) statsRef.current.snakesHit++;
            }

            // Check for ladder
            const ladderHit = LADDERS.find((l) => l.bottom === dest);
            if (ladderHit && !isSnake) {
                dest = ladderHit.top;
                needsIntermediate = true;
                if (isPlayerTurn) statsRef.current.laddersClimbed++;
            }

            if (isPlayerTurn) statsRef.current.totalMoves++;

            // Set intermediate position for two-phase animation
            if (needsIntermediate) {
                if (currentIsP1) {
                    setP1IntermediatePos(diceDestination);
                } else {
                    setP2IntermediatePos(diceDestination);
                }
            }

            // Simulate proof + submit outcome
            const proofBytes = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
            setLastProofHash(`0x${proofBytes}`);
            const newHash = computeBoardHash([dest], createRandomSessionId());
            await service.submitOutcome(sessionId, dest, isSnake, newHash);

            const updated = await service.getGame(sessionId);
            setGameState(updated);

            if (updated?.status === 'Finished') {
                setPhase('complete');
                setShowConfetti(true);
                onGameComplete();
                onStandingsRefresh();
            }

            // Clear intermediate position after animation completes
            if (needsIntermediate) {
                setTimeout(() => {
                    setP1IntermediatePos(undefined);
                    setP2IntermediatePos(undefined);
                }, 2000);
            }
        } catch (err) {
            setRolling(false);
            setError(err instanceof Error ? err.message : 'Roll failed');
        }
    }, [gameState, sessionId, rolling, mySnakes, opponentSnakes]);

    /** Handle player clicking Roll Dice */
    const handleRollDice = useCallback(async () => {
        await executeTurn(true);
    }, [executeTurn]);

    /** Computer auto-plays its turn */
    const executeComputerTurn = useCallback(async () => {
        try {
            await executeTurn(false);
        } finally {
            setComputerThinking(false);
        }
    }, [executeTurn]);



    // Compute winner info
    const winnerAddress = gameState?.winner;
    // Strict check: did the currently connected wallet win?
    const isWinner = winnerAddress === userAddress;

    const winnerLabel = gameMode === 'local'
        ? (winnerAddress === gameState?.player1 ? 'Player 1' : 'Player 2')
        : (isWinner ? 'You' : 'Computer');

    // ----- Render -----

    return (
        <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-8 shadow-xl border-2 border-green-200">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-3xl font-black bg-gradient-to-r from-green-600 via-emerald-600 to-teal-600 bg-clip-text text-transparent">
                        Snake & Ladders 🐍
                    </h2>
                    <p className="text-sm text-gray-700 font-semibold mt-1">
                        Place hidden traps, roll dice, and race to 100!
                    </p>
                    {phase !== 'create' && (
                        <p className="text-xs text-gray-500 font-mono mt-1">
                            Session: {sessionId} · {gameMode === 'computer' ? '🤖 vs Computer' : '👥 vs Player'}
                        </p>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    {/* Player switcher removed - use wallet to switch */
                        gameMode === 'local' && (phase === 'setup' || phase === 'active') && (
                            <div className="text-xs font-mono text-gray-500 bg-gray-100 px-3 py-1 rounded-lg">
                                {amPlayer1 ? 'Playing as P1' : amPlayer2 ? 'Playing as P2' : 'Spectating'}
                            </div>
                        )}
                    <button
                        onClick={() => {
                            if (computerTimerRef.current) clearTimeout(computerTimerRef.current);
                            if (gameState?.winner) onGameComplete();
                            onBack();
                        }}
                        className="px-5 py-3 rounded-xl bg-gradient-to-r from-gray-200 to-gray-300 hover:from-gray-300 hover:to-gray-400 transition-all text-sm font-bold shadow-md hover:shadow-lg transform hover:scale-105"
                    >
                        ← Back to Games
                    </button>
                </div>
            </div>

            {/* Error / Success banners */}
            {error && (
                <div className="mb-6 p-4 bg-gradient-to-r from-red-50 to-pink-50 border-2 border-red-200 rounded-xl">
                    <p className="text-sm font-semibold text-red-700">{error}</p>
                </div>
            )}
            {success && (
                <div className="mb-6 p-4 bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200 rounded-xl">
                    <p className="text-sm font-semibold text-green-700">{success}</p>
                </div>
            )}

            {/* ===== PHASE 1: CREATE ===== */}
            {phase === 'create' && (
                <div className="space-y-6">
                    {/* Mode Toggle */}
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3 p-2 bg-gray-100 rounded-xl">
                        <button
                            onClick={() => { setCreateMode('create'); setLoadSessionId(''); }}
                            className={`flex-1 py-3 px-4 rounded-lg font-bold text-sm transition-all ${createMode === 'create'
                                ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-lg'
                                : 'bg-white text-gray-600 hover:bg-gray-50'
                                }`}
                        >
                            Create & Export
                        </button>
                        <button
                            onClick={() => { setCreateMode('import'); setLoadSessionId(''); }}
                            className={`flex-1 py-3 px-4 rounded-lg font-bold text-sm transition-all ${createMode === 'import'
                                ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-lg'
                                : 'bg-white text-gray-600 hover:bg-gray-50'
                                }`}
                        >
                            Import Auth Entry
                        </button>
                        <button
                            onClick={() => { setCreateMode('load'); }}
                            className={`flex-1 py-3 px-4 rounded-lg font-bold text-sm transition-all ${createMode === 'load'
                                ? 'bg-gradient-to-r from-purple-500 to-violet-500 text-white shadow-lg'
                                : 'bg-white text-gray-600 hover:bg-gray-50'
                                }`}
                        >
                            Load Existing Game
                        </button>
                    </div>

                    {/* Quickstart (Dev) */}
                    <div className="p-4 bg-gradient-to-r from-yellow-50 to-orange-50 border-2 border-yellow-200 rounded-xl">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                            <div>
                                <p className="text-sm font-bold text-yellow-900">⚡ Quickstart (Dev)</p>
                                <p className="text-xs font-semibold text-yellow-800">
                                    Creates and signs for both dev wallets in one click.
                                </p>
                            </div>
                            <button
                                onClick={handleQuickStart}
                                disabled={isBusy || !quickstartAvailable}
                                className="px-4 py-3 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-md hover:shadow-lg transform hover:scale-105 disabled:transform-none"
                            >
                                {quickstartLoading ? 'Quickstarting...' : '⚡ Quickstart Game'}
                            </button>
                        </div>
                    </div>

                    {/* ===== CREATE MODE ===== */}
                    {createMode === 'create' && (
                        <div className="space-y-6">
                            {/* Game Mode Selector */}
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">
                                    Game Mode
                                </label>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setGameMode('computer')}
                                        disabled={isBusy}
                                        className={`flex-1 py-4 px-4 rounded-xl font-bold text-sm transition-all border-2 ${gameMode === 'computer'
                                            ? 'bg-gradient-to-r from-emerald-100 to-green-100 border-emerald-400 text-emerald-800 shadow-md'
                                            : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                                            }`}
                                    >
                                        <div className="text-2xl mb-1">🤖</div>
                                        vs Computer
                                        <div className="text-xs font-medium mt-1 opacity-70">Auto-plays opponent turns</div>
                                    </button>
                                    <button
                                        onClick={() => setGameMode('local')}
                                        disabled={isBusy}
                                        className={`flex-1 py-4 px-4 rounded-xl font-bold text-sm transition-all border-2 ${gameMode === 'local'
                                            ? 'bg-gradient-to-r from-indigo-100 to-purple-100 border-indigo-400 text-indigo-800 shadow-md'
                                            : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                                            }`}
                                    >
                                        <div className="text-2xl mb-1">👥</div>
                                        vs Player (Local)
                                        <div className="text-xs font-medium mt-1 opacity-70">Switch between players</div>
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">
                                        Your Address (Player 1)
                                    </label>
                                    <input
                                        type="text"
                                        value={player1Address}
                                        onChange={(e) => setPlayer1Address(e.target.value.trim())}
                                        placeholder="G..."
                                        className="w-full px-4 py-3 rounded-xl bg-white border-2 border-gray-200 focus:outline-none focus:border-green-400 focus:ring-4 focus:ring-green-100 text-sm font-medium text-gray-700"
                                    />
                                    <p className="text-xs font-semibold text-gray-600 mt-1">
                                        Pre-filled from your connected wallet.
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">
                                        Your Points
                                    </label>
                                    <input
                                        type="text"
                                        value={player1Points}
                                        onChange={(e) => setPlayer1Points(e.target.value)}
                                        placeholder="0.1"
                                        className="w-full px-4 py-3 rounded-xl bg-white border-2 border-gray-200 focus:outline-none focus:border-green-400 focus:ring-4 focus:ring-green-100 text-sm font-medium text-gray-700"
                                    />
                                    <p className="text-xs font-semibold text-gray-600 mt-1">
                                        Available: {(Number(availablePoints) / 10000000).toFixed(2)} Points
                                    </p>
                                </div>

                                {/* Snake Count */}
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">
                                        Total Snakes on Board
                                    </label>
                                    <div className="flex gap-3">
                                        {([6, 8, 10] as const).map((n) => (
                                            <button
                                                key={n}
                                                onClick={() => setSnakeCountOption(n)}
                                                disabled={isBusy}
                                                className={`flex-1 py-3 px-4 rounded-xl font-bold text-sm transition-all border-2 ${snakeCountOption === n
                                                    ? 'bg-gradient-to-r from-green-100 to-emerald-100 border-green-400 text-green-800 shadow-sm'
                                                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                                                    }`}
                                            >
                                                🐍 {n}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Avatar choice */}
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">
                                        Your Avatar
                                    </label>
                                    <div className="flex gap-3">
                                        <button
                                            onClick={() => setP1Avatar('mongoose')}
                                            disabled={isBusy}
                                            className={`flex-1 py-3 px-4 rounded-xl font-bold text-sm transition-all border-2 ${p1Avatar === 'mongoose'
                                                ? 'bg-gradient-to-r from-green-100 to-emerald-100 border-green-400 text-green-800 shadow-sm'
                                                : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                                                }`}
                                        >
                                            🦡 Mongoose
                                        </button>
                                        <button
                                            onClick={() => setP1Avatar('mouse')}
                                            disabled={isBusy}
                                            className={`flex-1 py-3 px-4 rounded-xl font-bold text-sm transition-all border-2 ${p1Avatar === 'mouse'
                                                ? 'bg-gradient-to-r from-green-100 to-emerald-100 border-green-400 text-green-800 shadow-sm'
                                                : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                                                }`}
                                        >
                                            🐭 Mouse
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className={`pt-4 border-t-2 border-gray-100 ${isPrepared ? 'hidden' : 'block'}`}>
                                <button
                                    onClick={() => {
                                        // Mock preparation
                                        setIsPrepared(true);
                                        setMockAuthEntry('AAAA... (Mock Auth Entry XDR) ...ZZZZ');
                                        setSuccess('Transaction prepared! Send XDR to Player 2.');
                                    }}
                                    disabled={isBusy}
                                    className="w-full py-4 rounded-xl font-bold text-white text-sm bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-lg hover:shadow-xl transform hover:scale-105 disabled:transform-none"
                                >
                                    📄 Prepare & Export Auth Entry
                                </button>
                            </div>

                            {isPrepared && (
                                <div className="space-y-4 pt-2">
                                    <div className="p-4 bg-green-50 border-2 border-green-200 rounded-xl">
                                        <p className="text-xs font-bold text-green-800 mb-2 uppercase tracking-wide">
                                            Auth Entry XDR (Player 1 Signed)
                                        </p>
                                        <div className="bg-white p-3 rounded-lg border border-green-100 break-all font-mono text-xs text-gray-600 mb-3">
                                            {mockAuthEntry}
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => {
                                                    navigator.clipboard.writeText(mockAuthEntry);
                                                    setSuccess('Copied to clipboard!');
                                                    setTimeout(() => setSuccess(null), 2000);
                                                }}
                                                className="flex-1 py-2 rounded-lg bg-green-100 text-green-700 font-bold text-xs hover:bg-green-200 transition-colors"
                                            >
                                                📋 Copy Auth Entry
                                            </button>
                                            <button
                                                className="flex-1 py-2 rounded-lg bg-blue-100 text-blue-700 font-bold text-xs hover:bg-blue-200 transition-colors"
                                            >
                                                🔗 Share URL
                                            </button>
                                        </div>
                                    </div>
                                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
                                        Send this to Player 2. They need to import it to start the game.
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ===== IMPORT MODE ===== */}
                    {createMode === 'import' && (
                        <div className="space-y-4">
                            <div className="p-4 bg-gradient-to-br from-blue-50 to-cyan-50 border-2 border-blue-200 rounded-xl">
                                <p className="text-sm font-semibold text-blue-800 mb-2">
                                    📥 Import Auth Entry from Player 1
                                </p>
                                <p className="text-xs text-gray-700 mb-4">
                                    This feature will be fully available once the contract is deployed. For now, use Quickstart or Create to test the game.
                                </p>
                                <textarea
                                    placeholder="Paste Player 1's signed auth entry XDR here..."
                                    rows={4}
                                    disabled
                                    className="w-full px-4 py-3 rounded-xl bg-white border-2 border-blue-200 text-xs font-mono resize-none text-gray-700"
                                />
                            </div>
                            <div className="p-3 bg-amber-50 border-2 border-amber-200 rounded-xl">
                                <p className="text-xs font-semibold text-amber-800">
                                    ⚠️ Import mode requires a deployed contract. Use <strong>Create</strong> or <strong>Quickstart</strong> to play locally.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* ===== LOAD MODE ===== */}
                    {createMode === 'load' && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">
                                    Session ID
                                </label>
                                <input
                                    type="text"
                                    value={loadSessionId}
                                    onChange={(e) => setLoadSessionId(e.target.value)}
                                    placeholder="Enter game session ID..."
                                    className="w-full px-4 py-3 rounded-xl bg-white border-2 border-gray-200 focus:outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-100 text-sm font-medium text-gray-700"
                                />
                            </div>
                            <button
                                onClick={handleLoadExistingGame}
                                disabled={isBusy || !loadSessionId.trim()}
                                className="w-full py-4 rounded-xl font-bold text-white text-sm bg-gradient-to-r from-purple-500 to-violet-500 hover:from-purple-600 hover:to-violet-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-lg hover:shadow-xl transform hover:scale-105 disabled:transform-none"
                            >
                                {loading ? 'Loading...' : '🔍 Load Game'}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* ===== PHASE 2: SETUP ===== */}
            {phase === 'setup' && (
                <div className="snl-setup">
                    {/* vs Computer: only P1 places, then auto-generate */}
                    {gameMode === 'computer' && (
                        <>
                            {!p1BoardCommitted ? (
                                <SnakePlacement
                                    snakeCount={snakeCountOption / 2}
                                    onCommit={(snakes) => handleCommitBoard(snakes, 1)}
                                    disabled={loading}
                                    playerLabel="Player 1"
                                />
                            ) : (
                                <div className="text-center mt-6">
                                    <div className="inline-block w-8 h-8 border-3 border-gray-200 border-t-green-500 rounded-full animate-spin mb-3" />
                                    <p className="text-sm font-semibold text-gray-600">Setting up the board...</p>
                                </div>
                            )}
                        </>
                    )}

                    {/* vs Player (Local): both players place snakes */}
                    {gameMode === 'local' && (
                        <>
                            {amPlayer1 && !p1BoardCommitted && (
                                <SnakePlacement
                                    snakeCount={snakeCountOption / 2}
                                    onCommit={(snakes) => handleCommitBoard(snakes, 1)}
                                    disabled={loading}
                                    playerLabel="Player 1"
                                />
                            )}
                            {amPlayer1 && p1BoardCommitted && !p2BoardCommitted && (
                                <div className="text-center py-8">
                                    <div className="text-5xl mb-4">⏳</div>
                                    <h3 className="text-lg font-bold text-gray-700 mb-2">Player 1 snakes committed!</h3>
                                    <p className="text-sm text-gray-500 mb-4">Waiting for Player 2 to place their snakes...</p>
                                    <div className="text-xs bg-gray-100 p-2 rounded text-gray-500">
                                        (Switch wallet to Player 2 to continue)
                                    </div>
                                </div>
                            )}
                            {amPlayer2 && !p2BoardCommitted && (
                                <SnakePlacement
                                    snakeCount={snakeCountOption / 2}
                                    onCommit={(snakes) => handleCommitBoard(snakes, 2)}
                                    disabled={loading}
                                    playerLabel="Player 2"
                                />
                            )}
                            {(!amPlayer1 && !amPlayer2) && (
                                <div className="text-center py-8">
                                    <p className="text-gray-500">Connect as Player 1 or Player 2 to place snakes.</p>
                                </div>
                            )}
                            {(amPlayer2 && p2BoardCommitted) || (amPlayer1 && p1BoardCommitted && p2BoardCommitted) ? (
                                <div className="text-center py-8">
                                    <div className="text-5xl mb-4">🎮</div>
                                    <h3 className="text-lg font-bold text-gray-700">Both players ready!</h3>
                                    <p className="text-sm text-gray-500">Starting game...</p>
                                </div>
                            ) : null}
                        </>
                    )}
                </div>
            )}

            {/* ===== PHASE 3: ACTIVE ===== */}
            {phase === 'active' && gameState && (
                <div>
                    {/* Turn indicator */}
                    {gameMode === 'computer' ? (
                        <div className={`mb-4 p-3 rounded-xl text-center font-bold text-sm ${isMyTurn
                            ? 'bg-gradient-to-r from-green-100 to-emerald-100 border-2 border-green-300 text-green-800'
                            : 'bg-gradient-to-r from-amber-100 to-orange-100 border-2 border-amber-300 text-amber-800'
                            }`}>
                            {isMyTurn ? '🎲 Your turn — roll the dice!' : '🤖 Computer is thinking...'}
                        </div>
                    ) : (
                        <div className={`mb-4 p-3 rounded-xl text-center font-bold text-sm ${isMyTurn
                            ? 'bg-gradient-to-r from-green-100 to-emerald-100 border-2 border-green-300 text-green-800'
                            : 'bg-gradient-to-r from-indigo-100 to-purple-100 border-2 border-indigo-300 text-indigo-800'
                            }`}>
                            {isP1Turn
                                ? (amPlayer1 ? '🎲 Your turn (P1) — roll!' : '⏳ Waiting for Player 1...')
                                : (amPlayer2 ? '🎲 Your turn (P2) — roll!' : '⏳ Waiting for Player 2...')
                            }
                        </div>
                    )}

                    <div className="snl-active">
                        <div className="snl-board-area">
                            <Board
                                p1Position={gameState.p1_position}
                                p2Position={gameState.p2_position}
                                p1Avatar={p1Avatar}
                                p2Avatar={p2Avatar}
                                snakes={
                                    gameMode === 'local' && amPlayer2
                                        ? opponentSnakes // P2 sees their own snakes
                                        : mySnakes      // P1 sees their own snakes
                                }
                                opponentSnakes={
                                    gameMode === 'local' && amPlayer2
                                        ? revealedMySnakes // P2 sees P1 snakes only if revealed
                                        : revealedOpponentSnakes // P1 sees P2 snakes only if revealed
                                }
                                hitSnake={hitSnake}
                                p1IntermediatePos={p1IntermediatePos}
                                p2IntermediatePos={p2IntermediatePos}
                                p2Name={gameMode === 'computer' ? 'CPU' : undefined}
                            />
                        </div>

                        <div className="snl-sidebar">
                            {/* Dice */}
                            <div className="snl-dice-section">
                                <Dice3D value={diceValue} rolling={rolling} />
                                <button
                                    className="w-full py-3 rounded-xl font-bold text-white text-sm bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-lg hover:shadow-xl transform hover:scale-105 disabled:transform-none"
                                    onClick={handleRollDice}
                                    disabled={!isMyTurn || rolling || loading || computerThinking}
                                    type="button"
                                >
                                    {rolling
                                        ? 'Rolling...'
                                        : computerThinking
                                            ? '🤖 Computer thinking...'
                                            : isMyTurn
                                                ? '🎲 Roll Dice'
                                                : gameMode === 'local' && !isMyTurn
                                                    ? `Waiting for ${isP1Turn ? 'Player 1' : 'Player 2'}...`
                                                    : '🤖 Computer\'s turn'
                                    }
                                </button>
                            </div>

                            {/* Scoreboard */}
                            <div className="p-4 bg-white border-2 border-gray-200 rounded-xl space-y-3">
                                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Scoreboard</h4>
                                <div className={`flex items-center gap-3 p-2 rounded-lg ${isP1Turn ? 'bg-green-50 border border-green-200' : ''
                                    }`}>
                                    <span className="text-lg">{p1Avatar === 'mongoose' ? '🦡' : '🐭'}</span>
                                    <span className="text-sm font-bold text-gray-700">
                                        {gameMode === 'computer' ? 'You' : 'P1'}
                                    </span>
                                    <span className="ml-auto text-sm font-semibold text-gray-500">
                                        Tile {gameState.p1_position}
                                    </span>
                                </div>
                                <div className={`flex items-center gap-3 p-2 rounded-lg ${!isP1Turn ? 'bg-green-50 border border-green-200' : ''
                                    }`}>
                                    <span className="text-lg">{p2Avatar === 'mongoose' ? '🦡' : '🐭'}</span>
                                    <span className="text-sm font-bold text-gray-700">
                                        {gameMode === 'computer' ? '🤖 CPU' : 'P2'}
                                    </span>
                                    <span className="ml-auto text-sm font-semibold text-gray-500">
                                        Tile {gameState.p2_position}
                                    </span>
                                </div>
                            </div>

                            {/* ZK Proof panel (optional) */}
                            <button
                                className="w-full py-2 rounded-lg text-xs font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 transition-all border border-gray-200"
                                onClick={() => setShowProofPanel(!showProofPanel)}
                                type="button"
                            >
                                {showProofPanel ? '🔒 Hide Proofs' : '🔓 View Proofs'}
                            </button>
                            {showProofPanel && (
                                <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl">
                                    <h4 className="text-xs font-bold text-gray-500 mb-2">ZK Proof Log</h4>
                                    {lastProofHash ? (
                                        <div className="space-y-1">
                                            <p className="text-xs text-gray-600">Last proof:</p>
                                            <div className="flex items-start gap-1">
                                                <code className="text-xs font-mono text-green-700 break-all flex-1">{lastProofHash}</code>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(lastProofHash);
                                                        setSuccess('Proof hash copied!');
                                                        setTimeout(() => setSuccess(null), 1500);
                                                    }}
                                                    className="shrink-0 px-2 py-0.5 text-xs font-bold text-green-600 bg-green-50 border border-green-200 rounded hover:bg-green-100 transition-all"
                                                    title="Copy proof hash"
                                                >
                                                    📋
                                                </button>
                                            </div>
                                            <p className="text-xs font-bold text-green-600">✓ Verified</p>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-gray-400">No proofs yet — roll the dice to generate one.</p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ===== PHASE 4: COMPLETE ===== */}
            {phase === 'complete' && (
                <div className="text-center py-8">
                    {/* Only show confetti if the current user won (matches wallet address) */}
                    {isWinner && showConfetti && <Confetti />}

                    <div className="mb-8" style={{ animation: 'bannerPop 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275)' }}>
                        <h2 className="text-4xl font-black bg-gradient-to-r from-yellow-400 via-orange-400 to-red-400 bg-clip-text text-transparent mb-2">
                            {isWinner ? '🎉 You Won!' : (gameMode === 'local' ? `🏆 ${winnerLabel} Wins!` : '😢 You Lost')}
                        </h2>
                        <p className="text-sm text-gray-500 font-mono">
                            Winner: {winnerLabel}
                        </p>
                    </div>

                    <div className="inline-block p-6 bg-gradient-to-br from-gray-50 to-gray-100 border-2 border-gray-200 rounded-2xl mb-8">
                        <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-4">Game Stats</h3>
                        <div className="grid grid-cols-3 gap-8">
                            <div className="text-center">
                                <div className="text-3xl font-black text-green-600">{statsRef.current.totalMoves}</div>
                                <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mt-1">Moves</div>
                            </div>
                            <div className="text-center">
                                <div className="text-3xl font-black text-red-500">{statsRef.current.snakesHit}</div>
                                <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mt-1">Snakes Hit</div>
                            </div>
                            <div className="text-center">
                                <div className="text-3xl font-black text-blue-500">{statsRef.current.laddersClimbed}</div>
                                <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mt-1">Ladders</div>
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-4 justify-center">
                        <button
                            className="px-6 py-3 rounded-xl font-bold text-white text-sm bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 transition-all shadow-lg hover:shadow-xl transform hover:scale-105"
                            onClick={() => {
                                if (computerTimerRef.current) clearTimeout(computerTimerRef.current);
                                setPhase('create');
                                setSessionId(createRandomSessionId());
                                setGameState(null);
                                setMySnakes([]);
                                setOpponentSnakes([]);
                                setRevealedOpponentSnakes([]);
                                setP1BoardCommitted(false);
                                setP2BoardCommitted(false);
                                setDiceValue(null);
                                setHitSnake(null);
                                setShowConfetti(false);
                                setLastProofHash(null);
                                setComputerThinking(false);
                                setP1IntermediatePos(undefined);
                                setP2IntermediatePos(undefined);
                                statsRef.current = { totalMoves: 0, snakesHit: 0, laddersClimbed: 0 };
                            }}
                            type="button"
                        >
                            🔄 Play Again
                        </button>
                        <button
                            className="px-6 py-3 rounded-xl bg-gradient-to-r from-gray-200 to-gray-300 hover:from-gray-300 hover:to-gray-400 transition-all text-sm font-bold shadow-md hover:shadow-lg transform hover:scale-105"
                            onClick={onBack}
                            type="button"
                        >
                            ← Back to Library
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
