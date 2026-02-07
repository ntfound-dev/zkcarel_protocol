#[cfg(test)]
mod tests {
    use starknet::ContractAddress;
    use snforge_std::{declare, ContractClassTrait, DeclareResultTrait};
    use snforge_std::{start_cheat_caller_address, stop_cheat_caller_address, spy_events, EventSpyAssertionsTrait};
    use snforge_std::interact_with_state;
    
    // Pastikan namespace sesuai dengan nama package di Scarb.toml (smartcontract)
    use smartcontract::rewards::referral_system::{IReferralSystemDispatcher, IReferralSystemDispatcherTrait};
    use smartcontract::rewards::referral_system::ReferralSystem;
    use smartcontract::rewards::referral_system::ReferralSystem::{ReferralRegistered, BonusClaimed};
    
    // PENTING: Import semua trait storage agar .entry(), .read(), dan .write() dapat dikenali
    use starknet::storage::*;
    use core::array::ArrayTrait;

    fn deploy_referral() -> IReferralSystemDispatcher {
        let contract = declare("ReferralSystem").unwrap().contract_class();
        let (contract_address, _) = contract.deploy(@array![]).unwrap();
        IReferralSystemDispatcher { contract_address }
    }

    #[test]
    fn test_registration_success() {
        let dispatcher = deploy_referral();
        let mut spy = spy_events();

        let referrer: ContractAddress = 0x111.try_into().unwrap();
        let referee: ContractAddress = 0x222.try_into().unwrap();

        dispatcher.register_referral(referrer, referee);

        assert!(dispatcher.get_referrer(referee) == referrer, "Referrer mismatch");
        let referrals = dispatcher.get_referrals(referrer);
        
        // Gunakan ArrayTrait secara eksplisit untuk menghindari ambiguitas dengan Span
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
    fn test_cannot_refer_self() {
        let dispatcher = deploy_referral();
        let user: ContractAddress = 0x111.try_into().unwrap();
        dispatcher.register_referral(user, user);
    }

    #[test]
    fn test_valid_referral_threshold() {
        let dispatcher = deploy_referral();
        let referee: ContractAddress = 0x222.try_into().unwrap();

        // Menggunakan interact_with_state untuk memanipulasi storage internal
        interact_with_state(dispatcher.contract_address, || {
            let mut state = ReferralSystem::contract_state_for_testing();
            // Sekarang .entry() dan .write() valid karena trait sudah diimport
            state.referral_points.entry(referee).write(50_u256);
        });

        assert!(!dispatcher.is_valid_referral(referee), "Should be invalid");

        interact_with_state(dispatcher.contract_address, || {
            let mut state = ReferralSystem::contract_state_for_testing();
            state.referral_points.entry(referee).write(150_u256);
        });

        assert!(dispatcher.is_valid_referral(referee), "Should be valid");
    }

    #[test]
    fn test_claim_bonus_logic() {
        let dispatcher = deploy_referral();
        let referrer: ContractAddress = 0x111.try_into().unwrap();
        let mut spy = spy_events();

        interact_with_state(dispatcher.contract_address, || {
            let mut state = ReferralSystem::contract_state_for_testing();
            state.referral_points.entry(referrer).write(1000_u256);
        });

        start_cheat_caller_address(dispatcher.contract_address, referrer);
        
        let epoch = 1_u64;
        let bonus = dispatcher.claim_referral_bonus(epoch);

        assert!(bonus == 100_u256, "Bonus calculation wrong");

        interact_with_state(dispatcher.contract_address, || {
            let mut state = ReferralSystem::contract_state_for_testing();
            assert!(state.referral_points.entry(referrer).read() == 0, "Points not reset");
        });

        spy.assert_emitted(@array![
            (
                dispatcher.contract_address,
                ReferralSystem::Event::BonusClaimed(
                    BonusClaimed { referrer, amount: 100_u256, epoch }
                )
            )
        ]);

        stop_cheat_caller_address(dispatcher.contract_address);
    }
}