import { UltraHonkBackend } from '@noir-lang/backend_barretenberg';
import { Noir } from '@noir-lang/noir_js';
// @ts-ignore
import moveEvalCircuit from './move_eval.json';
// @ts-ignore
import hasherCircuit from './hasher.json';

let backend: UltraHonkBackend | null = null;
let noir: Noir | null = null;
let hasherNoir: Noir | null = null;

async function getZK() {
    if (!backend || !noir) {
        backend = new UltraHonkBackend(moveEvalCircuit as any);
        noir = new Noir(moveEvalCircuit as any);
    }
    return { backend, noir };
}

async function getHasher() {
    if (!hasherNoir) {
        hasherNoir = new Noir(hasherCircuit as any);
    }
    return hasherNoir;
}

/**
 * Compute the Poseidon hash of the board configuration using the Hasher circuit.
 * @param boardConfig - Array of 10 snake positions (u8)
 * @param boardSalt - Random salt (Field/string)
 * @returns The computed hash as a hex string (32 bytes)
 */
export async function computeBoardHash(boardConfig: number[], boardSalt: string | number): Promise<string> {
    const noir = await getHasher();
    // The circuit takes { board_config: [u8; 10], board_salt: Field }
    const inputs = {
        board_config: boardConfig,
        board_salt: boardSalt
    };

    const { returnValue } = await noir.execute(inputs);

    // returnValue should be the Field hash. 
    // It is typically a hex string or a byte array.
    // If it's a hex string from noir_js, ensure it's padded to 32 bytes (64 hex chars).

    if (typeof returnValue === 'string') {
        let hex = returnValue.startsWith('0x') ? returnValue.slice(2) : returnValue;
        return hex.padStart(64, '0');
    } else if (returnValue instanceof Uint8Array) {
        return Buffer.from(returnValue).toString('hex').padStart(64, '0');
    }

    return String(returnValue);
}

/**
 * Generate an UltraHonk ZK proof for a move evaluation.
 *
 * @param inputs - The circuit inputs (snake_heads, snake_tails, etc.)
 * @returns ProofData containing the proof bytes and public inputs.
 */
export async function generateProof(inputs: Record<string, any>) {
    const { backend, noir } = await getZK();
    console.log('[ZK] Generating witness for inputs:', inputs);
    const { witness } = await noir.execute(inputs);
    console.log('[ZK] Witness generated, creating proof…');
    const proof = await backend.generateProof(witness);
    console.log('[ZK] Proof generated, size:', proof.proof.length, 'bytes');
    return proof;
}

/**
 * Verify an UltraHonk proof locally (for debugging).
 */
export async function verifyProof(proofData: { proof: Uint8Array; publicInputs: string[] }) {
    const { backend } = await getZK();
    return await backend.verifyProof(proofData);
}
