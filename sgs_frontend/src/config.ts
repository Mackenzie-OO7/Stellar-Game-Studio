/**
 * Configuration for Serpent's Gambit
 */

import { getAllContractIds, getContractId } from './utils/constants';

export const config = {
  rpcUrl: import.meta.env.VITE_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org',
  networkPassphrase: import.meta.env.VITE_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',
  contractIds: getAllContractIds(),

  // Named contract aliases
  mockGameHubId: getContractId('mock-game-hub'),
  snakeLaddersId: getContractId('snake-ladders'),
  zkVerifierId: getContractId('zk-verifier'),

  devPlayer1Address: import.meta.env.VITE_DEV_PLAYER1_ADDRESS || '',
  devPlayer2Address: import.meta.env.VITE_DEV_PLAYER2_ADDRESS || '',
};

if (!config.snakeLaddersId) {
  console.warn('Snake & Ladders contract ID not configured. Run `bun run setup` from the repo root.');
}
