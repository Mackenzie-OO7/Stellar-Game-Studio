/**
 * Transaction helper utilities
 */

import { contract, rpc, TransactionBuilder } from '@stellar/stellar-sdk';

/**
 * Sign and send a transaction via Launchtube
 * @param tx - The assembled transaction or XDR string
 * @param timeoutInSeconds - Timeout for the transaction
 * @param validUntilLedgerSeq - Valid until ledger sequence
 * @returns Transaction result
 */
export async function signAndSendViaLaunchtube(
  tx: contract.AssembledTransaction<any> | string,
  timeoutInSeconds: number = 30,
  validUntilLedgerSeq?: number
): Promise<contract.SentTransaction<any>> {
  if (typeof tx !== 'string' && 'simulate' in tx) {
    const simulated = await tx.simulate();
    try {
      const result = await simulated.signAndSend();
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return result;
    } catch (err: any) {
      const errName = err?.name ?? '';
      const errMessage = err instanceof Error ? err.message : String(err);
      const isNoSignatureNeeded =
        errName.includes('NoSignatureNeededError') ||
        errMessage.includes('NoSignatureNeededError') ||
        errMessage.includes('This is a read call') ||
        errMessage.includes('requires no signature') ||
        errMessage.includes('force: true');

      // Some contract bindings incorrectly classify state-changing methods as "read calls".
      // In those cases, the SDK requires `force: true` to sign and send anyway.
      if (isNoSignatureNeeded) {
        try {
          const forceResult = await simulated.signAndSend({ force: true });
          await new Promise((resolve) => setTimeout(resolve, 3000));
          return forceResult;
        } catch (forceErr: any) {
          const forceName = forceErr?.name ?? '';
          const forceMessage = forceErr instanceof Error ? forceErr.message : String(forceErr);
          const isStillReadOnly =
            forceName.includes('NoSignatureNeededError') ||
            forceMessage.includes('NoSignatureNeededError') ||
            forceMessage.includes('This is a read call') ||
            forceMessage.includes('requires no signature');

          // If the SDK still says it's a read call, treat the simulation result as the final result.
          if (isStillReadOnly) {
            const simulatedResult =
              (simulated as any).result ??
              (simulated as any).simulationResult?.result ??
              (simulated as any).returnValue ??
              (tx as any).result;

            return {
              result: simulatedResult,
              getTransactionResponse: undefined,
            } as unknown as contract.SentTransaction<any>;
          }

          throw forceErr;
        }
      }

      throw err;
    }
  }

  // If tx is XDR string, it needs to be sent directly
  // This is typically used for multi-sig flows where the transaction is already built
  if (typeof tx === 'string') {
    const server = new rpc.Server(import.meta.env.VITE_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org');

    // We already have a base64 encoded signed transaction envelope
    try {
      const txObj = TransactionBuilder.fromXDR(tx, import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015');
      const response = await server.sendTransaction(txObj as any);

      if (response.status === 'ERROR') {
        const errorResult = (response as any).errorResultXdr || 'Unknown error';
        throw new Error(`sendTransaction failed with ERROR status. Details: ${errorResult}`);
      }

      // Wait for completion
      let statusResponse = await server.getTransaction(response.hash);
      let attempts = 0;
      while (statusResponse.status === rpc.Api.GetTransactionStatus.NOT_FOUND && attempts < 15) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        statusResponse = await server.getTransaction(response.hash);
        attempts++;
      }

      if (statusResponse.status === rpc.Api.GetTransactionStatus.FAILED) {
        const resultMetaXdr = (statusResponse as any).resultMetaXdr || '';
        throw new Error(`Transaction failed on network (status=FAILED). Meta: ${resultMetaXdr}`);
      }

      // Add a small delay to allow Horizon/Soroban RPC to index the ledger's sequence numbers and contract state
      // This prevents subsequent rapid transactions from failing with txBadSeq or missing state
      await new Promise(resolve => setTimeout(resolve, 3000));

      return {
        result: (statusResponse as any).resultMetaXdr,
        getTransactionResponse: async () => statusResponse as any,
      } as unknown as contract.SentTransaction<any>;
    } catch (e) {
      throw e;
    }
  }

  throw new Error('Invalid transaction argument type provided to signAndSendViaLaunchtube.');
}
