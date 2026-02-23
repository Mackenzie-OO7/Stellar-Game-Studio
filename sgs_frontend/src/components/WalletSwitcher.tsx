import { useState } from 'react';
// import { StellarWalletsKit } from '@creit-tech/stellar-wallets-kit';
// import { Networks } from '@creit-tech/stellar-wallets-kit/types';
// import { FreighterModule } from '@creit-tech/stellar-wallets-kit/modules/freighter';
// import { AlbedoModule } from '@creit-tech/stellar-wallets-kit/modules/albedo';
// import { xBullModule } from '@creit-tech/stellar-wallets-kit/modules/xbull';
import { useWallet } from '../hooks/useWallet';
import './WalletSwitcher.css';

interface WalletSwitcherProps {
  /** When true, shows "Switch to Player X" instead of the wallet widget */
  isQuickstart?: boolean;
  /** Current dev player number in quickstart mode */
  quickstartPlayer?: 1 | 2;
  /** Callback when player is switched in quickstart mode */
  onPlayerSwitch?: (player: 1 | 2) => void;
}

export function WalletSwitcher({ isQuickstart, quickstartPlayer, onPlayerSwitch }: WalletSwitcherProps) {
  const {
    publicKey,
    isConnected,
    isConnecting,
    walletType,
    error,
    connectDev,
    switchPlayer,
    disconnect,
    getCurrentDevPlayer,
    setWallet,
    setNetwork,
    setError,
  } = useWallet();

  const [connecting, setConnecting] = useState(false);
  const currentPlayer = getCurrentDevPlayer();

  // --- Always show player switcher for Dev Wallet Mode ---
  const displayPlayer = quickstartPlayer ?? currentPlayer ?? 1;
  const nextPlayer = displayPlayer === 1 ? 2 : 1;

  const handleSwitch = async () => {
    try {
      setConnecting(true);
      await connectDev(nextPlayer);
      onPlayerSwitch?.(nextPlayer);
    } catch (err) {
      console.error('Failed to switch player:', err);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="wallet-switcher">
      <div className="wallet-status quickstart">
        <span className="qs-label">Player {displayPlayer}</span>
        <button
          onClick={handleSwitch}
          className="switch-button"
          disabled={connecting || isConnecting}
        >
          {connecting || isConnecting ? 'Switching...' : `Switch to Player ${nextPlayer}`}
        </button>
      </div>
    </div>
  );
}
