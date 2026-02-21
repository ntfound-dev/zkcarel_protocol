use starknet::ContractAddress;

// Verifier interface for Garaga Groth16 BLS12-381 proofs.
#[starknet::interface]
pub trait IGroth16VerifierBlsOutput<TContractState> {
    // Verifies Groth16 BLS12-381 proof and returns optional public outputs.
    fn verify_groth16_proof_bls12_381(
        self: @TContractState, full_proof_with_hints: Span<felt252>,
    ) -> Option<Span<u256>>;
}

// Battleship game API with proof-gated actions.
#[starknet::interface]
pub trait IBattleshipGaraga<TContractState> {
    // Updates verifier contract used by proof checks (admin only).
    fn set_verifier(ref self: TContractState, verifier: ContractAddress);
    // Updates timeout window in blocks (admin only).
    fn set_timeout_blocks(ref self: TContractState, timeout_blocks: u64);

    // Creates a new battleship game and commits player A board hash.
    fn create_game(
        ref self: TContractState,
        opponent: ContractAddress,
        board_commitment: felt252,
        proof: Span<felt252>,
        public_inputs: Span<felt252>,
    ) -> u64;
    // Joins invited game and commits player B board hash.
    fn join_game(
        ref self: TContractState,
        game_id: u64,
        board_commitment: felt252,
        proof: Span<felt252>,
        public_inputs: Span<felt252>,
    );
    // Fires a shot for current turn and stores pending shot coordinates.
    fn fire_shot(ref self: TContractState, game_id: u64, x: u64, y: u64);
    // Resolves pending shot with proof-backed hit or miss response.
    fn respond_shot(
        ref self: TContractState,
        game_id: u64,
        is_hit: bool,
        proof: Span<felt252>,
        public_inputs: Span<felt252>,
    );
    // Declares sunk ship with proof-backed binding for current game state.
    fn declare_ship_sunk(
        ref self: TContractState,
        game_id: u64,
        ship_size: felt252,
        proof: Span<felt252>,
        public_inputs: Span<felt252>,
    );
    // Claims victory when opponent turn exceeds configured timeout.
    fn claim_timeout(ref self: TContractState, game_id: u64);

    // Returns compact game state snapshot for UI and indexers.
    fn get_game_state(
        self: @TContractState, game_id: u64,
    ) -> (u64, ContractAddress, ContractAddress, ContractAddress, ContractAddress, u64, u64, bool);
    // Returns current pending shot tuple (shooter, x, y).
    fn get_pending_shot(self: @TContractState, game_id: u64) -> (ContractAddress, u64, u64);
}

// Two-player battleship game with ZK-gated state transitions.
// Uses nullifiers and proof bindings to prevent replay and action forgery.
#[starknet::contract]
pub mod BattleshipGaraga {
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_number, get_caller_address};

    use super::{
        IBattleshipGaraga, IGroth16VerifierBlsOutputDispatcher,
        IGroth16VerifierBlsOutputDispatcherTrait,
    };

    const STATUS_WAITING: u64 = 0;
    const STATUS_PLAYING: u64 = 1;
    const STATUS_FINISHED: u64 = 2;
    const WIN_HITS: u64 = 9;
    const BOARD_SIZE: u64 = 5;
    const TAG_RESPONSE: felt252 = 'RESPONSE';
    const TAG_SUNK: felt252 = 'SUNK';

    #[storage]
    pub struct Storage {
        pub admin: ContractAddress,
        pub verifier: ContractAddress,
        pub timeout_blocks: u64,
        pub next_game_id: u64,

        pub nullifier_used: Map<felt252, bool>,

        pub player_a: Map<u64, ContractAddress>,
        pub player_b: Map<u64, ContractAddress>,
        pub status: Map<u64, u64>,
        pub turn: Map<u64, ContractAddress>,
        pub winner: Map<u64, ContractAddress>,
        pub board_commitment_a: Map<u64, felt252>,
        pub board_commitment_b: Map<u64, felt252>,
        pub hits_on_a: Map<u64, u64>,
        pub hits_on_b: Map<u64, u64>,
        pub last_action_block: Map<u64, u64>,

        pub pending_shooter: Map<u64, ContractAddress>,
        pub pending_shot_x: Map<u64, u64>,
        pub pending_shot_y: Map<u64, u64>,
        pub shot_used: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        GameCreated: GameCreated,
        GameJoined: GameJoined,
        BoardCommitted: BoardCommitted,
        ShotFired: ShotFired,
        ShotResult: ShotResult,
        ShipSunk: ShipSunk,
        GameOver: GameOver,
        TimeoutClaimed: TimeoutClaimed,
        VerifierUpdated: VerifierUpdated,
        TimeoutBlocksUpdated: TimeoutBlocksUpdated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct GameCreated {
        pub game_id: u64,
        pub player_a: ContractAddress,
        pub player_b: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct GameJoined {
        pub game_id: u64,
        pub player_b: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct BoardCommitted {
        pub game_id: u64,
        pub player: ContractAddress,
        pub commitment: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ShotFired {
        pub game_id: u64,
        pub shooter: ContractAddress,
        pub x: u64,
        pub y: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ShotResult {
        pub game_id: u64,
        pub x: u64,
        pub y: u64,
        pub is_hit: bool,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ShipSunk {
        pub game_id: u64,
        pub player: ContractAddress,
        pub ship_size: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct GameOver {
        pub game_id: u64,
        pub winner: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct TimeoutClaimed {
        pub game_id: u64,
        pub winner: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct VerifierUpdated {
        pub verifier: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct TimeoutBlocksUpdated {
        pub timeout_blocks: u64,
    }

    // Initializes admin, verifier dependency, and timeout window.
    #[constructor]
    fn constructor(
        ref self: ContractState, admin: ContractAddress, verifier: ContractAddress, timeout_blocks: u64,
    ) {
        assert!(!admin.is_zero(), "Admin required");
        self.admin.write(admin);
        self.verifier.write(verifier);
        self.timeout_blocks.write(timeout_blocks);
        self.next_game_id.write(0);
    }

    #[abi(embed_v0)]
    impl BattleshipGaragaImpl of IBattleshipGaraga<ContractState> {
        // Updates verifier contract used by proof checks (admin only).
        fn set_verifier(ref self: ContractState, verifier: ContractAddress) {
            self._assert_admin();
            assert!(!verifier.is_zero(), "Verifier required");
            self.verifier.write(verifier);
            self.emit(Event::VerifierUpdated(VerifierUpdated { verifier }));
        }

        // Updates timeout window in blocks (admin only).
        fn set_timeout_blocks(ref self: ContractState, timeout_blocks: u64) {
            self._assert_admin();
            assert!(timeout_blocks > 0, "timeout_blocks > 0");
            self.timeout_blocks.write(timeout_blocks);
            self.emit(Event::TimeoutBlocksUpdated(TimeoutBlocksUpdated { timeout_blocks }));
        }

        // Creates a new battleship game and commits player A board hash.
        fn create_game(
            ref self: ContractState,
            opponent: ContractAddress,
            board_commitment: felt252,
            proof: Span<felt252>,
            public_inputs: Span<felt252>,
        ) -> u64 {
            let caller = get_caller_address();
            assert!(!opponent.is_zero(), "Opponent required");
            assert!(caller != opponent, "Cannot play yourself");

            self._verify_action_proof(board_commitment, proof, public_inputs);

            let game_id = self.next_game_id.read() + 1;
            self.next_game_id.write(game_id);

            self.player_a.write(game_id, caller);
            self.player_b.write(game_id, opponent);
            self.status.write(game_id, STATUS_WAITING);
            self.turn.write(game_id, caller);
            self.winner.write(game_id, Zero::zero());
            self.board_commitment_a.write(game_id, board_commitment);
            self.board_commitment_b.write(game_id, 0);
            self.hits_on_a.write(game_id, 0);
            self.hits_on_b.write(game_id, 0);
            self.pending_shooter.write(game_id, Zero::zero());
            self.pending_shot_x.write(game_id, 0);
            self.pending_shot_y.write(game_id, 0);
            self.last_action_block.write(game_id, get_block_number());

            self.emit(Event::GameCreated(GameCreated { game_id, player_a: caller, player_b: opponent }));
            self.emit(
                Event::BoardCommitted(
                    BoardCommitted { game_id, player: caller, commitment: board_commitment },
                ),
            );
            game_id
        }

        // Joins invited game and commits player B board hash.
        fn join_game(
            ref self: ContractState,
            game_id: u64,
            board_commitment: felt252,
            proof: Span<felt252>,
            public_inputs: Span<felt252>,
        ) {
            let caller = get_caller_address();
            self._assert_game_exists(game_id);
            assert!(self.status.read(game_id) == STATUS_WAITING, "Game not joinable");
            assert!(self.player_b.read(game_id) == caller, "Only invited opponent");

            self._verify_action_proof(board_commitment, proof, public_inputs);

            self.board_commitment_b.write(game_id, board_commitment);
            self.status.write(game_id, STATUS_PLAYING);
            self.turn.write(game_id, self.player_a.read(game_id));
            self.last_action_block.write(game_id, get_block_number());

            self.emit(Event::GameJoined(GameJoined { game_id, player_b: caller }));
            self.emit(
                Event::BoardCommitted(
                    BoardCommitted { game_id, player: caller, commitment: board_commitment },
                ),
            );
        }

        // Fires a shot for current turn and stores pending shot coordinates.
        fn fire_shot(ref self: ContractState, game_id: u64, x: u64, y: u64) {
            let caller = get_caller_address();
            self._assert_game_playing(game_id);
            self._assert_participant(game_id, caller);
            assert!(self.turn.read(game_id) == caller, "Not your turn");
            assert!(x < BOARD_SIZE && y < BOARD_SIZE, "Shot out of bounds");

            let pending = self.pending_shooter.read(game_id);
            assert!(pending.is_zero(), "Pending shot not resolved");

            let shot_key = self._shot_key(game_id, caller, x, y);
            assert!(!self.shot_used.read(shot_key), "Shot already used");
            self.shot_used.write(shot_key, true);

            self.pending_shooter.write(game_id, caller);
            self.pending_shot_x.write(game_id, x);
            self.pending_shot_y.write(game_id, y);
            self.last_action_block.write(game_id, get_block_number());

            self.emit(Event::ShotFired(ShotFired { game_id, shooter: caller, x, y }));
        }

        // Resolves pending shot with proof-backed hit or miss response.
        fn respond_shot(
            ref self: ContractState,
            game_id: u64,
            is_hit: bool,
            proof: Span<felt252>,
            public_inputs: Span<felt252>,
        ) {
            let caller = get_caller_address();
            self._assert_game_playing(game_id);
            self._assert_participant(game_id, caller);

            let shooter = self.pending_shooter.read(game_id);
            assert!(!shooter.is_zero(), "No pending shot");
            assert!(caller != shooter, "Shooter cannot respond");

            let x = self.pending_shot_x.read(game_id);
            let y = self.pending_shot_y.read(game_id);
            let binding = self._response_binding(game_id, shooter, caller, x, y, is_hit);
            self._verify_action_proof(binding, proof, public_inputs);

            if is_hit {
                if caller == self.player_a.read(game_id) {
                    let next = self.hits_on_a.read(game_id) + 1;
                    self.hits_on_a.write(game_id, next);
                } else {
                    let next = self.hits_on_b.read(game_id) + 1;
                    self.hits_on_b.write(game_id, next);
                }
            }

            self.emit(Event::ShotResult(ShotResult { game_id, x, y, is_hit }));

            self.pending_shooter.write(game_id, Zero::zero());
            self.pending_shot_x.write(game_id, 0);
            self.pending_shot_y.write(game_id, 0);

            let hits_on_a = self.hits_on_a.read(game_id);
            let hits_on_b = self.hits_on_b.read(game_id);
            if hits_on_a >= WIN_HITS {
                let winner = self.player_b.read(game_id);
                self.status.write(game_id, STATUS_FINISHED);
                self.winner.write(game_id, winner);
                self.turn.write(game_id, Zero::zero());
                self.emit(Event::GameOver(GameOver { game_id, winner }));
            } else if hits_on_b >= WIN_HITS {
                let winner = self.player_a.read(game_id);
                self.status.write(game_id, STATUS_FINISHED);
                self.winner.write(game_id, winner);
                self.turn.write(game_id, Zero::zero());
                self.emit(Event::GameOver(GameOver { game_id, winner }));
            } else {
                self.turn.write(game_id, caller);
            }

            self.last_action_block.write(game_id, get_block_number());
        }

        // Declares sunk ship with proof-backed binding for current game state.
        fn declare_ship_sunk(
            ref self: ContractState,
            game_id: u64,
            ship_size: felt252,
            proof: Span<felt252>,
            public_inputs: Span<felt252>,
        ) {
            let caller = get_caller_address();
            self._assert_game_playing(game_id);
            self._assert_participant(game_id, caller);

            let binding = self._sunk_binding(game_id, caller, ship_size);
            self._verify_action_proof(binding, proof, public_inputs);

            self.emit(Event::ShipSunk(ShipSunk { game_id, player: caller, ship_size }));
            self.last_action_block.write(game_id, get_block_number());
        }

        // Claims victory when opponent turn exceeds configured timeout.
        fn claim_timeout(ref self: ContractState, game_id: u64) {
            let caller = get_caller_address();
            self._assert_game_playing(game_id);
            self._assert_participant(game_id, caller);

            let turn = self.turn.read(game_id);
            assert!(!turn.is_zero(), "No active turn");
            assert!(caller != turn, "Cannot claim own timeout");

            let current_block = get_block_number();
            let last_block = self.last_action_block.read(game_id);
            let timeout = self.timeout_blocks.read();
            assert!(current_block > last_block + timeout, "Timeout not reached");

            self.status.write(game_id, STATUS_FINISHED);
            self.winner.write(game_id, caller);
            self.turn.write(game_id, Zero::zero());
            self.pending_shooter.write(game_id, Zero::zero());
            self.pending_shot_x.write(game_id, 0);
            self.pending_shot_y.write(game_id, 0);
            self.last_action_block.write(game_id, current_block);

            self.emit(Event::TimeoutClaimed(TimeoutClaimed { game_id, winner: caller }));
            self.emit(Event::GameOver(GameOver { game_id, winner: caller }));
        }

        // Returns compact game state snapshot for UI and indexers.
        fn get_game_state(
            self: @ContractState, game_id: u64,
        ) -> (u64, ContractAddress, ContractAddress, ContractAddress, ContractAddress, u64, u64, bool) {
            let pending = !self.pending_shooter.read(game_id).is_zero();
            (
                self.status.read(game_id),
                self.player_a.read(game_id),
                self.player_b.read(game_id),
                self.turn.read(game_id),
                self.winner.read(game_id),
                self.hits_on_a.read(game_id),
                self.hits_on_b.read(game_id),
                pending,
            )
        }

        // Returns current pending shot tuple (shooter, x, y).
        fn get_pending_shot(self: @ContractState, game_id: u64) -> (ContractAddress, u64, u64) {
            (
                self.pending_shooter.read(game_id),
                self.pending_shot_x.read(game_id),
                self.pending_shot_y.read(game_id),
            )
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        // Asserts caller is contract admin.
        fn _assert_admin(self: @ContractState) {
            assert!(get_caller_address() == self.admin.read(), "Only admin");
        }

        // Asserts game id exists in storage.
        fn _assert_game_exists(self: @ContractState, game_id: u64) {
            assert!(!self.player_a.read(game_id).is_zero(), "Game not found");
        }

        // Asserts game is in playing status.
        fn _assert_game_playing(self: @ContractState, game_id: u64) {
            self._assert_game_exists(game_id);
            assert!(self.status.read(game_id) == STATUS_PLAYING, "Game not playing");
        }

        // Asserts caller belongs to game participants.
        fn _assert_participant(self: @ContractState, game_id: u64, caller: ContractAddress) {
            let a = self.player_a.read(game_id);
            let b = self.player_b.read(game_id);
            assert!(caller == a || caller == b, "Not game participant");
        }

        // Verifies action proof and enforces nullifier/binding consistency.
        // Expects `public_inputs[0] = nullifier` and `public_inputs[1] = binding`.
        fn _verify_action_proof(
            ref self: ContractState,
            expected_binding: felt252,
            proof: Span<felt252>,
            public_inputs: Span<felt252>,
        ) {
            assert!(public_inputs.len() >= 2, "public_inputs too short");
            let nullifier = *public_inputs.at(0_usize);
            let binding = *public_inputs.at(1_usize);
            assert!(binding == expected_binding, "binding mismatch");
            assert!(!self.nullifier_used.read(nullifier), "Nullifier already used");

            let verifier = self.verifier.read();
            assert!(!verifier.is_zero(), "Verifier not set");
            let dispatcher = IGroth16VerifierBlsOutputDispatcher { contract_address: verifier };
            let verification = dispatcher.verify_groth16_proof_bls12_381(proof);
            match verification {
                Option::Some(_outputs) => {},
                Option::None => panic!("Invalid proof"),
            };

            self.nullifier_used.write(nullifier, true);
        }

        // Builds deterministic key for shot uniqueness tracking.
        fn _shot_key(
            self: @ContractState, game_id: u64, shooter: ContractAddress, x: u64, y: u64,
        ) -> felt252 {
            let mut data: Array<felt252> = array![];
            let game_felt: felt252 = game_id.into();
            let shooter_felt: felt252 = shooter.into();
            let x_felt: felt252 = x.into();
            let y_felt: felt252 = y.into();
            data.append(game_felt);
            data.append(shooter_felt);
            data.append(x_felt);
            data.append(y_felt);
            poseidon_hash_span(data.span())
        }

        // Builds response binding hash for hit/miss proof checks.
        fn _response_binding(
            self: @ContractState,
            game_id: u64,
            shooter: ContractAddress,
            responder: ContractAddress,
            x: u64,
            y: u64,
            is_hit: bool,
        ) -> felt252 {
            let mut data: Array<felt252> = array![];
            let game_felt: felt252 = game_id.into();
            let shooter_felt: felt252 = shooter.into();
            let responder_felt: felt252 = responder.into();
            let x_felt: felt252 = x.into();
            let y_felt: felt252 = y.into();
            data.append(TAG_RESPONSE);
            data.append(game_felt);
            data.append(shooter_felt);
            data.append(responder_felt);
            data.append(x_felt);
            data.append(y_felt);
            data.append(if is_hit { 1 } else { 0 });
            poseidon_hash_span(data.span())
        }

        // Builds sunk-ship binding hash for proof checks.
        fn _sunk_binding(
            self: @ContractState, game_id: u64, player: ContractAddress, ship_size: felt252,
        ) -> felt252 {
            let mut data: Array<felt252> = array![];
            let game_felt: felt252 = game_id.into();
            let player_felt: felt252 = player.into();
            data.append(TAG_SUNK);
            data.append(game_felt);
            data.append(player_felt);
            data.append(ship_size);
            poseidon_hash_span(data.span())
        }
    }

    // Converts u256 into felt252 with high/low composition.
    fn _u256_to_felt(value: u256) -> felt252 {
        const TWO_POW_128: felt252 = 0x100000000000000000000000000000000;
        let low_felt: felt252 = value.low.into();
        let high_felt: felt252 = value.high.into();
        high_felt * TWO_POW_128 + low_felt
    }
}
