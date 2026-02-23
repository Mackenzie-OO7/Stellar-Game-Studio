import { SnakeLaddersClient } from './bindings/snake_ladders/src/index.js';
import { Networks } from '@stellar/stellar-sdk';
import { config } from 'dotenv';
config();

async function run() {
    const client = new SnakeLaddersClient({
        contractId: process.env.VITE_SNAKE_LADDERS_ID!,
        networkPassphrase: 'Test SDF Network ; September 2015',
        rpcUrl: process.env.VITE_STELLAR_RPC_URL!,
        publicKey: 'GBDUX2JHV3YDUJ5M533PQRWFRZUSV3XPMI4P6YFXVUSQCY4A74I6IEMF', // Dummy
    });

    try {
        const tx = await client.create_game({
            session_id: 1234,
            player1: 'GBDUX2JHV3YDUJ5M533PQRWFRZUSV3XPMI4P6YFXVUSQCY4A74I6IEMF',
            player2: 'GCTUEMHKZIU45QDXNNJWYW7BWWRTH5U24BGGQXQ6H2LDW2JHEWTLXMYE', // Assuming this is player 2
            player1_points: 500000n,
            player2_points: 500000n,
            snake_count: 6,
        });
        console.log("SimTx Result:", tx.result);
        console.log("Simulated successfully!");
    } catch (e: any) {
        console.error("Simulation failed:", e.message);
        if (e.response && e.response.data) {
           console.error("Response:", JSON.stringify(e.response.data, null, 2));
        }
    }
}
run();
