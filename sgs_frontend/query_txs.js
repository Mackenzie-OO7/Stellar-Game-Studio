import fs from 'fs';

async function run() {
    const env = fs.readFileSync('../.env', 'utf8');
    const p1Line = env.split('\n').find(l => l.startsWith('VITE_DEV_PLAYER1_ADDRESS='));
    const p1 = p1Line.split('=')[1].trim();

    console.log("Querying transactions for P1:", p1);
    
    const horizonUrl = 'https://horizon-testnet.stellar.org';
    const res = await fetch(`${horizonUrl}/accounts/${p1}/transactions?order=desc&limit=5`);
    const data = await res.json();
    
    if (data._embedded && data._embedded.records) {
        data._embedded.records.forEach(t => {
            console.log(`Hash: ${t.hash}, Date: ${t.created_at}, Successful: ${t.successful}`);
        });
    } else {
        console.log("No transactions found or error:", data);
    }
}

run().catch(console.error);
