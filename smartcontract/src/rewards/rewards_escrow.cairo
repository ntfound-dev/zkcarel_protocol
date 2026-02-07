use starknet::ContractAddress;

#[derive(Copy, Clone, Drop, Serde, starknet::Store)]
pub struct Escrow {
    pub user: ContractAddress,
    pub total_amount: u256,
    pub released_amount: u256,
    pub start_time: u64,
    pub vesting_duration: u64,
}

#[starknet::interface]
pub trait IRewardsEscrow<TContractState> {
    fn create_escrow(ref self: TContractState, user: ContractAddress, amount: u256);
    fn release_vested(ref self: TContractState, user: ContractAddress);
    fn get_releasable(self: @TContractState, user: ContractAddress) -> u256;
    fn emergency_release(ref self: TContractState, user: ContractAddress) -> u256;
}

#[starknet::contract]
pub mod RewardsEscrow {
    use starknet::ContractAddress;
    use starknet::storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess, StoragePathEntry};
    use starknet::get_block_timestamp;
    use super::Escrow;

    const THIRTY_DAYS: u64 = 2592000;

    #[storage]
    pub struct Storage {
        pub escrows: Map<ContractAddress, Escrow>,
    }

    #[abi(embed_v0)]
    impl RewardsEscrowImpl of super::IRewardsEscrow<ContractState> {
        fn create_escrow(ref self: ContractState, user: ContractAddress, amount: u256) {
            let start_time = get_block_timestamp();
            let new_escrow = Escrow {
                user,
                total_amount: amount,
                released_amount: 0,
                start_time,
                vesting_duration: THIRTY_DAYS,
            };
            self.escrows.entry(user).write(new_escrow);
        }

        fn get_releasable(self: @ContractState, user: ContractAddress) -> u256 {
            let escrow = self.escrows.entry(user).read();
            if escrow.total_amount == 0 {
                return 0;
            }

            let current_time = get_block_timestamp();
            let end_time = escrow.start_time + escrow.vesting_duration;

            let vested_amount = if current_time >= end_time {
                escrow.total_amount
            } else if current_time <= escrow.start_time {
                0
            } else {
                (escrow.total_amount * (current_time - escrow.start_time).into()) 
                / escrow.vesting_duration.into()
            };

            vested_amount - escrow.released_amount
        }

        fn release_vested(ref self: ContractState, user: ContractAddress) {
            let mut escrow = self.escrows.entry(user).read();
            let releasable = self.get_releasable(user);
            
            assert!(releasable > 0, "No tokens to release");

            escrow.released_amount += releasable;
            self.escrows.entry(user).write(escrow);
        }

        fn emergency_release(ref self: ContractState, user: ContractAddress) -> u256 {
            let mut escrow = self.escrows.entry(user).read();
            assert!(escrow.total_amount > 0, "No active escrow");

            let remaining_balance = escrow.total_amount - escrow.released_amount;
            let penalty = (remaining_balance * 10) / 100;
            let payout = remaining_balance - penalty;

            // Bersihkan state escrow setelah penarikan darurat
            let cleared_escrow = Escrow {
                user: escrow.user,
                total_amount: 0,
                released_amount: 0,
                start_time: 0,
                vesting_duration: 0,
            };
            self.escrows.entry(user).write(cleared_escrow);

            payout
        }
    }
}