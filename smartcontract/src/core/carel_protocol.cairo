use starknet::ContractAddress;

#[starknet::interface]
pub trait ICarelProtocol<TContractState> {
    fn swap(ref self: TContractState, amount: u256, token_from: ContractAddress, token_to: ContractAddress);
    fn stake_btc(ref self: TContractState, amount: u256, wrapper: ContractAddress);
    fn get_active_tokens(self: @TContractState) -> Array<ContractAddress>;
}

#[starknet::contract]
pub mod CarelProtocol {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;

    #[storage]
    pub struct Storage {
        active_wrappers: Map<ContractAddress, bool>,
        supported_tokens: Vec<ContractAddress>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        SwapExecuted: SwapExecuted,
        BTCStaked: BTCStaked,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SwapExecuted {
        #[key]
        pub user: ContractAddress,
        pub amount: u256,
        pub token_from: ContractAddress,
        pub token_to: ContractAddress,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct BTCStaked {
        #[key]
        pub user: ContractAddress,
        pub amount: u256,
        pub wrapper: ContractAddress,
        pub timestamp: u64,
    }

    #[abi(embed_v0)]
    pub impl CarelProtocolImpl of super::ICarelProtocol<ContractState> {
        fn swap(ref self: ContractState, amount: u256, token_from: ContractAddress, token_to: ContractAddress) {
            let caller = get_caller_address();
            let ts = get_block_timestamp();
            
            self.emit(Event::SwapExecuted(SwapExecuted { 
                user: caller, 
                amount, 
                token_from, 
                token_to, 
                timestamp: ts 
            }));
        }

        fn stake_btc(ref self: ContractState, amount: u256, wrapper: ContractAddress) {
            let caller = get_caller_address();
            let ts = get_block_timestamp();

            self.emit(Event::BTCStaked(BTCStaked { 
                user: caller, 
                amount, 
                wrapper, 
                timestamp: ts 
            }));
        }

        fn get_active_tokens(self: @ContractState) -> Array<ContractAddress> {
            let mut active = array![];
            for i in 0..self.supported_tokens.len() {
                let token = self.supported_tokens.at(i).read();
                if self.active_wrappers.entry(token).read() {
                    active.append(token);
                }
            };
            active
        }
    }
}