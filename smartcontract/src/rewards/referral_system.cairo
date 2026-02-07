use starknet::ContractAddress;

#[starknet::interface]
pub trait IReferralSystem<TContractState> {
    fn register_referral(ref self: TContractState, referrer: ContractAddress, referee: ContractAddress);
    fn get_referrals(self: @TContractState, referrer: ContractAddress) -> Array<ContractAddress>;
    fn get_referrer(self: @TContractState, referee: ContractAddress) -> ContractAddress;
    fn is_valid_referral(self: @TContractState, referee: ContractAddress) -> bool;
    fn calculate_referral_bonus(self: @TContractState, referee_points: u256) -> u256;
    fn claim_referral_bonus(ref self: TContractState, epoch: u64) -> u256;
}

#[starknet::contract]
pub mod ReferralSystem {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::get_caller_address;
    // Impor trait Zero untuk mengaktifkan metode .is_zero() pada ContractAddress
    use core::num::traits::Zero;

    #[storage]
    pub struct Storage {
        pub referral_list: Map<(ContractAddress, u64), ContractAddress>,
        pub referral_count: Map<ContractAddress, u64>,
        pub referrer_of: Map<ContractAddress, ContractAddress>,
        pub referral_points: Map<ContractAddress, u256>,
        pub min_referee_activity: u256,
        pub referral_bonus_rate: u256,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        ReferralRegistered: ReferralRegistered,
        BonusClaimed: BonusClaimed,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ReferralRegistered {
        pub referrer: ContractAddress,
        pub referee: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct BonusClaimed {
        pub referrer: ContractAddress,
        pub amount: u256,
        pub epoch: u64,
    }

    #[constructor]
    fn constructor(ref self: ContractState) {
        self.min_referee_activity.write(100_u256);
        self.referral_bonus_rate.write(1000_u256); // 10%
    }

    #[abi(embed_v0)]
    pub impl ReferralSystemImpl of super::IReferralSystem<ContractState> {
        fn register_referral(ref self: ContractState, referrer: ContractAddress, referee: ContractAddress) {
            // Penggunaan .is_zero() sekarang valid karena trait Zero telah diimpor
            assert!(self.referrer_of.entry(referee).read().is_zero(), "Referee already has a referrer");
            assert!(referrer != referee, "Cannot refer yourself");

            self.referrer_of.entry(referee).write(referrer);
            
            let count = self.referral_count.entry(referrer).read();
            self.referral_list.entry((referrer, count)).write(referee);
            self.referral_count.entry(referrer).write(count + 1);

            self.emit(Event::ReferralRegistered(ReferralRegistered { referrer, referee }));
        }

        fn get_referrals(self: @ContractState, referrer: ContractAddress) -> Array<ContractAddress> {
            let count = self.referral_count.entry(referrer).read();
            let mut referrals = array![];
            let mut i: u64 = 0;
            while i < count {
                referrals.append(self.referral_list.entry((referrer, i)).read());
                i += 1;
            };
            referrals
        }

        fn get_referrer(self: @ContractState, referee: ContractAddress) -> ContractAddress {
            self.referrer_of.entry(referee).read()
        }

        fn is_valid_referral(self: @ContractState, referee: ContractAddress) -> bool {
            let points = self.referral_points.entry(referee).read();
            points >= self.min_referee_activity.read()
        }

        fn calculate_referral_bonus(self: @ContractState, referee_points: u256) -> u256 {
            (referee_points * self.referral_bonus_rate.read()) / 10000
        }

        fn claim_referral_bonus(ref self: ContractState, epoch: u64) -> u256 {
            let caller = get_caller_address();
            let available_points = self.referral_points.entry(caller).read();
            assert!(available_points > 0, "No points to claim");

            let bonus = self.calculate_referral_bonus(available_points);
            
            self.referral_points.entry(caller).write(0);

            self.emit(Event::BonusClaimed(BonusClaimed { referrer: caller, amount: bonus, epoch }));
            bonus
        }
    }
}