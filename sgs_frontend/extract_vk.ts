import { UltraHonkBackend } from '@noir-lang/backend_barretenberg';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

async function extractVk() {
    console.log("Extracting VK from compiled circuit...");
    const circuitPath = join(__dirname, 'src', 'circuits', 'move_eval.json');
    const circuitJson = JSON.parse(readFileSync(circuitPath, 'utf-8'));

    // Instantiate backend to get the VK
    const backend = new UltraHonkBackend(circuitJson);
    const vkBytes = await backend.getVerificationKey();

    const outPath = join(__dirname, '../circuits', 'target', 'vk.bin');
    writeFileSync(outPath, Buffer.from(vkBytes));
    console.log("Successfully wrote VK to", outPath);
}

extractVk().catch(console.error);
