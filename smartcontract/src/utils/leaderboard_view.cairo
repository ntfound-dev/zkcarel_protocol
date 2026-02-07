use starknet::ContractAddress;

#[derive(Copy, Drop, Serde, starknet::Store)]
pub enum LeaderboardType {
    #[default]
    Points,
    Volume,
    Referrals,
}

impl LeaderboardTypeIntoFelt252 of Into<LeaderboardType, felt252> {
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

#[starknet::interface]
pub trait ILeaderboardView<TContractState> {
    fn get_leaderboard(
        self: @TContractState, 
        epoch: u64, 
        leaderboard_type: LeaderboardType, 
        top_n: u64
    ) -> Array<LeaderboardEntry>;
    
    fn get_user_rank(
        self: @TContractState, 
        epoch: u64, 
        leaderboard_type: LeaderboardType, 
        user: ContractAddress
    ) -> u256;
    
    fn update_leaderboard(
        ref self: TContractState, 
        epoch: u64, 
        leaderboard_type: LeaderboardType, 
        data: Array<LeaderboardEntry>
    );
    
    fn get_leaderboard_size(
        self: @TContractState,
        epoch: u64,
        leaderboard_type: LeaderboardType
    ) -> u64;
    
    fn get_backend_address(self: @TContractState) -> ContractAddress;
    fn get_owner(self: @TContractState) -> ContractAddress;
    fn set_backend_address(ref self: TContractState, new_backend: ContractAddress);
    
    // New admin functions
    fn pause(ref self: TContractState);
    fn unpause(ref self: TContractState);
    fn is_paused(self: @TContractState) -> bool;
    fn set_max_entries(ref self: TContractState, max: u64);
    fn get_max_entries(self: @TContractState) -> u64;
    fn set_update_cooldown(ref self: TContractState, seconds: u64);
}

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
    use super::{LeaderboardEntry, LeaderboardType, ILeaderboardView, LeaderboardTypeIntoFelt252};

    #[storage]
    struct Storage {
        // Existing storage
        leaderboard_entries: Map<felt252, LeaderboardEntry>,
        leaderboard_size: Map<felt252, u64>,
        
        // NEW: O(1) user rank lookup - MAJOR GAS OPTIMIZATION
        user_rank_cache: Map<felt252, u256>,
        
        // Access control
        backend_address: ContractAddress,
        owner: ContractAddress,
        
        // NEW: Security features
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

    // Helper functions
    fn compute_entry_key(epoch: u64, leaderboard_type: LeaderboardType, index: u64) -> felt252 {
        let type_felt: felt252 = leaderboard_type.into();
        let mut data = array![epoch.into(), type_felt, index.into()];
        poseidon_hash_span(data.span())
    }

    fn compute_size_key(epoch: u64, leaderboard_type: LeaderboardType) -> felt252 {
        let type_felt: felt252 = leaderboard_type.into();
        let mut data = array![epoch.into(), type_felt];
        poseidon_hash_span(data.span())
    }

    // NEW: User rank cache key
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

    fn compute_update_timestamp_key(epoch: u64, leaderboard_type: LeaderboardType) -> felt252 {
        compute_size_key(epoch, leaderboard_type)
    }

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
        
        // Security defaults
        self.paused.write(false);
        self.max_entries_per_update.write(1000); // Max 1000 entries
        self.update_cooldown.write(300); // 5 minutes cooldown
    }

    #[abi(embed_v0)]
    impl LeaderboardViewImpl of ILeaderboardView<ContractState> {
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
            let limit = if top_n < total_size { top_n } else { total_size };
            
            while i < limit {
                let entry_key = compute_entry_key(epoch, leaderboard_type, i);
                let entry = self.leaderboard_entries.read(entry_key);
                result.append(entry);
                i += 1;
            };
            
            result
        }

        fn get_user_rank(
            self: @ContractState, 
            epoch: u64, 
            leaderboard_type: LeaderboardType, 
            user: ContractAddress
        ) -> u256 {
            // OPTIMIZED: O(1) lookup instead of O(n)
            let user_rank_key = compute_user_rank_key(epoch, leaderboard_type, user);
            self.user_rank_cache.read(user_rank_key)
        }

        fn update_leaderboard(
            ref self: ContractState, 
            epoch: u64, 
            leaderboard_type: LeaderboardType, 
            data: Array<LeaderboardEntry>
        ) {
            // Security checks
            assert!(!self.paused.read(), "Contract is paused");
            
            let caller = get_caller_address();
            let backend = self.backend_address.read();
            assert!(caller == backend, "Caller is not authorized backend");

            // Rate limiting
            let current_time = get_block_timestamp();
            let timestamp_key = compute_update_timestamp_key(epoch, leaderboard_type);
            let last_update = self.last_update_timestamp.read(timestamp_key);
            let cooldown = self.update_cooldown.read();
            
            assert!(
                current_time >= last_update + cooldown, 
                "Update too frequent - cooldown active"
            );

            // Input validation
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
                
                // Data integrity validation
                assert!(entry_to_write.rank > 0, "Rank must be positive");
                assert!(!entry_to_write.user.is_zero(), "Invalid user address");
                
                // Optional: Check rank ordering (commented out for flexibility)
                // assert!(entry_to_write.rank > prev_rank, "Ranks must be sequential");
                // prev_rank = entry_to_write.rank;
                
                // Write entry
                let entry_key = compute_entry_key(epoch, leaderboard_type, idx_u64);
                self.leaderboard_entries.write(entry_key, entry_to_write.clone());
                
                // OPTIMIZATION: Cache user rank for O(1) lookup
                let user_rank_key = compute_user_rank_key(
                    epoch, 
                    leaderboard_type, 
                    entry_to_write.user
                );
                self.user_rank_cache.write(user_rank_key, entry_to_write.rank);
                
                i += 1;
            };
            
            // Update size
            let size_key = compute_size_key(epoch, leaderboard_type);
            let size_value: u64 = data_len.into();
            self.leaderboard_size.write(size_key, size_value);
            
            // Update timestamp
            self.last_update_timestamp.write(timestamp_key, current_time);
            
            self.emit(
                LeaderboardUpdated {
                    epoch,
                    leaderboard_type,
                    entries_count: size_value,
                }
            );
        }

        fn get_leaderboard_size(
            self: @ContractState,
            epoch: u64,
            leaderboard_type: LeaderboardType
        ) -> u64 {
            let size_key = compute_size_key(epoch, leaderboard_type);
            self.leaderboard_size.read(size_key)
        }

        fn get_backend_address(self: @ContractState) -> ContractAddress {
            self.backend_address.read()
        }

        fn get_owner(self: @ContractState) -> ContractAddress {
            self.owner.read()
        }

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

        // NEW: Emergency pause
        fn pause(ref self: ContractState) {
            let caller = get_caller_address();
            assert!(caller == self.owner.read(), "Only owner can pause");
            assert!(!self.paused.read(), "Already paused");
            
            self.paused.write(true);
            self.emit(ContractPaused { timestamp: get_block_timestamp() });
        }

        fn unpause(ref self: ContractState) {
            let caller = get_caller_address();
            assert!(caller == self.owner.read(), "Only owner can unpause");
            assert!(self.paused.read(), "Not paused");
            
            self.paused.write(false);
            self.emit(ContractUnpaused { timestamp: get_block_timestamp() });
        }

        fn is_paused(self: @ContractState) -> bool {
            self.paused.read()
        }

        // NEW: Configure max entries
        fn set_max_entries(ref self: ContractState, max: u64) {
            let caller = get_caller_address();
            assert!(caller == self.owner.read(), "Only owner");
            assert!(max > 0, "Max must be positive");
            assert!(max <= 10000, "Max too high"); // Reasonable upper limit
            
            let old_max = self.max_entries_per_update.read();
            self.max_entries_per_update.write(max);
            
            self.emit(MaxEntriesUpdated { old_max, new_max: max });
        }

        fn get_max_entries(self: @ContractState) -> u64 {
            self.max_entries_per_update.read()
        }

        // NEW: Configure cooldown
        fn set_update_cooldown(ref self: ContractState, seconds: u64) {
            let caller = get_caller_address();
            assert!(caller == self.owner.read(), "Only owner");
            assert!(seconds <= 86400, "Cooldown too long (max 24h)");
            
            let old_cooldown = self.update_cooldown.read();
            self.update_cooldown.write(seconds);
            
            self.emit(UpdateCooldownChanged { old_cooldown, new_cooldown: seconds });
        }
    }
}