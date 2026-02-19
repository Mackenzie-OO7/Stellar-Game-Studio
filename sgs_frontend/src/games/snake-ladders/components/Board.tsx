/**
 * Board.tsx — 10×10 jungle-themed game board with snake/ladder overlays.
 *
 * Tiles are numbered 1-100 in classic snake-path order  (bottom-left = 1,
 * zigzag up).  Each tile has a jungle-themed background (grass, water, earth)
 * seeded deterministically so layouts are stable.
 */

import { useMemo } from 'react';
import { posToRowCol, rowColToPos, type SnakeDef, type LadderDef, LADDERS } from '../snakeLaddersService';
import { PlayerToken } from './PlayerToken';

// Tile type determination — deterministic per tile number
type TileType = 'grass' | 'grass-dark' | 'water' | 'earth' | 'flower';

function tileTypeForPos(pos: number): TileType {
    // Simple hash to get consistent tile types
    const h = ((pos * 2654435761) >>> 0) % 100;
    if (h < 35) return 'grass';
    if (h < 55) return 'grass-dark';
    if (h < 70) return 'earth';
    if (h < 82) return 'water';
    return 'flower';
}

// Snake species colours
const SNAKE_COLORS: Record<string, { body: string; head: string }> = {
    cobra: { body: '#2d6a4f', head: '#1b4332' },
    python: { body: '#6b4226', head: '#3e2723' },
    boa: { body: '#bf360c', head: '#7f0000' },
    rattlesnake: { body: '#827717', head: '#524c00' },
};

// SVG path between two tiles
function tileCentre(pos: number, tileSize: number): { x: number; y: number } {
    const { row, col } = posToRowCol(pos);
    return { x: col * tileSize + tileSize / 2, y: row * tileSize + tileSize / 2 };
}

function snakePath(head: number, tail: number, tileSize: number): string {
    const h = tileCentre(head, tileSize);
    const t = tileCentre(tail, tileSize);
    const mx = (h.x + t.x) / 2 + (Math.random() * 20 - 10);
    const my = (h.y + t.y) / 2;
    // Sinuous S-curve
    const cp1x = h.x + (t.x - h.x) * 0.25 + 15;
    const cp1y = h.y + (t.y - h.y) * 0.25 - 10;
    const cp2x = t.x - (t.x - h.x) * 0.25 - 15;
    const cp2y = t.y - (t.y - h.y) * 0.25 + 10;
    return `M${h.x},${h.y} C${cp1x},${cp1y} ${cp2x},${cp2y} ${t.x},${t.y}`;
}

function ladderPath(bottom: number, top: number, tileSize: number): string {
    const b = tileCentre(bottom, tileSize);
    const t = tileCentre(top, tileSize);
    return `M${b.x},${b.y} L${t.x},${t.y}`;
}

// Component

interface BoardProps {
    p1Position: number;
    p2Position: number;
    p1Avatar: 'mongoose' | 'mouse';
    p2Avatar: 'mongoose' | 'mouse';
    snakes: SnakeDef[];
    opponentSnakes?: SnakeDef[];
    highlightTile?: number | null;
    hitSnake?: SnakeDef | null;
    className?: string;
    p1IntermediatePos?: number;
    p2IntermediatePos?: number;
    p1Name?: string;
    p2Name?: string;
}

export function Board({
    p1Position,
    p2Position,
    p1Avatar,
    p2Avatar,
    snakes,
    opponentSnakes = [],
    highlightTile,
    hitSnake,
    className = '',
    p1IntermediatePos,
    p2IntermediatePos,
    p1Name,
    p2Name,
}: BoardProps) {
    const TILE_SIZE = 60;
    const BOARD_PX = TILE_SIZE * 10;

    // Build grid
    const tiles = useMemo(() => {
        const arr: { pos: number; row: number; col: number; type: TileType }[] = [];
        for (let row = 0; row < 10; row++) {
            for (let col = 0; col < 10; col++) {
                const pos = rowColToPos(row, col);
                arr.push({ pos, row, col, type: tileTypeForPos(pos) });
            }
        }
        return arr;
    }, []);

    const allSnakes = [...snakes, ...opponentSnakes];

    return (
        <div className={`board-wrapper ${className}`}>
            <div
                className="board-grid"
                style={{ width: BOARD_PX, height: BOARD_PX, position: 'relative' }}
            >
                {/* Tiles */}
                {tiles.map((t) => (
                    <div
                        key={t.pos}
                        className={`board-tile tile-${t.type} ${t.pos === 100 ? 'tile-home' : ''} ${highlightTile === t.pos ? 'tile-highlight' : ''}`}
                        style={{
                            position: 'absolute',
                            left: t.col * TILE_SIZE,
                            top: t.row * TILE_SIZE,
                            width: TILE_SIZE,
                            height: TILE_SIZE,
                        }}
                    >
                        <span className="tile-number">{t.pos}</span>
                        {t.pos === 100 && <span className="tile-home-icon">🏠</span>}
                    </div>
                ))}

                {/* SVG overlays for snakes and ladders */}
                <svg
                    className="board-overlays"
                    width={BOARD_PX}
                    height={BOARD_PX}
                    style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
                >
                    {/* Ladders (trees) */}
                    {LADDERS.map((l, i) => {
                        const b = tileCentre(l.bottom, TILE_SIZE);
                        const t = tileCentre(l.top, TILE_SIZE);
                        return (
                            <g key={`ladder-${i}`} className="ladder-group">
                                {/* Left rail */}
                                <line
                                    x1={b.x - 6} y1={b.y}
                                    x2={t.x - 6} y2={t.y}
                                    stroke="#5d4037" strokeWidth={3} strokeLinecap="round"
                                />
                                {/* Right rail */}
                                <line
                                    x1={b.x + 6} y1={b.y}
                                    x2={t.x + 6} y2={t.y}
                                    stroke="#5d4037" strokeWidth={3} strokeLinecap="round"
                                />
                                {/* Rungs */}
                                {Array.from({ length: 4 }).map((_, r) => {
                                    const frac = (r + 1) / 5;
                                    const rx = b.x + (t.x - b.x) * frac;
                                    const ry = b.y + (t.y - b.y) * frac;
                                    return (
                                        <line
                                            key={r}
                                            x1={rx - 6} y1={ry}
                                            x2={rx + 6} y2={ry}
                                            stroke="#8d6e63" strokeWidth={2} strokeLinecap="round"
                                        />
                                    );
                                })}
                                {/* Tree crown at top */}
                                <circle cx={t.x} cy={t.y - 12} r={10} fill="#2e7d32" opacity={0.7} />
                                <circle cx={t.x - 6} cy={t.y - 8} r={7} fill="#388e3c" opacity={0.6} />
                                <circle cx={t.x + 6} cy={t.y - 8} r={7} fill="#388e3c" opacity={0.6} />
                            </g>
                        );
                    })}

                    {/* Snakes */}
                    {allSnakes.map((s, i) => {
                        const colors = SNAKE_COLORS[s.species] ?? SNAKE_COLORS.cobra;
                        const h = tileCentre(s.head, TILE_SIZE);
                        const t = tileCentre(s.tail, TILE_SIZE);
                        const isHit = hitSnake?.head === s.head;
                        return (
                            <g key={`snake-${i}`} className={`snake-group ${isHit ? 'snake-hit' : ''}`}>
                                {/* Body */}
                                <path
                                    d={snakePath(s.head, s.tail, TILE_SIZE)}
                                    fill="none"
                                    stroke={colors.body}
                                    strokeWidth={5}
                                    strokeLinecap="round"
                                    opacity={0.8}
                                    className="snake-body"
                                />
                                {/* Pattern overlay */}
                                <path
                                    d={snakePath(s.head, s.tail, TILE_SIZE)}
                                    fill="none"
                                    stroke={colors.body}
                                    strokeWidth={2}
                                    strokeDasharray="4 6"
                                    strokeLinecap="round"
                                    opacity={0.4}
                                />
                                {/* Head */}
                                <circle
                                    cx={h.x} cy={h.y}
                                    r={6}
                                    fill={colors.head}
                                    className="snake-head-circle"
                                />
                                {/* Eyes */}
                                <circle cx={h.x - 2} cy={h.y - 2} r={1.5} fill="#fff" />
                                <circle cx={h.x + 2} cy={h.y - 2} r={1.5} fill="#fff" />
                                <circle cx={h.x - 2} cy={h.y - 2} r={0.8} fill="#000" />
                                <circle cx={h.x + 2} cy={h.y - 2} r={0.8} fill="#000" />
                                {/* Tongue (visible on hit) */}
                                {isHit && (
                                    <line
                                        x1={h.x} y1={h.y + 4}
                                        x2={h.x} y2={h.y + 12}
                                        stroke="#e53935" strokeWidth={1.5}
                                        className="snake-tongue"
                                    />
                                )}
                                {/* Tail */}
                                <circle cx={t.x} cy={t.y} r={3} fill={colors.body} opacity={0.6} />
                            </g>
                        );
                    })}
                </svg>

                {/* Player tokens */}
                <PlayerToken
                    position={p1Position}
                    avatar={p1Avatar}
                    tileSize={TILE_SIZE}
                    player={1}
                    intermediatePosition={p1IntermediatePos}
                    playerName={p1Name}
                />
                <PlayerToken
                    position={p2Position}
                    avatar={p2Avatar}
                    tileSize={TILE_SIZE}
                    player={2}
                    intermediatePosition={p2IntermediatePos}
                    playerName={p2Name}
                />
            </div>
        </div>
    );
}
