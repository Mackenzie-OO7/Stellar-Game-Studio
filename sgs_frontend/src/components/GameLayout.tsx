import type { ReactNode } from 'react';
import { WalletSwitcher } from './WalletSwitcher';
import './GameLayout.css';

interface GameLayoutProps {
    children: ReactNode;
    onNavigateHome: () => void;
    /** Quickstart mode: transforms the wallet widget into a player switcher */
    isQuickstart?: boolean;
    quickstartPlayer?: 1 | 2;
    onPlayerSwitch?: (player: 1 | 2) => void;
}

export function GameLayout({ children, onNavigateHome, isQuickstart, quickstartPlayer, onPlayerSwitch }: GameLayoutProps) {
    return (
        <div className="game-layout">
            <header className="game-topbar">
                <div className="topbar-brand" onClick={onNavigateHome}>
                    <span className="topbar-logo">🐍</span>
                    <span className="topbar-title">Serpent's Gambit</span>
                </div>
                <div className="topbar-right">
                    <WalletSwitcher
                        isQuickstart={isQuickstart}
                        quickstartPlayer={quickstartPlayer}
                        onPlayerSwitch={onPlayerSwitch}
                    />
                </div>
            </header>
            <main className="game-content">
                {children}
            </main>
        </div>
    );
}
