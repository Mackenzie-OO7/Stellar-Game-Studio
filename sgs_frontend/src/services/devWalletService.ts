import { Buffer } from 'buffer';
import { Keypair, TransactionBuilder, hash } from '@stellar/stellar-sdk';
import type { ContractSigner } from '../types/signer';
import type { WalletError } from '@stellar/stellar-sdk/contract';

/**
 * Dev Wallet Service
 * Provides test wallet functionality for local development
 * Uses secret keys from environment variables (populated by setup script)
 */
class DevWalletService {
  private currentPlayer: 1 | 2 | null = null;
  private keypairs: Record<string, Keypair> = {};

  /**
   * Check if dev mode is available
   */
  static isDevModeAvailable(): boolean {
    // Dev mode is always available now since we dynamically generate embedded wallets
    return true;
  }

  /**
   * Check if a specific player is available
   */
  static isPlayerAvailable(playerNumber: 1 | 2): boolean {
    // Player is always available because we auto-generate them
    return true;
  }

  /**
   * Initialize a player from environment variables
   */
  async initPlayer(playerNumber: 1 | 2): Promise<void> {
    try {
      const playerKey = `player${playerNumber}`;
      const localStoreKey = `sgs_dev_player${playerNumber}_secret`;

      // 1. Try to load from localStorage (embedded wallet)
      let secretEnvVar = localStorage.getItem(localStoreKey);

      // 2. Fallback to .env (for backwards compatibility with existing setups)
      if (!secretEnvVar) {
        const envFallback = playerNumber === 1
          ? import.meta.env.VITE_DEV_PLAYER1_SECRET
          : import.meta.env.VITE_DEV_PLAYER2_SECRET;

        if (envFallback && envFallback !== 'NOT_AVAILABLE') {
          secretEnvVar = envFallback as string;
          localStorage.setItem(localStoreKey, secretEnvVar);
        }
      }

      // 3. If STILL no secret exists, generate a brand new one dynamically!
      // This fulfills the requirement that new players get instant embedded funded testnet wallets.
      if (!secretEnvVar) {
        console.log(`Generating a new Keypair for embedded Player ${playerNumber}...`);
        const newKp = Keypair.random();
        secretEnvVar = newKp.secret();
        localStorage.setItem(localStoreKey, secretEnvVar);
      }

      // Create keypair from secret key
      const keypair = Keypair.fromSecret(secretEnvVar as string);

      // Auto-fund on testnet if the account does not exist
      try {
        let accountExists = false;
        try {
          const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${keypair.publicKey()}`);
          if (res.ok) accountExists = true;
        } catch (e) { /* ignore */ }

        if (!accountExists) {
          console.log(`Funding Dev Wallet Player ${playerNumber} via Friendbot...`);
          const fbRes = await fetch(`https://friendbot.stellar.org/?addr=${keypair.publicKey()}`);
          if (!fbRes.ok) {
            console.warn(`Friendbot returned ${fbRes.status}. Retrying in 2s...`);
            await new Promise(r => setTimeout(r, 2000));
            await fetch(`https://friendbot.stellar.org/?addr=${keypair.publicKey()}`);
          }

          // Wait and verify account exists
          for (let i = 0; i < 3; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const checkRes = await fetch(`https://horizon-testnet.stellar.org/accounts/${keypair.publicKey()}`);
            if (checkRes.ok) {
              console.log(`Player ${playerNumber} funded successfully and verified on Horizon.`);
              accountExists = true;
              break;
            }
          }
          if (!accountExists) {
            throw new Error(`Friendbot failed to aggressively fund Player ${playerNumber}. Testnet may be congested.`);
          }
        }
      } catch (err) {
        console.warn(`Could not verify funding for Player ${playerNumber}:`, err);
      }

      this.keypairs[playerKey] = keypair;
      this.currentPlayer = playerNumber;

      console.log(`Dev wallet initialized for Player ${playerNumber}: ${keypair.publicKey()}`);
    } catch (error) {
      console.error('Failed to initialize dev wallet:', error);
      throw error;
    }
  }

  /**
   * Get current player's public key
   */
  getPublicKey(): string {
    if (!this.currentPlayer) {
      throw new Error('No player initialized');
    }

    const playerKey = `player${this.currentPlayer}`;
    const keypair = this.keypairs[playerKey];

    if (!keypair) {
      throw new Error(`Player ${this.currentPlayer} not initialized`);
    }

    return keypair.publicKey();
  }

  /**
   * Get current player number
   */
  getCurrentPlayer(): 1 | 2 | null {
    return this.currentPlayer;
  }

  /**
   * Switch to another player
   */
  async switchPlayer(playerNumber: 1 | 2): Promise<void> {
    await this.initPlayer(playerNumber);
  }

  /**
   * Disconnect wallet
   */
  disconnect(): void {
    this.currentPlayer = null;
    this.keypairs = {};
  }

  /**
   * Get a signer for contract interactions
   * Uses actual keypair to sign transactions
   */
  getSigner(): ContractSigner {
    const playerKey = this.currentPlayer ? `player${this.currentPlayer}` : null;

    if (!playerKey || !this.keypairs[playerKey]) {
      throw new Error('No player initialized');
    }

    const keypair = this.keypairs[playerKey];
    const publicKey = keypair.publicKey();
    const toWalletError = (message: string): WalletError => ({ message, code: -1 });

    return {
      signTransaction: async (txXdr: string, opts?: any) => {
        try {
          if (!opts?.networkPassphrase) {
            throw new Error('Missing networkPassphrase');
          }

          const transaction = TransactionBuilder.fromXDR(txXdr, opts.networkPassphrase);
          transaction.sign(keypair);
          const signedTxXdr = transaction.toXDR();

          return {
            signedTxXdr,
            signerAddress: publicKey,
          };
        } catch (error) {
          console.error('Failed to sign transaction:', error);
          return {
            signedTxXdr: txXdr,
            signerAddress: publicKey,
            error: toWalletError(
              error instanceof Error ? error.message : 'Failed to sign transaction'
            ),
          };
        }
      },

      signAuthEntry: async (preimageXdr: string, opts?: any) => {
        try {
          // `authorizeEntry` signs the *hash* of the preimage XDR (see stellar-base's `authorizeEntry`).
          // Dev wallet must match that behavior.
          const preimageBytes = Buffer.from(preimageXdr, 'base64');
          const payload = hash(preimageBytes);
          const signatureBytes = keypair.sign(payload);

          return {
            signedAuthEntry: Buffer.from(signatureBytes).toString('base64'),
            signerAddress: publicKey,
          };
        } catch (error) {
          console.error('Failed to sign auth entry:', error);
          return {
            signedAuthEntry: preimageXdr,
            signerAddress: publicKey,
            error: toWalletError(
              error instanceof Error ? error.message : 'Failed to sign auth entry'
            ),
          };
        }
      },
    };
  }

  /**
   * Get public key for specific player
   */
  async getPublicKeyFor(playerNumber: 1 | 2): Promise<string> {
    const playerKey = `player${playerNumber}`;
    if (!this.keypairs[playerKey]) {
      await this.initPlayer(playerNumber);
    }
    return this.keypairs[playerKey].publicKey();
  }

  /**
   * Get a signer for a specific player (used in Quickstart mode)
   */
  async getSignerFor(playerNumber: 1 | 2): Promise<ContractSigner> {
    const playerKey = `player${playerNumber}`;
    if (!this.keypairs[playerKey]) {
      await this.initPlayer(playerNumber);
    }

    const keypair = this.keypairs[playerKey];
    const publicKey = keypair.publicKey();
    const toWalletError = (message: string): WalletError => ({ message, code: -1 });

    return {
      signTransaction: async (txXdr: string, opts?: any) => {
        try {
          if (!opts?.networkPassphrase) {
            throw new Error('Missing networkPassphrase');
          }

          const transaction = TransactionBuilder.fromXDR(txXdr, opts.networkPassphrase);
          transaction.sign(keypair);

          return {
            signedTxXdr: transaction.toXDR(),
            signerAddress: publicKey,
          };
        } catch (error) {
          console.error(`Failed to sign transaction for player ${playerNumber}:`, error);
          return {
            signedTxXdr: txXdr,
            signerAddress: publicKey,
            error: toWalletError(
              error instanceof Error ? error.message : 'Failed to sign transaction'
            ),
          };
        }
      },

      signAuthEntry: async (preimageXdr: string, opts?: any) => {
        try {
          const preimageBytes = Buffer.from(preimageXdr, 'base64');
          const payload = hash(preimageBytes);
          const signatureBytes = keypair.sign(payload);

          return {
            signedAuthEntry: Buffer.from(signatureBytes).toString('base64'),
            signerAddress: publicKey,
          };
        } catch (error) {
          console.error(`Failed to sign auth entry for player ${playerNumber}:`, error);
          return {
            signedAuthEntry: preimageXdr,
            signerAddress: publicKey,
            error: toWalletError(
              error instanceof Error ? error.message : 'Failed to sign auth entry'
            ),
          };
        }
      },
    };
  }

  /**
   * Sign transaction for specific player
   */
  async signTransactionFor(txXdr: string, playerNumber: 1 | 2, networkPassphrase?: string): Promise<string> {
    const playerKey = `player${playerNumber}`;
    if (!this.keypairs[playerKey]) {
      await this.initPlayer(playerNumber);
    }

    const keypair = this.keypairs[playerKey];
    const passphrase = networkPassphrase || import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';

    const transaction = TransactionBuilder.fromXDR(txXdr, passphrase);
    transaction.sign(keypair);
    return transaction.toXDR();
  }
}

// Export singleton instance
export const devWalletService = new DevWalletService();
export { DevWalletService };
