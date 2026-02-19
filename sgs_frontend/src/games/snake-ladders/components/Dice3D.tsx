/**
 * Dice3D.tsx — Two 3D CSS cubes side-by-side with rolling animation.
 * Each die independently shows its face value.
 */

import { useState, useEffect } from 'react';

const FACE_PIPS: Record<number, [number, number][]> = {
    1: [[50, 50]],
    2: [[25, 25], [75, 75]],
    3: [[25, 25], [50, 50], [75, 75]],
    4: [[25, 25], [25, 75], [75, 25], [75, 75]],
    5: [[25, 25], [25, 75], [50, 50], [75, 25], [75, 75]],
    6: [[25, 20], [25, 50], [25, 80], [75, 20], [75, 50], [75, 80]],
};

const FACE_ROTATIONS: Record<number, string> = {
    1: 'rotateY(0deg)',
    2: 'rotateY(-90deg)',
    3: 'rotateX(90deg)',
    4: 'rotateX(-90deg)',
    5: 'rotateY(90deg)',
    6: 'rotateY(180deg)',
};

interface Dice3DProps {
    value: [number, number] | null;
    rolling: boolean;
    onRollComplete?: () => void;
}

function SingleDie({ value, rolling }: { value: number; rolling: boolean }) {
    const [displayValue, setDisplayValue] = useState<number>(1);
    const [animClass, setAnimClass] = useState('');

    // Rapid face shuffle while rolling
    useEffect(() => {
        if (!rolling) return;
        setAnimClass('dice-rolling');
        const interval = setInterval(() => {
            setDisplayValue(Math.floor(Math.random() * 6) + 1);
        }, 100);
        return () => clearInterval(interval);
    }, [rolling]);

    // Landing
    useEffect(() => {
        if (rolling) return;
        if (value !== null && value !== undefined) {
            setDisplayValue(value);
            setAnimClass('dice-landing');
            const timer = setTimeout(() => {
                setAnimClass('');
            }, 400);
            return () => clearTimeout(timer);
        }
    }, [rolling, value]);

    const targetRotation = FACE_ROTATIONS[displayValue] ?? '';

    return (
        <div className="dice3d-container" aria-label={`Die showing ${displayValue}`}>
            <div
                className={`dice3d-cube ${animClass}`}
                style={{
                    transform: rolling
                        ? undefined // CSS animation handles it
                        : `${targetRotation}`,
                }}
            >
                {[1, 2, 3, 4, 5, 6].map((face) => (
                    <div key={face} className={`dice3d-face dice3d-face-${face}`}>
                        {FACE_PIPS[face].map(([x, y], i) => (
                            <span
                                key={i}
                                className="dice3d-pip"
                                style={{ left: `${x}%`, top: `${y}%` }}
                            />
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

export function Dice3D({ value, rolling, onRollComplete }: Dice3DProps) {
    const die1Value = value ? value[0] : 1;
    const die2Value = value ? value[1] : 1;
    const total = value ? value[0] + value[1] : null;

    // Fire onRollComplete after landing
    useEffect(() => {
        if (rolling) return;
        if (value !== null) {
            const timer = setTimeout(() => {
                onRollComplete?.();
            }, 400);
            return () => clearTimeout(timer);
        }
    }, [rolling, value]);

    return (
        <div className="dice3d-pair">
            <div className="dice3d-pair-cubes">
                <SingleDie value={die1Value} rolling={rolling} />
                <SingleDie value={die2Value} rolling={rolling} />
            </div>
            {total !== null && !rolling && (
                <div className="dice3d-total">
                    Total: <strong>{total}</strong>
                </div>
            )}
        </div>
    );
}
