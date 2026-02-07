use starknet::ContractAddress;

// Definisi kategori vesting dengan default variant untuk Storage
#[derive(Drop, Serde, Copy, starknet::Store, PartialEq)]
pub enum VestingCategory {
    #[default]
    Investor,
    Tim,
    Marketing,
    Listing
}

#[derive(Drop, Serde, Copy, starknet::Store)]
pub struct VestingSchedule {
    pub total_amount: u256,
    pub released_amount: u256,
    pub start_time: u64,
    pub cliff_duration: u64,
    pub vesting_duration: u64,
    pub category: VestingCategory,
    pub is_paused: bool,
}

#[starknet::interface]
pub trait IVestingManager<TContractState> {
    fn create_vesting(
        ref self: TContractState,
        beneficiary: ContractAddress,
        amount: u256,
        category: VestingCategory,
        cliff_duration: u64,
        vesting_duration: u64
    );
    fn release(ref self: TContractState, beneficiary: ContractAddress);
    fn pause_vesting(ref self: TContractState, beneficiary: ContractAddress, paused: bool);
    fn calculate_releasable(self: @TContractState, beneficiary: ContractAddress) -> u256;
    fn get_vesting_info(self: @TContractState, beneficiary: ContractAddress) -> VestingSchedule;
}

#[starknet::interface]
pub trait ICarelToken<TContractState> {
    fn mint(ref self: TContractState, recipient: ContractAddress, amount: u256);
}

#[starknet::contract]
pub mod VestingManager {
    use super::{VestingSchedule, VestingCategory, ICarelTokenDispatcher, ICarelTokenDispatcherTrait};
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::get_block_timestamp;
    
    // Perbaikan path import OpenZeppelin
    use openzeppelin::access::ownable::OwnableComponent;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub token_address: ContractAddress,
        pub vesting_schedules: Map<ContractAddress, VestingSchedule>,
        pub total_allocated: u256,
        pub start_time: u64,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        VestingCreated: VestingCreated,
        TokensReleased: TokensReleased,
        VestingPaused: VestingPaused,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct VestingCreated {
        pub beneficiary: ContractAddress,
        pub amount: u256,
        pub category: VestingCategory
    }

    #[derive(Drop, starknet::Event)]
    pub struct TokensReleased {
        pub beneficiary: ContractAddress,
        pub amount: u256
    }

    #[derive(Drop, starknet::Event)]
    pub struct VestingPaused {
        pub beneficiary: ContractAddress,
        pub paused: bool
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        token: ContractAddress,
        protocol_start: u64
    ) {
        self.ownable.initializer(admin);
        self.token_address.write(token);
        self.start_time.write(protocol_start);
    }

    #[abi(embed_v0)]
    impl VestingManagerImpl of super::IVestingManager<ContractState> {
        fn create_vesting(
            ref self: ContractState,
            beneficiary: ContractAddress,
            amount: u256,
            category: VestingCategory,
            cliff_duration: u64,
            vesting_duration: u64
        ) {
            self.ownable.assert_only_owner();
            
            let schedule = VestingSchedule {
                total_amount: amount,
                released_amount: 0,
                start_time: self.start_time.read(),
                cliff_duration,
                vesting_duration,
                category,
                is_paused: false,
            };

            self.vesting_schedules.entry(beneficiary).write(schedule);
            self.total_allocated.write(self.total_allocated.read() + amount);

            // Perbaikan emisi event: Bungkus struct dalam varian enum
            self.emit(Event::VestingCreated(VestingCreated { beneficiary, amount, category }));
        }

        fn release(ref self: ContractState, beneficiary: ContractAddress) {
            let mut schedule = self.vesting_schedules.entry(beneficiary).read();
            assert!(!schedule.is_paused, "Vesting is paused");
            
            let releasable = self.calculate_releasable(beneficiary);
            assert!(releasable > 0, "Nothing to release");

            schedule.released_amount += releasable;
            self.vesting_schedules.entry(beneficiary).write(schedule);

            let token_dispatcher = ICarelTokenDispatcher { contract_address: self.token_address.read() };
            token_dispatcher.mint(beneficiary, releasable);

            self.emit(Event::TokensReleased(TokensReleased { beneficiary, amount: releasable }));
        }

        fn pause_vesting(ref self: ContractState, beneficiary: ContractAddress, paused: bool) {
            self.ownable.assert_only_owner();
            let mut schedule = self.vesting_schedules.entry(beneficiary).read();
            schedule.is_paused = paused;
            self.vesting_schedules.entry(beneficiary).write(schedule);
            
            self.emit(Event::VestingPaused(VestingPaused { beneficiary, paused }));
        }

        fn calculate_releasable(self: @ContractState, beneficiary: ContractAddress) -> u256 {
            let schedule = self.vesting_schedules.entry(beneficiary).read();
            let current_time = get_block_timestamp();

            if current_time < schedule.start_time + schedule.cliff_duration {
                return 0;
            }

            if current_time >= schedule.start_time + schedule.vesting_duration {
                return schedule.total_amount - schedule.released_amount;
            }

            let elapsed = current_time - schedule.start_time;
            let vested = (schedule.total_amount * elapsed.into()) / schedule.vesting_duration.into();
            
            vested - schedule.released_amount
        }

        fn get_vesting_info(self: @ContractState, beneficiary: ContractAddress) -> VestingSchedule {
            self.vesting_schedules.entry(beneficiary).read()
        }
    }
}