import fs from 'fs';

async function run() {
    const env = fs.readFileSync('../.env', 'utf8');
    const p1 = env.split('\n').find(l => l.startsWith('VITE_DEV_PLAYER1_ADDRESS=')).split('=')[1].trim();
    const p2 = env.split('\n').find(l => l.startsWith('VITE_DEV_PLAYER2_ADDRESS=')).split('=')[1].trim();
    
    console.log("Checking P1:", p1);
    const res1 = await fetch(`https://horizon-testnet.stellar.org/accounts/${p1}`);
    console.log("P1 status:", res1.status);

    console.log("Checking P2:", p2);
    const res2 = await fetch(`https://horizon-testnet.stellar.org/accounts/${p2}`);
    console.log("P2 status:", res2.status);
    if(res2.status === 404) {
        console.log("Funding P2 via friendbot...");
        const fb = await fetch(`https://friendbot.stellar.org/?addr=${p2}`);
        console.log("Friendbot result:", fb.status);
    }
}
run();
