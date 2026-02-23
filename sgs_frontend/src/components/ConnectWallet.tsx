import { useState } from 'react';
import { StellarWalletsKit } from '@creit-tech/stellar-wallets-kit';
import { Networks } from '@creit-tech/stellar-wallets-kit/types';
import { FreighterModule } from '@creit-tech/stellar-wallets-kit/modules/freighter';
import { AlbedoModule } from '@creit-tech/stellar-wallets-kit/modules/albedo';
import { xBullModule } from '@creit-tech/stellar-wallets-kit/modules/xbull';
import { useWallet } from '../hooks/useWallet';

// Import the CSS for the wallet kit: Not needed / invalid path
// import '@creit-tech/stellar-wallets-kit/compute-styles.css';

export function ConnectWallet({ onConnect }: { onConnect?: () => void }) {
    const { isConnected, setWallet, setNetwork, setError, disconnect } = useWallet();
    const [isConnecting, setIsConnecting] = useState(false);

    const handleConnect = async () => {
        setIsConnecting(true);
        try {
            StellarWalletsKit.init({
                network: (Networks.TESTNET || 'TESTNET') as any,
                selectedWalletId: 'freighter',
                modules: [
                    new (FreighterModule as any)(),
                    new (AlbedoModule as any)(),
                    new (xBullModule as any)(),
                ],
            } as any);

            // authModal returns a promise that resolves with { address } when user connects
            const result = await StellarWalletsKit.authModal({} as any);

            const publicKey = result.address;
            const walletId = StellarWalletsKit.selectedModule.productId;

            // Update global wallet state
            setWallet(publicKey, walletId, 'wallet');
            setNetwork('testnet', 'Test SDF Network ; September 2015');

            if (typeof window !== 'undefined') {
                (window as any).stellarWalletsKit = StellarWalletsKit;
            }

            // Navigate to next screen or callback
            if (onConnect) {
                onConnect();
            }

        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to open wallet modal';
            console.error(msg);
            setError(msg);
        } finally {
            setIsConnecting(false);
        }
    };

    if (isConnected) {
        return (
            <div className="connected-wallet-actions" style={{ display: 'flex', gap: '1rem', flexDirection: 'column', alignItems: 'center' }}>
                <button
                    className="hero-cta"
                    onClick={() => onConnect && onConnect()}
                >
                    <span className="cta-icon">🎮</span>
                    Start Game
                </button>
            </div>
        );
    }

    return (
        <button
            className="hero-cta"
            onClick={handleConnect}
            disabled={isConnecting}
        >
            <span className="cta-icon">🔗</span>
            {isConnecting ? 'Connecting...' : 'Connect Wallet & Play'}
        </button>
    );
}
