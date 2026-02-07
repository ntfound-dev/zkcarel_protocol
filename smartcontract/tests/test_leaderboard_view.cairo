#[cfg(test)]
mod tests {
    use starknet::ContractAddress;
    
    use snforge_std::{
        declare, ContractClassTrait, DeclareResultTrait, 
        start_cheat_caller_address, stop_cheat_caller_address,
        start_cheat_block_timestamp_global, stop_cheat_block_timestamp_global
    };

    use smartcontract::utils::leaderboard_view::{
        ILeaderboardViewDispatcher, ILeaderboardViewDispatcherTrait,
        LeaderboardType, LeaderboardEntry
    };

    fn deploy_contract() -> (ILeaderboardViewDispatcher, ContractAddress, ContractAddress) {
        let owner: ContractAddress = 0x123_felt252.try_into().unwrap();
        let backend: ContractAddress = 0x456_felt252.try_into().unwrap();
        
        let contract = declare("LeaderboardView").expect('Declaration failed');
        
        let mut constructor_args = array![];
        constructor_args.append(owner.into());
        constructor_args.append(backend.into());

        let (contract_address, _) = contract.contract_class().deploy(@constructor_args).expect('Deployment failed');

        let dispatcher = ILeaderboardViewDispatcher { contract_address };
        (dispatcher, owner, backend)
    }

    fn create_sample_entries() -> Array<LeaderboardEntry> {
        let mut entries: Array<LeaderboardEntry> = array![];
        
        entries.append(LeaderboardEntry {
            rank: 1,
            user: 0x1_felt252.try_into().unwrap(),
            value: 1000,
            username: "Alice"
        });
        
        entries.append(LeaderboardEntry {
            rank: 2,
            user: 0x2_felt252.try_into().unwrap(),
            value: 800,
            username: "Bob"
        });
        
        entries.append(LeaderboardEntry {
            rank: 3,
            user: 0x3_felt252.try_into().unwrap(),
            value: 600,
            username: "Charlie"
        });
        
        entries
    }

    #[test]
    fn test_constructor() {
        let (dispatcher, owner, backend) = deploy_contract();
        
        assert!(dispatcher.get_owner() == owner, "Owner mismatch");
        assert!(dispatcher.get_backend_address() == backend, "Backend mismatch");
        assert!(!dispatcher.is_paused(), "Should not be paused");
        assert!(dispatcher.get_max_entries() == 1000, "Default max entries");
    }

    #[test]
    fn test_update_leaderboard_as_backend() {
        let (dispatcher, _owner, backend) = deploy_contract();
        
        // Mock timestamp to avoid cooldown issues
        start_cheat_block_timestamp_global(1000);
        start_cheat_caller_address(dispatcher.contract_address, backend);
        
        let epoch: u64 = 1;
        let leaderboard_type = LeaderboardType::Points;
        let entries = create_sample_entries();
        
        dispatcher.update_leaderboard(epoch, leaderboard_type, entries.clone());
        
        let size = dispatcher.get_leaderboard_size(epoch, leaderboard_type);
        assert!(size == 3, "Size mismatch");
        
        let retrieved = dispatcher.get_leaderboard(epoch, leaderboard_type, 3);
        let first = retrieved.at(0);
        
        assert!(*first.rank == 1, "First rank mismatch");
        assert!(*first.value == 1000, "First value mismatch");

        stop_cheat_caller_address(dispatcher.contract_address);
        stop_cheat_block_timestamp_global();
    }

    #[test]
    #[should_panic(expected: "Caller is not authorized backend")]
    fn test_update_leaderboard_unauthorized() {
        let (dispatcher, _owner, _backend) = deploy_contract();
        
        start_cheat_block_timestamp_global(1000);
        let unauthorized: ContractAddress = 0x999_felt252.try_into().unwrap();
        start_cheat_caller_address(dispatcher.contract_address, unauthorized);
        
        let epoch: u64 = 1;
        let leaderboard_type = LeaderboardType::Points;
        let entries = create_sample_entries();
        
        dispatcher.update_leaderboard(epoch, leaderboard_type, entries);
        
        stop_cheat_caller_address(dispatcher.contract_address);
        stop_cheat_block_timestamp_global();
    }

    #[test]
    fn test_get_user_rank() {
        let (dispatcher, _owner, backend) = deploy_contract();
        
        start_cheat_block_timestamp_global(1000);
        start_cheat_caller_address(dispatcher.contract_address, backend);
        
        let epoch: u64 = 1;
        let leaderboard_type = LeaderboardType::Points;
        let entries = create_sample_entries();
        
        dispatcher.update_leaderboard(epoch, leaderboard_type, entries);
        
        let bob_address: ContractAddress = 0x2_felt252.try_into().unwrap();
        let bob_rank = dispatcher.get_user_rank(epoch, leaderboard_type, bob_address);
        assert!(bob_rank == 2, "Bob rank mismatch");
        
        // Test non-existent user
        let unknown: ContractAddress = 0x999_felt252.try_into().unwrap();
        let unknown_rank = dispatcher.get_user_rank(epoch, leaderboard_type, unknown);
        assert!(unknown_rank == 0, "Unknown user should have rank 0");
        
        stop_cheat_caller_address(dispatcher.contract_address);
        stop_cheat_block_timestamp_global();
    }

    #[test]
    fn test_set_backend_address() {
        let (dispatcher, owner, _backend) = deploy_contract();
        let new_backend: ContractAddress = 0x789_felt252.try_into().unwrap();
        
        start_cheat_caller_address(dispatcher.contract_address, owner);
        dispatcher.set_backend_address(new_backend);
        
        assert!(dispatcher.get_backend_address() == new_backend, "Backend update failed");
        stop_cheat_caller_address(dispatcher.contract_address);
    }

    #[test]
    fn test_pause_unpause() {
        let (dispatcher, owner, _backend) = deploy_contract();
        
        start_cheat_caller_address(dispatcher.contract_address, owner);
        
        // Initially not paused
        assert!(!dispatcher.is_paused(), "Should not be paused initially");
        
        // Pause
        dispatcher.pause();
        assert!(dispatcher.is_paused(), "Should be paused");
        
        // Unpause
        dispatcher.unpause();
        assert!(!dispatcher.is_paused(), "Should be unpaused");
        
        stop_cheat_caller_address(dispatcher.contract_address);
    }

    #[test]
    #[should_panic(expected: "Contract is paused")]
    fn test_update_when_paused() {
        let (dispatcher, owner, backend) = deploy_contract();
        
        // Pause contract
        start_cheat_caller_address(dispatcher.contract_address, owner);
        dispatcher.pause();
        stop_cheat_caller_address(dispatcher.contract_address);
        
        // Try to update (should fail)
        start_cheat_block_timestamp_global(1000);
        start_cheat_caller_address(dispatcher.contract_address, backend);
        
        let entries = create_sample_entries();
        dispatcher.update_leaderboard(1, LeaderboardType::Points, entries);
        
        stop_cheat_caller_address(dispatcher.contract_address);
        stop_cheat_block_timestamp_global();
    }

    #[test]
    #[should_panic(expected: "Update too frequent - cooldown active")]
    fn test_cooldown_enforcement() {
        let (dispatcher, _owner, backend) = deploy_contract();
        
        start_cheat_block_timestamp_global(1000);
        start_cheat_caller_address(dispatcher.contract_address, backend);
        
        let epoch: u64 = 1;
        let leaderboard_type = LeaderboardType::Points;
        let entries = create_sample_entries();
        
        // First update - should succeed
        dispatcher.update_leaderboard(epoch, leaderboard_type, entries.clone());
        
        // Advance time by only 100 seconds (less than 300 default cooldown)
        stop_cheat_block_timestamp_global();
        start_cheat_block_timestamp_global(1100);
        
        // Second update - should fail due to cooldown
        dispatcher.update_leaderboard(epoch, leaderboard_type, entries);
        
        stop_cheat_caller_address(dispatcher.contract_address);
        stop_cheat_block_timestamp_global();
    }

    #[test]
    fn test_cooldown_passes_after_timeout() {
        let (dispatcher, _owner, backend) = deploy_contract();
        
        start_cheat_block_timestamp_global(1000);
        start_cheat_caller_address(dispatcher.contract_address, backend);
        
        let epoch: u64 = 1;
        let leaderboard_type = LeaderboardType::Points;
        let entries = create_sample_entries();
        
        // First update
        dispatcher.update_leaderboard(epoch, leaderboard_type, entries.clone());
        
        // Advance time by 400 seconds (more than 300 default cooldown)
        stop_cheat_block_timestamp_global();
        start_cheat_block_timestamp_global(1400);
        
        // Second update - should succeed
        dispatcher.update_leaderboard(epoch, leaderboard_type, entries);
        
        stop_cheat_caller_address(dispatcher.contract_address);
        stop_cheat_block_timestamp_global();
    }

    #[test]
fn test_max_entries_enforcement() {
    let (dispatcher, owner, backend) = deploy_contract();
    
    // Set max to 5 for testing
    start_cheat_caller_address(dispatcher.contract_address, owner);
    dispatcher.set_max_entries(5);
    stop_cheat_caller_address(dispatcher.contract_address);
    
    // Test that 5 entries pass
    start_cheat_block_timestamp_global(1000);
    start_cheat_caller_address(dispatcher.contract_address, backend);
    
    let mut valid_entries = array![];
    let mut i: u32 = 1;
    while i <= 5 {
        valid_entries.append(LeaderboardEntry {
            rank: i.into(),
            user: 0x1000_felt252.try_into().unwrap(),
            value: (100 - i).into(),
            username: "User"
        });
        i += 1;
    };
    
    // Should succeed
    dispatcher.update_leaderboard(1, LeaderboardType::Points, valid_entries);
    assert!(dispatcher.get_leaderboard_size(1, LeaderboardType::Points) == 5, "Should accept 5 entries");
    
    stop_cheat_caller_address(dispatcher.contract_address);
    stop_cheat_block_timestamp_global();
}

#[test]
#[should_panic(expected: "Exceeds max entries per update")]
fn test_exceeds_max_entries() {
    let (dispatcher, owner, backend) = deploy_contract();
    
    // Set max to 5
    start_cheat_caller_address(dispatcher.contract_address, owner);
    dispatcher.set_max_entries(5);
    stop_cheat_caller_address(dispatcher.contract_address);
    
    start_cheat_block_timestamp_global(1000);
    start_cheat_caller_address(dispatcher.contract_address, backend);
    
    // Try to add 6 entries (should fail)
    let mut invalid_entries = array![];
    let mut i: u32 = 1;
    while i <= 6 {
        invalid_entries.append(LeaderboardEntry {
            rank: i.into(),
            user: 0x1000_felt252.try_into().unwrap(),
            value: (100 - i).into(),
            username: "User"
        });
        i += 1;
    };
    
    // Should panic
    dispatcher.update_leaderboard(1, LeaderboardType::Points, invalid_entries);
    
    stop_cheat_caller_address(dispatcher.contract_address);
    stop_cheat_block_timestamp_global();
}
    #[test]
    fn test_set_max_entries() {
        let (dispatcher, owner, _backend) = deploy_contract();
        
        start_cheat_caller_address(dispatcher.contract_address, owner);
        
        // Change max entries to 500
        dispatcher.set_max_entries(500);
        assert!(dispatcher.get_max_entries() == 500, "Max entries not updated");
        
        stop_cheat_caller_address(dispatcher.contract_address);
    }

    #[test]
    #[should_panic(expected: "Rank must be positive")]
    fn test_invalid_rank_validation() {
        let (dispatcher, _owner, backend) = deploy_contract();
        
        start_cheat_block_timestamp_global(1000);
        start_cheat_caller_address(dispatcher.contract_address, backend);
        
        let mut invalid_entries = array![];
        invalid_entries.append(LeaderboardEntry {
            rank: 0, // Invalid: rank must be > 0
            user: 0x1_felt252.try_into().unwrap(),
            value: 1000,
            username: "Alice"
        });
        
        dispatcher.update_leaderboard(1, LeaderboardType::Points, invalid_entries);
        
        stop_cheat_caller_address(dispatcher.contract_address);
        stop_cheat_block_timestamp_global();
    }

    #[test]
    fn test_multiple_leaderboard_types() {
        let (dispatcher, _owner, backend) = deploy_contract();
        
        start_cheat_block_timestamp_global(1000);
        start_cheat_caller_address(dispatcher.contract_address, backend);
        
        let epoch: u64 = 1;
        let entries = create_sample_entries();
        
        // Update Points leaderboard
        dispatcher.update_leaderboard(epoch, LeaderboardType::Points, entries.clone());
        
        // Advance time to avoid cooldown
        stop_cheat_block_timestamp_global();
        start_cheat_block_timestamp_global(1500);
        
        // Update Volume leaderboard
        dispatcher.update_leaderboard(epoch, LeaderboardType::Volume, entries.clone());
        
        // Advance time again
        stop_cheat_block_timestamp_global();
        start_cheat_block_timestamp_global(2000);
        
        // Update Referrals leaderboard
        dispatcher.update_leaderboard(epoch, LeaderboardType::Referrals, entries);
        
        // Verify all three are stored separately
        assert!(dispatcher.get_leaderboard_size(epoch, LeaderboardType::Points) == 3, "Points size");
        assert!(dispatcher.get_leaderboard_size(epoch, LeaderboardType::Volume) == 3, "Volume size");
        assert!(dispatcher.get_leaderboard_size(epoch, LeaderboardType::Referrals) == 3, "Referrals size");
        
        stop_cheat_caller_address(dispatcher.contract_address);
        stop_cheat_block_timestamp_global();
    }

    #[test]
    fn test_get_leaderboard_pagination() {
        let (dispatcher, _owner, backend) = deploy_contract();
        
        start_cheat_block_timestamp_global(1000);
        start_cheat_caller_address(dispatcher.contract_address, backend);
        
        let entries = create_sample_entries();
        dispatcher.update_leaderboard(1, LeaderboardType::Points, entries);
        
        // Get top 2
        let top_2 = dispatcher.get_leaderboard(1, LeaderboardType::Points, 2);
        assert!(top_2.len() == 2, "Should get 2 entries");
        assert!(*top_2.at(0).rank == 1, "First entry rank");
        assert!(*top_2.at(1).rank == 2, "Second entry rank");
        
        stop_cheat_caller_address(dispatcher.contract_address);
        stop_cheat_block_timestamp_global();
    }
}