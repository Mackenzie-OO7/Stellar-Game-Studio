import { computeBoardHash, generateProof } from './src/circuits/proofs';

async function run() {
    try {
        console.log("Setting up board...");
        const snakeHeadsArray = [10, 15, 20, 25, 30, 0, 0, 0, 0, 0];
        const salt = 123456;
        
        const oldHashStr = await computeBoardHash(snakeHeadsArray, salt);
        console.log("Old Hash:", oldHashStr);

        // Safe move
        const currentPos = 0;
        const moveAmount = 5;
        const dest = 5;
        const isSnake = false;

        const inputs = {
            old_root: '0x' + oldHashStr,
            new_root: '0x' + oldHashStr,
            current_pos: currentPos,
            roll: moveAmount,
            claimed_dest: dest,
            is_snake_hit: isSnake,
            board_config: snakeHeadsArray,
            board_salt: salt,
            new_snake_pos: 0,
            new_salt: salt
        };

        console.log("Generating proof for safe move...", inputs);
        await generateProof(inputs);
        console.log("Safe move proof successful!");

        // Snake hit logic
        const snakeInputs = {
            old_root: '0x' + oldHashStr,
            // we will need to simulate a new root.
            new_root: '0x' + oldHashStr,
            current_pos: 5,
            roll: 5,
            claimed_dest: 4,
            is_snake_hit: true,
            board_config: snakeHeadsArray,
            board_salt: salt,
            new_snake_pos: 20,
            new_salt: 99999
        };

        // Recompute reshuffle hash
        const newSnakeHeadsArray = [...snakeHeadsArray];
        newSnakeHeadsArray[newSnakeHeadsArray.indexOf(10)] = 20;
        snakeInputs.new_root = '0x' + await computeBoardHash(newSnakeHeadsArray, snakeInputs.new_salt);

        console.log("Generating proof for snake hit...");
        await generateProof(snakeInputs);
        console.log("Snake hit proof successful!");


    } catch (e) {
        console.error("FAIL:", e);
    }
}
run();
