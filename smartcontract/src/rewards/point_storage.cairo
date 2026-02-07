use starknet::ContractAddress;

#[starknet::interface]
pub trait IPointStorage<TContractState> {
    fn submit_points(ref self: TContractState, epoch: u64, user: ContractAddress, points: u256);
    fn finalize_epoch(ref self: TContractState, epoch: u64, total_points: u256);
    fn get_user_points(self: @TContractState, epoch: u64, user: ContractAddress) -> u256;
    fn get_global_points(self: @TContractState, epoch: u64) -> u256;
    fn is_epoch_finalized(self: @TContractState, epoch: u64) -> bool;
}

#[starknet::contract]
pub mod PointStorage {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::storage::*;

    #[storage]
    pub struct Storage {
        pub points: Map<u64, Map<ContractAddress, u256>>,
        pub global_points: Map<u64, u256>,
        pub epoch_finalized: Map<u64, bool>,
        pub backend_signer: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PointsUpdated: PointsUpdated,
        EpochFinalized: EpochFinalized,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PointsUpdated {
        pub epoch: u64,
        pub user: ContractAddress,
        pub points: u256
    }

    #[derive(Drop, starknet::Event)]
    pub struct EpochFinalized {
        pub epoch: u64,
        pub total_points: u256
    }

    #[constructor]
    fn constructor(ref self: ContractState, signer: ContractAddress) {
        self.backend_signer.write(signer);
    }

    #[abi(embed_v0)]
    impl PointStorageImpl of super::IPointStorage<ContractState> {
        fn submit_points(ref self: ContractState, epoch: u64, user: ContractAddress, points: u256) {
            assert!(get_caller_address() == self.backend_signer.read(), "Caller is not authorized");
            assert!(!self.epoch_finalized.entry(epoch).read(), "Epoch already finalized");

            self.points.entry(epoch).entry(user).write(points);
            self.emit(Event::PointsUpdated(PointsUpdated { epoch, user, points }));
        }

        fn finalize_epoch(ref self: ContractState, epoch: u64, total_points: u256) {
            assert!(get_caller_address() == self.backend_signer.read(), "Caller is not authorized");
            assert!(!self.epoch_finalized.entry(epoch).read(), "Epoch already finalized");

            self.global_points.entry(epoch).write(total_points);
            self.epoch_finalized.entry(epoch).write(true);
            self.emit(Event::EpochFinalized(EpochFinalized { epoch, total_points }));
        }

        fn get_user_points(self: @ContractState, epoch: u64, user: ContractAddress) -> u256 {
            self.points.entry(epoch).entry(user).read()
        }

        fn get_global_points(self: @ContractState, epoch: u64) -> u256 {
            self.global_points.entry(epoch).read()
        }

        fn is_epoch_finalized(self: @ContractState, epoch: u64) -> bool {
            self.epoch_finalized.entry(epoch).read()
        }
    }
}