use dep::poseidon::poseidon2::Poseidon2;

// Helper to compute board commitment hash for Prover.toml
fn main(board_config: [u8; 10], board_salt: Field) -> pub Field {
    let mut board_fields = [0 as Field; 10];
    for i in 0..10 {
        board_fields[i] = board_config[i] as Field;
    }
    let mut current_hash = board_fields[0];
    for i in 1..10 {
        current_hash = Poseidon2::hash([current_hash, board_fields[i]], 2);
    }
    Poseidon2::hash([current_hash, board_salt], 2)
}
