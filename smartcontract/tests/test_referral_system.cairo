#[cfg(test)]
mod tests {
    use starknet::ContractAddress;
    use snforge_std::{declare, ContractClassTrait, DeclareResultTrait};
    use snforge_std::{start_cheat_caller_address, stop_cheat_caller_address, spy_events, EventSpyAssertionsTrait};
    use snforge_std::interact_with_state;
    
    // Ensure namespace matches package name in `Scarb.toml` (`smartcontract`).
    use smartcontract::rewards::referral_system::{IReferralSystemDispatcher, IReferralSystemDispatcherTrait};
    use smartcontract::rewards::referral_system::ReferralSystem;
    use smartcontract::rewards::referral_system::ReferralSystem::{ReferralRegistered, BonusClaimed};
    use smartcontract::rewards::point_storage::{IPointStorageAdminDispatcher, IPointStorageAdminDispatcherTrait, IPointStorageDispatcher, IPointStorageDispatcherTrait};
    
    // Important: import storage traits so `.entry()`, `.read()`, and `.write()` resolve.
    use starknet::storage::*;
    use core::array::ArrayTrait;

    // Deploys point storage fixture and returns handles used by dependent test flows.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn deploy_point_storage(signer: ContractAddress) -> IPointStorageDispatcher {
        let contract = declare("PointStorage").unwrap().contract_class();
        let mut args = array![];
        signer.serialize(ref args);
        let (contract_address, _) = contract.deploy(@args).unwrap();
        IPointStorageDispatcher { contract_address }
    }

    // Deploys referral fixture and returns handles used by dependent test flows.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn deploy_referral(admin: ContractAddress, signer: ContractAddress, point_storage: ContractAddress) -> IReferralSystemDispatcher {
        let contract = declare("ReferralSystem").unwrap().contract_class();
        let mut args = array![];
        admin.serialize(ref args);
        signer.serialize(ref args);
        point_storage.serialize(ref args);
        let (contract_address, _) = contract.deploy(@args).unwrap();
        IReferralSystemDispatcher { contract_address }
    }

    #[test]
    // Test case: validates registration success behavior with expected assertions and revert boundaries.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn test_registration_success() {
        let admin: ContractAddress = 0x1.try_into().unwrap();
        let signer: ContractAddress = 0x2.try_into().unwrap();
        let point_storage = deploy_point_storage(signer);
        let dispatcher = deploy_referral(admin, signer, point_storage.contract_address);
        let mut spy = spy_events();

        let referrer: ContractAddress = 0x111.try_into().unwrap();
        let referee: ContractAddress = 0x222.try_into().unwrap();

        start_cheat_caller_address(dispatcher.contract_address, referee);
        dispatcher.register_referral(referrer, referee);
        stop_cheat_caller_address(dispatcher.contract_address);

        assert!(dispatcher.get_referrer(referee) == referrer, "Referrer mismatch");
        let referrals = dispatcher.get_referrals(referrer);
        
        // Use ArrayTrait explicitly to avoid Span-related ambiguity.
        assert!(ArrayTrait::len(@referrals) == 1, "Count mismatch");
        assert!(*ArrayTrait::at(@referrals, 0) == referee, "Referee address mismatch");

        spy.assert_emitted(@array![
            (
                dispatcher.contract_address,
                ReferralSystem::Event::ReferralRegistered(
                    ReferralRegistered { referrer, referee }
                )
            )
        ]);
    }

    #[test]
    #[should_panic(expected: "Cannot refer yourself")]
    // Test case: validates cannot refer self behavior with expected assertions and revert boundaries.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn test_cannot_refer_self() {
        let admin: ContractAddress = 0x1.try_into().unwrap();
        let signer: ContractAddress = 0x2.try_into().unwrap();
        let point_storage = deploy_point_storage(signer);
        let dispatcher = deploy_referral(admin, signer, point_storage.contract_address);
        let user: ContractAddress = 0x111.try_into().unwrap();
        start_cheat_caller_address(dispatcher.contract_address, user);
        dispatcher.register_referral(user, user);
        stop_cheat_caller_address(dispatcher.contract_address);
    }

    #[test]
    // Test case: validates valid referral threshold behavior with expected assertions and revert boundaries.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn test_valid_referral_threshold() {
        let admin: ContractAddress = 0x1.try_into().unwrap();
        let signer: ContractAddress = 0x2.try_into().unwrap();
        let point_storage = deploy_point_storage(signer);
        let dispatcher = deploy_referral(admin, signer, point_storage.contract_address);
        let referee: ContractAddress = 0x222.try_into().unwrap();
        let epoch: u64 = 1;

        // Use `interact_with_state` to manipulate internal storage.
        interact_with_state(dispatcher.contract_address, || {
            let mut state = ReferralSystem::contract_state_for_testing();
            // `.entry()` and `.write()` resolve because storage traits are imported.
            state.referee_points.entry((referee, epoch)).write(50_u256);
        });

        assert!(!dispatcher.is_valid_referral(referee, epoch), "Should be invalid");

        interact_with_state(dispatcher.contract_address, || {
            let mut state = ReferralSystem::contract_state_for_testing();
            state.referee_points.entry((referee, epoch)).write(150_u256);
        });

        assert!(dispatcher.is_valid_referral(referee, epoch), "Should be valid");
    }

    #[test]
    // Test case: validates claim bonus logic behavior with expected assertions and revert boundaries.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn test_claim_bonus_logic() {
        let admin: ContractAddress = 0x1.try_into().unwrap();
        let signer: ContractAddress = 0x2.try_into().unwrap();
        let point_storage = deploy_point_storage(signer);
        let dispatcher = deploy_referral(admin, signer, point_storage.contract_address);
        let referrer: ContractAddress = 0x111.try_into().unwrap();
        let referee: ContractAddress = 0x222.try_into().unwrap();
        let mut spy = spy_events();
        let epoch = 1_u64;

        // Authorize referral system as producer in PointStorage
        let point_admin = IPointStorageAdminDispatcher { contract_address: point_storage.contract_address };
        start_cheat_caller_address(point_storage.contract_address, signer);
        point_admin.add_producer(dispatcher.contract_address);
        stop_cheat_caller_address(point_storage.contract_address);

        // Register referral (caller must be referee)
        start_cheat_caller_address(dispatcher.contract_address, referee);
        dispatcher.register_referral(referrer, referee);
        stop_cheat_caller_address(dispatcher.contract_address);

        // Backend signer records referee points (total points)
        start_cheat_caller_address(dispatcher.contract_address, signer);
        dispatcher.record_referee_points(epoch, referee, 200_u256);
        stop_cheat_caller_address(dispatcher.contract_address);

        start_cheat_caller_address(dispatcher.contract_address, referrer);
        
        let bonus = dispatcher.claim_referral_bonus(epoch);

        assert!(bonus == 20_u256, "Bonus calculation wrong");
        assert!(point_storage.get_user_points(epoch, referrer) == 20_u256, "PointStorage not updated");

        spy.assert_emitted(@array![
            (
                dispatcher.contract_address,
                ReferralSystem::Event::BonusClaimed(
                    BonusClaimed { referrer, amount: 20_u256, epoch }
                )
            )
        ]);

        stop_cheat_caller_address(dispatcher.contract_address);
    }
}
