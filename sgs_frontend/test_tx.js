import fs from 'fs';
import { rpc, TransactionBuilder, Networks, Keypair } from '@stellar/stellar-sdk';
import { Client } from './bindings/snake_ladders/dist/index.js'; // Use generated bindings

async function run() {
    const env = fs.readFileSync('../.env', 'utf8');
    const p1Secret = env.split('\n').find(l => l.startsWith('VITE_DEV_PLAYER1_SECRET=')).split('=')[1].trim();
    const p2Address = env.split('\n').find(l => l.startsWith('VITE_DEV_PLAYER2_ADDRESS=')).split('=')[1].trim();
    const contractId = env.split('\n').find(l => l.startsWith('VITE_SNAKE_LADDERS_CONTRACT_ID=')).split('=')[1].trim();

    const kp = Keypair.fromSecret(p1Secret);
    const client = new Client({
        contractId,
        networkPassphrase: Networks.TESTNET,
        rpcUrl: 'https://soroban-testnet.stellar.org',
        publicKey: kp.publicKey(),
        signTransaction: async (tx) => {
            const builder = TransactionBuilder.fromXDR(tx, Networks.TESTNET);
            builder.sign(kp);
            return builder.toXDR();
        }
    });

    console.log("Simulating create_game for contract:", contractId);
    
    // Quickstart mock payload
    const tx = await client.create_game({
        session_id: Math.floor(Math.random() * 100000),
        player1: kp.publicKey(),
        player2: p2Address,
        player1_points: 100n,
        player2_points: 100n,
        snake_count: 6
    });

    console.log("Simulation complete. is built:", !!tx.built);
    
    try {
        const result = await tx.simulate();
        console.log("Simulate() success!");
        console.log("cost:", result.simulationResult?.transactionData?.build().toXDR('base64'));
        
        try {
            const sent = await result.signAndSend();
            console.log("Sent success!");
        } catch (e) {
            console.error("signAndSend error:", e.name, e.message);
        }
    } catch (e) {
        console.error("simulate error:", e);
    }
}

run().catch(console.error);
