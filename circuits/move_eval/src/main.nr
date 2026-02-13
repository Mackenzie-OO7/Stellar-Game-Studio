use dep::poseidon::poseidon2::Poseidon2;

fn main(
    // Public Inputs
    old_root: pub Field,
    new_root: pub Field,
    current_pos: pub u8,
    roll: pub u8,
    claimed_dest: pub u8,
    is_snake_hit: pub bool,
    
    // Private Inputs
    board_config: [u8; 10], // Locations of 10 snakes
    board_salt: Field,
    new_snake_pos: u8,
    new_salt: Field
) {
    // 1. Verify Old Board Commitment
    // We use BN254 Poseidon2
    let mut board_fields = [0 as Field; 10];
    for i in 0..10 {
        board_fields[i] = board_config[i] as Field;
    }

    // Hash the board config (array of 10)
    // Poseidon2::hash takes ([Field; N], N)? No, it takes field array.
    // The tornado example used: Poseidon2::hash([a, b], 2)
    // But [a, b] is slice? Or array?
    // Let's assume it takes slice or array.
    // We'll revert to chaining hash_2 for safety if hash_N isn't obvious.
    // Is there a hash_2 utility? Tornado example defined `fn hash2(a, b) { Poseidon2::hash([a, b], 2) }`.
    // It seems `Poseidon2::hash` is the main entry.
    // Let's define a helper.
    
    let mut current_hash = board_fields[0];
    for i in 1..10 {
        // Hash current + next. 
        // Note: Poseidon2::hash returns Field.
        // We pass [Field; 2] and logic 2? Or just [Field].
        // Let's trust the reference: Poseidon2::hash([a, b], 2) implies dynamic length or explicit?
        // Actually, if it takes a slice `[Field]`, then `[a, b]` works.
        current_hash = Poseidon2::hash([current_hash, board_fields[i]], 2);
    }
    let config_hash = current_hash;

    let computed_old_root = Poseidon2::hash([config_hash, board_salt], 2);
    assert(computed_old_root == old_root);

    // 2. Calculate Landing Spot
    let mut landing_spot = current_pos + roll;
    if landing_spot > 100 {
        landing_spot = 100 - (landing_spot - 100);
    }

    // 3. Snake Detection Logic
    let mut actual_hit = false;
    for i in 0..10 {
        if board_config[i] == landing_spot {
            actual_hit = true;
        }
    }

    // 4. Enforce Outcome Consistency
    if is_snake_hit {
        // CASE: SNAKE HIT
        assert(actual_hit == true);
        assert(claimed_dest < landing_spot);

        // Verify Reshuffle
        let mut new_config = board_config;
        let mut snake_found = false;
        let mut target_free = true;
        
        for i in 0..10 {
            if new_config[i] == landing_spot {
                if !snake_found {
                    new_config[i] = new_snake_pos;
                    snake_found = true;
                }
            }
            if board_config[i] == new_snake_pos {
                target_free = false;
            }
        }
        assert(snake_found);
        assert(target_free);

        // Verify New Commitment
        let mut new_board_fields = [0 as Field; 10];
        for i in 0..10 {
            new_board_fields[i] = new_config[i] as Field;
        }
        
        let mut new_current_hash = new_board_fields[0];
        for i in 1..10 {
             new_current_hash = Poseidon2::hash([new_current_hash, new_board_fields[i]], 2);
        }
        let new_config_hash = new_current_hash;

        let computed_new_root = Poseidon2::hash([new_config_hash, new_salt], 2);
        assert(computed_new_root == new_root);

    } else {
        // CASE: SAFE MOVE
        assert(actual_hit == false);
        assert(claimed_dest == landing_spot);
        
        // Board must not change
        assert(new_root == old_root);
    }
}

#[test]
fn test_valid_safe_move() {
    // Setup: Snake at 50. Start at 0. Roll 5. Land 5. Safe.
    let board_config = [50, 99, 98, 97, 96, 95, 94, 93, 92, 91];
    let board_salt = 123;
    
    // Calc old root
    let mut board_fields = [0 as Field; 10];
    for i in 0..10 { board_fields[i] = board_config[i] as Field; }
    let mut h = board_fields[0];
    for i in 1..10 { h = Poseidon2::hash([h, board_fields[i]], 2); }
    let old_root = Poseidon2::hash([h, board_salt], 2);
    
    // Move
    let current_pos = 0;
    let roll = 5;
    let claimed_dest = 5;
    let is_snake_hit = false;
    
    // No reshuffle needed
    let new_snake_pos = 0; 
    let new_salt = 0;
    let new_root = old_root; // Must match old
    
    main(old_root, new_root, current_pos, roll, claimed_dest, is_snake_hit, board_config, board_salt, new_snake_pos, new_salt);
}

#[test]
fn test_valid_snake_hit() {
    // Setup: Snake at 10. Start 5. Roll 5. Land 10 -> Snake!
    let board_config = [10, 99, 98, 97, 96, 95, 94, 93, 92, 91];
    let board_salt = 123;
    
    // Calc old root
    let mut board_fields = [0 as Field; 10];
    for i in 0..10 { board_fields[i] = board_config[i] as Field; }
    let mut h = board_fields[0];
    for i in 1..10 { h = Poseidon2::hash([h, board_fields[i]], 2); }
    let old_root = Poseidon2::hash([h, board_salt], 2);
    
    // Move
    let current_pos = 5;
    let roll = 5;
    let landing = 10;
    let claimed_dest = 4; // Penalty
    let is_snake_hit = true;
    
    // Reshuffle: Move snake from 10 to 20
    let new_snake_pos = 20;
    let new_salt = 456;
    let new_config = [20, 99, 98, 97, 96, 95, 94, 93, 92, 91];
    
    // Calc new root
    let mut new_fields = [0 as Field; 10];
    for i in 0..10 { new_fields[i] = new_config[i] as Field; }
    let mut h2 = new_fields[0];
    for i in 1..10 { h2 = Poseidon2::hash([h2, new_fields[i]], 2); }
    let new_root = Poseidon2::hash([h2, new_salt], 2);
    
    main(old_root, new_root, current_pos, roll, claimed_dest, is_snake_hit, board_config, board_salt, new_snake_pos, new_salt);
}

#[test(should_fail)]
fn test_fail_ignore_snake() {
    // Setup: Snake at 10. Start 5. Roll 5. Land 10.
    // CHEAT: Claim safe move to 10
    let board_config = [10, 99, 98, 97, 96, 95, 94, 93, 92, 91];
    let board_salt = 123;
    
    // Calc old root
    let mut board_fields = [0 as Field; 10];
    for i in 0..10 { board_fields[i] = board_config[i] as Field; }
    let mut h = board_fields[0];
    for i in 1..10 { h = Poseidon2::hash([h, board_fields[i]], 2); }
    let old_root = Poseidon2::hash([h, board_salt], 2);
    
    let current_pos = 5;
    let roll = 5;
    let claimed_dest = 10;
    let is_snake_hit = false; // LIAR!
    
    let new_root = old_root;
    
    main(old_root, new_root, current_pos, roll, claimed_dest, is_snake_hit, board_config, board_salt, 0, 0);
}
