use starknet::ContractAddress;

#[derive(Copy, Drop, Serde, starknet::Store)]
pub enum LeaderboardType {
    #[default]
    Points,
    Volume,
    Referrals,
}

impl LeaderboardTypeIntoFelt252 of Into<LeaderboardType, felt252> {
    // Converts leaderboard score value into felt252 representation.
    fn into(self: LeaderboardType) -> felt252 {
        match self {
            LeaderboardType::Points => 0,
            LeaderboardType::Volume => 1,
            LeaderboardType::Referrals => 2,
        }
    }
}

#[derive(Clone, Drop, Serde, starknet::Store)]
pub struct LeaderboardEntry {
    pub rank: u256,
    pub user: ContractAddress,
    pub value: u256,
    pub username: ByteArray,
}

// Leaderboard API for reading ranked entries and posting backend snapshots.
// Provides read-optimized views for UI and reward distribution flows.
#[starknet::interface]
pub trait ILeaderboardView<TContractState> {
    // Returns full leaderboard entries up to configured max size.
    fn get_leaderboard(
        self: @TContractState, 
        epoch: u64, 
        leaderboard_type: LeaderboardType, 
        top_n: u64
    ) -> Array<LeaderboardEntry>;
    // Returns paginated leaderboard slice for UI consumption.
    fn get_leaderboard_page(
        self: @TContractState,
        epoch: u64,
        leaderboard_type: LeaderboardType,
        start: u64,
        limit: u64
    ) -> Array<LeaderboardEntry>;
    
    // Returns cached user rank and score entry, if present.
    fn get_user_rank(
        self: @TContractState, 
        epoch: u64, 
        leaderboard_type: LeaderboardType, 
        user: ContractAddress
    ) -> u256;
    
    // Replaces leaderboard snapshot for the provided epoch and type.
    fn update_leaderboard(
        ref self: TContractState, 
        epoch: u64, 
        leaderboard_type: LeaderboardType, 
        data: Array<LeaderboardEntry>
    );
    
    // Returns current leaderboard entry count.
    fn get_leaderboard_size(
        self: @TContractState,
        epoch: u64,
        leaderboard_type: LeaderboardType
    ) -> u64;
    
    // Returns backend signer address used for updates.
    fn get_backend_address(self: @TContractState) -> ContractAddress;
    // Returns contract owner address.
    fn get_owner(self: @TContractState) -> ContractAddress;
    // Updates backend signer address used for leaderboard writes (owner only).
    fn set_backend_address(ref self: TContractState, new_backend: ContractAddress);
    
    // Pauses leaderboard mutating operations.
    fn pause(ref self: TContractState);
    // Resumes leaderboard mutating operations.
    fn unpause(ref self: TContractState);
    // Returns whether the contract is currently paused.
    fn is_paused(self: @TContractState) -> bool;
    // Updates maximum entries allowed per leaderboard update (owner only).
    fn set_max_entries(ref self: TContractState, max: u64);
    // Returns configured maximum leaderboard size.
    fn get_max_entries(self: @TContractState) -> u64;
    // Updates minimum seconds between leaderboard updates (owner only).
    fn set_update_cooldown(ref self: TContractState, seconds: u64);
}

// Hide Mode hooks for private leaderboard updates.
#[starknet::interface]
pub trait ILeaderboardViewPrivacy<TContractState> {
    // Sets privacy router used for Hide Mode actions.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    // Forwards private leaderboard payload to privacy router.
    fn submit_private_leaderboard_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

// Stores epoch leaderboard snapshots used by rewards and analytics.
// Uses user-rank cache for O(1) rank lookups.
#[starknet::contract]
pub mod LeaderboardView {
    use starknet::ContractAddress;
    use starknet::storage::{
        Map, StoragePointerReadAccess, StoragePointerWriteAccess,
        StorageMapReadAccess, StorageMapWriteAccess
    };
    use starknet::{get_caller_address, get_block_timestamp};
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_LEADER;
    use super::{LeaderboardEntry, LeaderboardType, ILeaderboardView, LeaderboardTypeIntoFelt252};

    #[storage]
    struct Storage {
        // Poseidon-keyed leaderboard entries by epoch/type/index.
        leaderboard_entries: Map<felt252, LeaderboardEntry>,
        leaderboard_size: Map<felt252, u64>,
        
        // O(1) user rank cache for fast lookup.
        user_rank_cache: Map<felt252, u256>,
        
        // Authorized actors and privacy router wiring.
        backend_address: ContractAddress,
        owner: ContractAddress,
        privacy_router: ContractAddress,
        
        // Operational safety configuration.
        paused: bool,
        max_entries_per_update: u64,
        update_cooldown: u64,
        last_update_timestamp: Map<felt252, u64>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        LeaderboardUpdated: LeaderboardUpdated,
        BackendAddressUpdated: BackendAddressUpdated,
        ContractPaused: ContractPaused,
        ContractUnpaused: ContractUnpaused,
        MaxEntriesUpdated: MaxEntriesUpdated,
        UpdateCooldownChanged: UpdateCooldownChanged,
    }

    #[derive(Drop, starknet::Event)]
    pub struct LeaderboardUpdated {
        pub epoch: u64,
        pub leaderboard_type: LeaderboardType,
        pub entries_count: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct BackendAddressUpdated {
        pub old_backend: ContractAddress,
        pub new_backend: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ContractPaused {
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ContractUnpaused {
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MaxEntriesUpdated {
        pub old_max: u64,
        pub new_max: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct UpdateCooldownChanged {
        pub old_cooldown: u64,
        pub new_cooldown: u64,
    }

    // Computes storage key for leaderboard entry by rank.
    fn compute_entry_key(epoch: u64, leaderboard_type: LeaderboardType, index: u64) -> felt252 {
        let type_felt: felt252 = leaderboard_type.into();
        let mut data = array![epoch.into(), type_felt, index.into()];
        poseidon_hash_span(data.span())
    }

    // Computes storage key for leaderboard size value.
    fn compute_size_key(epoch: u64, leaderboard_type: LeaderboardType) -> felt252 {
        let type_felt: felt252 = leaderboard_type.into();
        let mut data = array![epoch.into(), type_felt];
        poseidon_hash_span(data.span())
    }

    // Computes storage key for user-to-rank mapping.
    fn compute_user_rank_key(
        epoch: u64, 
        leaderboard_type: LeaderboardType, 
        user: ContractAddress
    ) -> felt252 {
        let type_felt: felt252 = leaderboard_type.into();
        let user_felt: felt252 = user.into();
        let mut data = array![epoch.into(), type_felt, user_felt];
        poseidon_hash_span(data.span())
    }

    // Computes storage key for last leaderboard update timestamp.
    fn compute_update_timestamp_key(epoch: u64, leaderboard_type: LeaderboardType) -> felt252 {
        compute_size_key(epoch, leaderboard_type)
    }

    // Initializes the leaderboard view contract.
    // Sets owner and backend signer plus safe operational defaults.
    // `owner_address` controls config updates and `backend_signer` is allowed to post snapshots.
    #[constructor]
    fn constructor(
        ref self: ContractState, 
        owner_address: ContractAddress, 
        backend_signer: ContractAddress
    ) {
        assert!(!owner_address.is_zero(), "Owner cannot be zero address");
        assert!(!backend_signer.is_zero(), "Backend cannot be zero address");
        
        self.owner.write(owner_address);
        self.backend_address.write(backend_signer);
        
        // Conservative defaults for update safety and throughput.
        self.paused.write(false);
        self.max_entries_per_update.write(1000);
        self.update_cooldown.write(300);
    }

    #[abi(embed_v0)]
    impl LeaderboardViewImpl of ILeaderboardView<ContractState> {
        // Returns full leaderboard entries up to configured max size.
        fn get_leaderboard(
            self: @ContractState, 
            epoch: u64, 
            leaderboard_type: LeaderboardType, 
            top_n: u64
        ) -> Array<LeaderboardEntry> {
            let mut result = array![];
            let size_key = compute_size_key(epoch, leaderboard_type);
            let total_size = self.leaderboard_size.read(size_key);
            
            let mut i: u64 = 0;
            let max_read = self.max_entries_per_update.read();
            let mut limit = if top_n < total_size { top_n } else { total_size };
            if limit > max_read {
                limit = max_read;
            }
            
            while i < limit {
                let entry_key = compute_entry_key(epoch, leaderboard_type, i);
                let entry = self.leaderboard_entries.read(entry_key);
                result.append(entry);
                i += 1;
            };
            
            result
        }

        // Returns paginated leaderboard slice for UI consumption.
        fn get_leaderboard_page(
            self: @ContractState,
            epoch: u64,
            leaderboard_type: LeaderboardType,
            start: u64,
            limit: u64
        ) -> Array<LeaderboardEntry> {
            let mut result = array![];
            if limit == 0 {
                return result;
            }
            let size_key = compute_size_key(epoch, leaderboard_type);
            let total_size = self.leaderboard_size.read(size_key);
            if start >= total_size {
                return result;
            }

            let max_read = self.max_entries_per_update.read();
            let mut remaining = if limit > max_read { max_read } else { limit };
            let mut i = start;

            while i < total_size && remaining > 0 {
                let entry_key = compute_entry_key(epoch, leaderboard_type, i);
                let entry = self.leaderboard_entries.read(entry_key);
                result.append(entry);
                remaining -= 1;
                i += 1;
            };
            
            result
        }

        // Returns cached user rank and score entry, if present.
        fn get_user_rank(
            self: @ContractState, 
            epoch: u64, 
            leaderboard_type: LeaderboardType, 
            user: ContractAddress
        ) -> u256 {
            // O(1) lookup via user rank cache.
            let user_rank_key = compute_user_rank_key(epoch, leaderboard_type, user);
            self.user_rank_cache.read(user_rank_key)
        }

        // Replaces leaderboard snapshot for the provided epoch and type.
        fn update_leaderboard(
            ref self: ContractState, 
            epoch: u64, 
            leaderboard_type: LeaderboardType, 
            data: Array<LeaderboardEntry>
        ) {
            // Enforce pause state and backend authorization.
            assert!(!self.paused.read(), "Contract is paused");
            
            let caller = get_caller_address();
            let backend = self.backend_address.read();
            assert!(caller == backend, "Caller is not authorized backend");

            // Enforce per-epoch/type write cooldown.
            let current_time = get_block_timestamp();
            let timestamp_key = compute_update_timestamp_key(epoch, leaderboard_type);
            let last_update = self.last_update_timestamp.read(timestamp_key);
            let cooldown = self.update_cooldown.read();
            
            assert!(
                current_time >= last_update + cooldown, 
                "Update too frequent - cooldown active"
            );

            // Reject empty updates and oversized batches.
            let data_len = data.len();
            let max_entries = self.max_entries_per_update.read();
            assert!(data_len > 0, "Cannot update with empty data");
            assert!(
                data_len.into() <= max_entries, 
                "Exceeds max entries per update"
            );
            
            let mut i: u32 = 0;
            
            while i < data_len {
                let entry_to_write = data.at(i).clone();
                let idx_u64: u64 = i.into();
                
                // Entry integrity checks.
                assert!(entry_to_write.rank > 0, "Rank must be positive");
                assert!(!entry_to_write.user.is_zero(), "Invalid user address");
                
                // Rank ordering checks can be enabled if backend guarantees strict ordering.
                // assert!(entry_to_write.rank > prev_rank, "Ranks must be sequential");
                // prev_rank = entry_to_write.rank;
                
                // Persist entry keyed by epoch/type/index.
                let entry_key = compute_entry_key(epoch, leaderboard_type, idx_u64);
                self.leaderboard_entries.write(entry_key, entry_to_write.clone());
                
                // Cache user rank for constant-time rank reads.
                let user_rank_key = compute_user_rank_key(
                    epoch, 
                    leaderboard_type, 
                    entry_to_write.user
                );
                self.user_rank_cache.write(user_rank_key, entry_to_write.rank);
                
                i += 1;
            };
            
            // Persist snapshot size.
            let size_key = compute_size_key(epoch, leaderboard_type);
            let size_value: u64 = data_len.into();
            self.leaderboard_size.write(size_key, size_value);
            
            // Record last successful update timestamp.
            self.last_update_timestamp.write(timestamp_key, current_time);
            
            self.emit(
                LeaderboardUpdated {
                    epoch,
                    leaderboard_type,
                    entries_count: size_value,
                }
            );
        }

        // Returns current leaderboard entry count.
        fn get_leaderboard_size(
            self: @ContractState,
            epoch: u64,
            leaderboard_type: LeaderboardType
        ) -> u64 {
            let size_key = compute_size_key(epoch, leaderboard_type);
            self.leaderboard_size.read(size_key)
        }

        // Returns backend signer address used for updates.
        fn get_backend_address(self: @ContractState) -> ContractAddress {
            self.backend_address.read()
        }

        // Returns contract owner address.
        fn get_owner(self: @ContractState) -> ContractAddress {
            self.owner.read()
        }

        // Updates backend signer address used for leaderboard writes (owner only).
        fn set_backend_address(ref self: ContractState, new_backend: ContractAddress) {
            let caller = get_caller_address();
            let owner = self.owner.read();
            assert!(caller == owner, "Only owner can update backend address");
            assert!(!new_backend.is_zero(), "Backend cannot be zero address");
            
            let old_backend = self.backend_address.read();
            self.backend_address.write(new_backend);
            
            self.emit(
                BackendAddressUpdated {
                    old_backend,
                    new_backend,
                }
            );
        }

        // Pauses leaderboard mutating operations.
        fn pause(ref self: ContractState) {
            let caller = get_caller_address();
            assert!(caller == self.owner.read(), "Only owner can pause");
            assert!(!self.paused.read(), "Already paused");
            
            self.paused.write(true);
            self.emit(ContractPaused { timestamp: get_block_timestamp() });
        }

        // Resumes leaderboard mutating operations.
        fn unpause(ref self: ContractState) {
            let caller = get_caller_address();
            assert!(caller == self.owner.read(), "Only owner can unpause");
            assert!(self.paused.read(), "Not paused");
            
            self.paused.write(false);
            self.emit(ContractUnpaused { timestamp: get_block_timestamp() });
        }

        // Returns whether the contract is currently paused.
        fn is_paused(self: @ContractState) -> bool {
            self.paused.read()
        }

        // Updates maximum entries allowed per leaderboard update (owner only).
        fn set_max_entries(ref self: ContractState, max: u64) {
            let caller = get_caller_address();
            assert!(caller == self.owner.read(), "Only owner");
            assert!(max > 0, "Max must be positive");
            assert!(max <= 10000, "Max too high"); // Hard cap to bound update costs.
            
            let old_max = self.max_entries_per_update.read();
            self.max_entries_per_update.write(max);
            
            self.emit(MaxEntriesUpdated { old_max, new_max: max });
        }

        // Returns configured maximum leaderboard size.
        fn get_max_entries(self: @ContractState) -> u64 {
            self.max_entries_per_update.read()
        }

        // Updates minimum seconds between leaderboard updates (owner only).
        fn set_update_cooldown(ref self: ContractState, seconds: u64) {
            let caller = get_caller_address();
            assert!(caller == self.owner.read(), "Only owner");
            assert!(seconds <= 86400, "Cooldown too long (max 24h)");
            
            let old_cooldown = self.update_cooldown.read();
            self.update_cooldown.write(seconds);
            
            self.emit(UpdateCooldownChanged { old_cooldown, new_cooldown: seconds });
        }
    }

    #[abi(embed_v0)]
    impl LeaderboardViewPrivacyImpl of super::ILeaderboardViewPrivacy<ContractState> {
        // Sets privacy router used for Hide Mode leaderboard actions (owner only).
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            let caller = get_caller_address();
            assert!(caller == self.owner.read(), "Only owner");
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        // Relays private leaderboard payload for proof verification and execution.
        // `nullifiers` prevent replay and `commitments` bind intended update state.
        fn submit_private_leaderboard_action(
            ref self: ContractState,
            old_root: felt252,
            new_root: felt252,
            nullifiers: Span<felt252>,
            commitments: Span<felt252>,
            public_inputs: Span<felt252>,
            proof: Span<felt252>
        ) {
            let router = self.privacy_router.read();
            assert!(!router.is_zero(), "Privacy router not set");
            let dispatcher = IPrivacyRouterDispatcher { contract_address: router };
            dispatcher.submit_action(
                ACTION_LEADER,
                old_root,
                new_root,
                nullifiers,
                commitments,
                public_inputs,
                proof
            );
        }
    }
}
