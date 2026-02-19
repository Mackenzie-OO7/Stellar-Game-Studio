/**
 * Mongoose or mouse avata.
 *
 * Supports two-phase movement:
 *   Phase 1: Hop tile-by-tile from prevPos → intermediatePosition (dice roll destination)
 *   Phase 2: Slide from intermediatePosition → position (ladder climb or snake slide)
 */

import { useState, useEffect, useRef } from 'react';
import { posToRowCol } from '../snakeLaddersService';

interface PlayerTokenProps {
    position: number;
    avatar: 'mongoose' | 'mouse';
    tileSize: number;
    player: 1 | 2;
    intermediatePosition?: number;
    playerName?: string;
}

const AVATARS: Record<string, { emoji: string; label: string }> = {
    mongoose: { emoji: '🦡', label: 'Mongoose' },
    mouse: { emoji: '🐭', label: 'Mouse' },
};

export function PlayerToken({ position, avatar, tileSize, player, intermediatePosition, playerName }: PlayerTokenProps) {
    const [displayPos, setDisplayPos] = useState(position);
    const [hopping, setHopping] = useState(false);
    const prevPos = useRef(position);
    const animating = useRef(false);

    useEffect(() => {
        if (position === prevPos.current && intermediatePosition === undefined) return;
        if (animating.current) return;

        const from = prevPos.current;
        prevPos.current = position;
        animating.current = true;

        // Determine if we have a two-phase move
        const hasIntermediate = intermediatePosition !== undefined && intermediatePosition !== position;
        const phase1Target = hasIntermediate ? intermediatePosition : position;

        const phase1Steps = phase1Target - from;

        if (phase1Steps <= 0 && !hasIntermediate) {
            setHopping(true);
            setDisplayPos(position);
            const timer = setTimeout(() => {
                setHopping(false);
                animating.current = false;
            }, 600);
            return () => { clearTimeout(timer); animating.current = false; };
        }

        if (phase1Steps === 0 && hasIntermediate) {
            setHopping(true);
            setDisplayPos(position);
            const timer = setTimeout(() => {
                setHopping(false);
                animating.current = false;
            }, 600);
            return () => { clearTimeout(timer); animating.current = false; };
        }

        let step = 0;
        setHopping(true);

        const hopInterval = setInterval(() => {
            step++;
            const nextPos = from + step;
            setDisplayPos(nextPos);
            if (step >= phase1Steps) {
                clearInterval(hopInterval);

                if (hasIntermediate) {
                    setTimeout(() => {
                        setDisplayPos(position);
                        setTimeout(() => {
                            setHopping(false);
                            animating.current = false;
                        }, 600);
                    }, 400);
                } else {
                    setTimeout(() => {
                        setHopping(false);
                        animating.current = false;
                    }, 200);
                }
            }
        }, 180); // ~180ms per hop

        return () => {
            clearInterval(hopInterval);
            animating.current = false;
        };
    }, [position, intermediatePosition]);

    const { row, col } = posToRowCol(displayPos);
    const avatarInfo = AVATARS[avatar];

    const offsetX = player === 2 ? tileSize * 0.3 : tileSize * 0.1;
    const offsetY = player === 2 ? tileSize * 0.3 : tileSize * 0.1;

    return (
        <div
            className={`player-token player-${player} ${hopping ? 'token-hopping' : ''}`}
            style={{
                position: 'absolute',
                left: col * tileSize + offsetX,
                top: row * tileSize + offsetY,
                width: tileSize * 0.6,
                height: tileSize * 0.6,
                transition: hopping ? 'left 0.15s ease, top 0.15s ease' : 'left 0.5s ease, top 0.5s ease',
                zIndex: 10 + player,
            }}
            title={`${avatarInfo.label} (Player ${player}) — Tile ${displayPos}`}
        >
            <span className="token-emoji">{avatarInfo.emoji}</span>
            <span className="token-label">{playerName || `P${player}`}</span>
        </div>
    );
}
