import { useState, useEffect, useCallback } from 'react';
import { useWalletStore } from '../store/walletSlice';
import { devWalletService, DevWalletService } from '../services/devWalletService';
import { NETWORK, NETWORK_PASSPHRASE } from '../utils/constants';
import type { ContractSigner } from '../types/signer';
// import { StellarWalletsKit } from '@creit-tech/stellar-wallets-kit';

export function useWallet() {
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-initialize dev wallets on load
  useEffect(() => {
    const initDevWallets = async () => {
      if (!useWalletStore.getState().isConnected && DevWalletService.isDevModeAvailable()) {
        try {
          // Pre-generate/load both players so they exist in memory/localstorage
          await devWalletService.initPlayer(1);
          await devWalletService.initPlayer(2);
          // Default to player 1
          await devWalletService.initPlayer(1);
          useWalletStore.getState().setWallet(
            devWalletService.getPublicKey(),
            'dev_player_1',
            'dev'
          );
        } catch (err) {
          console.error("Failed to pre-initialize dev wallets:", err);
        }
      }
    };
    initDevWallets();
  }, []);

  const {
    publicKey,
    walletId,
    walletType,
    isConnected,
    network,
    networkPassphrase,
    setWallet,
    setNetwork,
    disconnect: storeDisconnect,
  } = useWalletStore();

  /**
   * Connect as a dev player (for testing)
   * DEV MODE ONLY - Not used in production
   */
  const connectDev = useCallback(
    async (playerNumber: 1 | 2 = 1) => {
      try {
        setIsConnecting(true);
        setError(null);

        await devWalletService.initPlayer(playerNumber);
        const address = devWalletService.getPublicKey();

        // Update store with dev wallet
        setWallet(address, `dev-player${playerNumber}`, 'dev');
        setNetwork(NETWORK, NETWORK_PASSPHRASE);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to connect dev wallet';
        setError(errorMessage);
        console.error('Dev wallet connection error:', err);
        throw err;
      } finally {
        setIsConnecting(false);
      }
    },
    [setWallet, setError, setNetwork]
  );

  /**
   * Switch between dev players
   * DEV MODE ONLY - Not used in production
   */
  const switchPlayer = useCallback(
    async (playerNumber: 1 | 2) => {
      if (walletType !== 'dev') {
        throw new Error('Can only switch players in dev mode');
      }

      try {
        setIsConnecting(true);
        setError(null);

        await devWalletService.switchPlayer(playerNumber);
        const address = devWalletService.getPublicKey();

        // Update store with new player
        setWallet(address, `dev-player${playerNumber}`, 'dev');
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to switch player';
        setError(errorMessage);
        console.error('Player switch error:', err);
        throw err;
      } finally {
        setIsConnecting(false);
      }
    },
    [walletType, setWallet, setIsConnecting, setError]
  );

  /**
   * Disconnect wallet
   */
  const disconnect = useCallback(async () => {
    if (walletType === 'dev') {
      devWalletService.disconnect();
    }
    storeDisconnect();
  }, [walletType, storeDisconnect]);

  /**
   * Get a signer for contract interactions
   * Returns functions that the Stellar SDK TS bindings can use for signing
   */
  const getContractSigner = useCallback((): ContractSigner => {
    if (!isConnected || !publicKey || !walletType) {
      throw new Error('Wallet not connected');
    }

    if (walletType === 'dev') {
      // Dev wallet uses the dev wallet service's signer
      return devWalletService.getSigner();
    } else {
      // Real wallet signing
      throw new Error('External wallet integration is currently disabled. Please use the embedded Developer Wallet.');
      // return {
      //   signTransaction: async (tx: string) => {
      //     const kit = (window as any).stellarWalletsKit;
      //     if (!kit) throw new Error('Wallet kit not initialized');
      //     const { signedTx } = await kit.signTransaction(tx, {
      //       network: NETWORK,
      //       networkPassphrase: NETWORK_PASSPHRASE,
      //     });
      //     return signedTx;
      //   },
      //   signAuthEntry: async (entryXdr: string) => {
      //     const kit = (window as any).stellarWalletsKit;
      //     if (!kit) throw new Error('Wallet kit not initialized');
      //     const { signedAuthEntry } = await kit.signAuthEntry(entryXdr, {
      //       network: NETWORK,
      //       networkPassphrase: NETWORK_PASSPHRASE,
      //     });
      //     return signedAuthEntry;
      //   }
      // };
    }
  }, [isConnected, publicKey, walletType]);

  /**
   * Check if dev mode is available
   */
  const isDevModeAvailable = useCallback(() => {
    return DevWalletService.isDevModeAvailable();
  }, []);

  /**
   * Check if a specific dev player is available
   */
  const isDevPlayerAvailable = useCallback((playerNumber: 1 | 2) => {
    return DevWalletService.isPlayerAvailable(playerNumber);
  }, []);

  /**
   * Get current dev player number
   */
  const getCurrentDevPlayer = useCallback(() => {
    if (walletType !== 'dev') {
      return null;
    }
    return devWalletService.getCurrentPlayer();
  }, [walletType]);

  return {
    // State
    publicKey,
    walletId,
    walletType,
    isConnected,
    isConnecting,
    network,
    networkPassphrase,
    error,

    // Actions
    connectDev,
    switchPlayer,
    disconnect,
    getContractSigner,
    isDevModeAvailable,
    isDevPlayerAvailable,
    getCurrentDevPlayer,

    // Exposed Setters for ConnectWallet component
    setWallet,
    setNetwork,
    setError,
  };
}
