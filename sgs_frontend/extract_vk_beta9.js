import { UltraHonkBackend } from '@noir-lang/backend_barretenberg';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

async function run() {
    console.log("Extracting VK from compiled circuit...");
    const circuitPath = resolve('../circuits/move_eval/target/move_eval.json');
    const circuitJson = JSON.parse(readFileSync(circuitPath, 'utf8'));

    const backend = new UltraHonkBackend(circuitJson);
    const vkBytes = await backend.getVerificationKey();
    
    writeFileSync('../circuits/move_eval/target/vk', Buffer.from(vkBytes));
    console.log("VK extracted and saved to circuits/move_eval/target/vk!");
    process.exit(0);
}

run().catch(console.error);
