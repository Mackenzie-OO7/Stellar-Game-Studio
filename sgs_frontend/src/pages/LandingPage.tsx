import { WalletSwitcher } from '../components/WalletSwitcher';
import './LandingPage.css';

interface LandingPageProps {
    onPlay: () => void;
    isWalletConnected: boolean;
}

export function LandingPage({ onPlay }: LandingPageProps) {
    return (
        <div className="landing-page">
            {/* Navbar — always visible */}
            <nav className="landing-navbar">
                <div className="landing-navbar-brand">
                    <span className="topbar-logo">🐍</span>
                    <span className="topbar-title">Serpent's Gambit</span>
                </div>
                <div className="landing-navbar-right">
                    <WalletSwitcher />
                </div>
            </nav>

            {/* Animated Jungle Background */}
            <div className="jungle-bg">
                {/* Fireflies */}
                {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="firefly" />
                ))}
                {/* Snake silhouettes */}
                <div className="snake-silhouette">🐍</div>
                <div className="snake-silhouette">🐍</div>
                <div className="snake-silhouette">🐍</div>
            </div>

            <div className="landing-content">
                {/* Hero */}
                <section className="hero-section">
                    <div className="hero-icon">🐍</div>
                    <h1 className="hero-title">Serpent's Gambit</h1>
                    <p className="hero-subtitle">
                        Outwit your opponent through the jungle. Place hidden traps, roll the bones, and
                        prove every move on-chain with Zero-Knowledge magic.
                    </p>
                    <div className="hero-cta-wrapper">
                        <button className="hero-cta" onClick={onPlay}>
                            <span className="cta-icon">🎮</span>
                            Start Game
                        </button>
                    </div>
                </section>

                <div className="section-divider">🌿 · 🐍 · 🌿</div>

                {/* How to Play */}
                <section className="landing-section">
                    <h2 className="section-title">
                        <span className="section-icon">📜</span>
                        How to Play
                    </h2>
                    <div className="rules-grid">
                        <div className="rule-card">
                            <span className="rule-emoji">🐍</span>
                            <div className="rule-title">Place Hidden Snakes</div>
                            <div className="rule-desc">
                                Each player secretly places snakes on the board. Your opponent can't see them
                                until they land on one!
                            </div>
                        </div>
                        <div className="rule-card">
                            <span className="rule-emoji">🎲</span>
                            <div className="rule-title">Roll Dual Dice</div>
                            <div className="rule-desc">
                                Roll two dice each turn. Use the sum to race across the 10×10 board from
                                tile 1 to 100.
                            </div>
                        </div>
                        <div className="rule-card">
                            <span className="rule-emoji">🪜</span>
                            <div className="rule-title">Climb Ladders</div>
                            <div className="rule-desc">
                                Land on a ladder's base and leap up! But watch out — a snake head sends you
                                sliding down.
                            </div>
                        </div>
                        <div className="rule-card">
                            <span className="rule-emoji">🏆</span>
                            <div className="rule-title">Reach 100 First</div>
                            <div className="rule-desc">
                                First player to land on or pass tile 100 wins! Near the end, a single die is
                                automatically used.
                            </div>
                        </div>
                    </div>
                </section>

                {/* ZK Proofs */}
                <section className="landing-section">
                    <h2 className="section-title">
                        <span className="section-icon">🔐</span>
                        Powered by Zero-Knowledge Proofs
                    </h2>
                    <div className="zk-features">
                        <div className="zk-feature">
                            <span className="zk-icon">🎭</span>
                            <div className="zk-text">
                                <h4>Hidden Strategy</h4>
                                <p>
                                    Your snake placements are committed as cryptographic hashes. Opponents can't
                                    peek at your traps.
                                </p>
                            </div>
                        </div>
                        <div className="zk-feature">
                            <span className="zk-icon">✅</span>
                            <div className="zk-text">
                                <h4>Provably Fair</h4>
                                <p>
                                    Every move generates a ZK proof that verifies game rules without revealing
                                    your secret board layout.
                                </p>
                            </div>
                        </div>
                        <div className="zk-feature">
                            <span className="zk-icon">⛓️</span>
                            <div className="zk-text">
                                <h4>On-Chain Verified</h4>
                                <p>
                                    Proofs are verified by a Soroban smart contract on the Stellar network.
                                    No trust required.
                                </p>
                            </div>
                        </div>
                        <div className="zk-feature">
                            <span className="zk-icon">🌟</span>
                            <div className="zk-text">
                                <h4>Stellar Powered</h4>
                                <p>
                                    Built on Stellar's Soroban smart contracts. Fast, cheap, and
                                    environmentally friendly.
                                </p>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Leaderboard */}
                <section className="landing-section">
                    <h2 className="section-title">
                        <span className="section-icon">🏅</span>
                        Jungle Leaderboard
                    </h2>
                    <div className="leaderboard-empty">
                        No games completed yet. Be the first to conquer the jungle!
                    </div>
                </section>

                {/* Footer */}
                <footer className="landing-footer">
                    <p>
                        <span className="footer-brand">Serpent's Gambit</span> — Built with{' '}
                        <a href="https://github.com/Mackenzie-OO7/Stellar-Game-Studio" target="_blank" rel="noopener">
                            Stellar Game Studio
                        </a>
                    </p>
                    <div className="footer-links">
                        <a href="https://stellar.org" target="_blank" rel="noopener">Stellar</a>
                        <a href="https://soroban.stellar.org" target="_blank" rel="noopener">Soroban</a>
                        <a href="https://noir-lang.org" target="_blank" rel="noopener">Noir</a>
                    </div>
                </footer>
            </div>
        </div>
    );
}
