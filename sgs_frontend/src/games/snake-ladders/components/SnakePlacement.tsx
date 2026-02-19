/**
 * Interactive grid for placing snake heads during setup.
 *
 * Player taps a tile to place a snake head; the tail is auto-calculated 2–4 rows
 * below.
 */

import { useState, useCallback } from 'react';
import {
    rowColToPos,
    computeTailForHead,
    randomSpecies,
    type SnakeDef,
    MIN_SNAKE_ROW_SPAN,
    MAX_SNAKE_ROW_SPAN,
} from '../snakeLaddersService';

interface SnakePlacementProps {
    snakeCount: number;
    onCommit: (snakes: SnakeDef[]) => void;
    disabled?: boolean;
    playerLabel?: string;
}

export function SnakePlacement({ snakeCount, onCommit, disabled = false, playerLabel }: SnakePlacementProps) {
    const [snakes, setSnakes] = useState<SnakeDef[]>([]);
    const [hoverTile, setHoverTile] = useState<number | null>(null);

    const occupiedHeads = new Set(snakes.map((s) => s.head));
    const occupiedTails = new Set(snakes.map((s) => s.tail));
    const allOccupied = new Set([...occupiedHeads, ...occupiedTails]);

    const canPlaceHead = useCallback(
        (pos: number): boolean => {
            if (pos <= 0 || pos >= 100) return false;  // can't place on start or finish
            if (allOccupied.has(pos)) return false;
            const tail = computeTailForHead(pos);
            if (tail === null) return false;
            if (allOccupied.has(tail)) return false;
            return true;
        },
        [allOccupied]
    );

    const handleTileClick = useCallback(
        (pos: number) => {
            if (disabled) return;

            // If tile is already a head, remove that snake
            const existing = snakes.findIndex((s) => s.head === pos);
            if (existing >= 0) {
                setSnakes((prev) => prev.filter((_, i) => i !== existing));
                return;
            }

            if (snakes.length >= snakeCount) return;
            if (!canPlaceHead(pos)) return;

            const tail = computeTailForHead(pos)!;
            setSnakes((prev) => [
                ...prev,
                { head: pos, tail, species: randomSpecies() },
            ]);
        },
        [snakes, snakeCount, canPlaceHead, disabled]
    );

    const hoverTail = hoverTile !== null ? computeTailForHead(hoverTile) : null;
    const canHover = hoverTile !== null && canPlaceHead(hoverTile) && snakes.length < snakeCount;

    return (
        <div className="snake-placement">
            <div className="placement-header">
                <h3>{playerLabel ? `${playerLabel} — Place Your Snakes` : 'Place Your Snakes'}</h3>
                <p className="placement-counter">
                    {snakes.length} / {snakeCount} placed
                </p>
                <p className="placement-hint">
                    Tap a tile to place a snake head. The tail extends {MIN_SNAKE_ROW_SPAN}–{MAX_SNAKE_ROW_SPAN} rows below.
                    Tap an existing head to remove it.
                </p>
            </div>

            <div className="placement-grid">
                {Array.from({ length: 100 }, (_, idx) => {
                    const row = Math.floor(idx / 10);
                    const rawCol = idx % 10;
                    const fromTop = row;
                    const col = fromTop % 2 === 0 ? rawCol : 9 - rawCol;
                    const actualPos = rowColToPos(row, col);

                    const isHead = snakes.some((s) => s.head === actualPos);
                    const isTail = snakes.some((s) => s.tail === actualPos);
                    const isHoverHead = canHover && hoverTile === actualPos;
                    const isHoverTail = canHover && hoverTail === actualPos;
                    const isValid = canPlaceHead(actualPos) && snakes.length < snakeCount;
                    const isOccupied = allOccupied.has(actualPos);

                    let tileClass = 'placement-tile';
                    if (isHead) tileClass += ' tile-snake-head';
                    else if (isTail) tileClass += ' tile-snake-tail';
                    else if (isHoverHead) tileClass += ' tile-hover-head';
                    else if (isHoverTail) tileClass += ' tile-hover-tail';
                    else if (actualPos === 100) tileClass += ' tile-finish';
                    else if (!isValid && !isOccupied) tileClass += ' tile-invalid';

                    return (
                        <button
                            key={actualPos}
                            className={tileClass}
                            onClick={() => handleTileClick(actualPos)}
                            onMouseEnter={() => setHoverTile(actualPos)}
                            onMouseLeave={() => setHoverTile(null)}
                            disabled={disabled || (actualPos === 100)}
                            type="button"
                        >
                            {actualPos}
                            {isHead && <span className="tile-icon">🐍</span>}
                            {isTail && <span className="tile-icon">•</span>}
                        </button>
                    );
                })}
            </div>

            <button
                className="btn-commit"
                onClick={() => onCommit(snakes)}
                disabled={disabled || snakes.length !== snakeCount}
                type="button"
            >
                {snakes.length === snakeCount
                    ? '🔒 Commit Snake Layout'
                    : `Place ${snakeCount - snakes.length} more snake${snakeCount - snakes.length === 1 ? '' : 's'}`}
            </button>
        </div>
    );
}
