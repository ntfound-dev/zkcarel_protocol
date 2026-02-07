use starknet::ContractAddress;

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct DiscountNFT {
    pub tier: u8,
    pub discount_rate: u256,
    pub max_usage: u256,
    pub current_usage: u256,
    pub owner: ContractAddress,
}

impl DiscountNFTDefault of Default<DiscountNFT> {
    fn default() -> DiscountNFT {
        DiscountNFT {
            tier: 0,
            discount_rate: 0,
            max_usage: 0,
            current_usage: 0,
            // Menggunakan TryInto untuk menggantikan contract_address_const yang deprecated
            owner: 0.try_into().unwrap(),
        }
    }
}

#[starknet::interface]
pub trait IPointStorage<TContractState> {
    fn get_user_points(self: @TContractState, epoch: u64, user: ContractAddress) -> u256;
    fn consume_points(ref self: TContractState, user: ContractAddress, amount: u256);
}

#[starknet::interface]
pub trait IDiscountSoulbound<TContractState> {
    fn mint_nft(ref self: TContractState, tier: u8);
    fn use_discount(ref self: TContractState, user: ContractAddress) -> u256;
    fn get_user_discount(self: @TContractState, user: ContractAddress) -> u256;
    fn get_nft_info(self: @TContractState, token_id: u256) -> DiscountNFT;
}

#[starknet::interface]
pub trait ISoulbound<TContractState> {
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256);
}

#[starknet::contract]
pub mod DiscountSoulbound {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::storage::*;
    use super::{DiscountNFT, IPointStorageDispatcher, IPointStorageDispatcherTrait};

    #[storage]
    pub struct Storage {
        pub nfts: Map<u256, DiscountNFT>,
        pub user_nft: Map<ContractAddress, u256>,
        pub tier_costs: Map<u8, u256>,
        pub tier_discounts: Map<u8, u256>,
        pub tier_max_usage: Map<u8, u256>,
        pub point_storage_contract: ContractAddress,
        pub next_token_id: u256,
        pub current_epoch: u64,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        NFTMinted: NFTMinted,
        NFTUsed: NFTUsed,
        NFTBurned: NFTBurned,
    }

    #[derive(Drop, starknet::Event)]
    pub struct NFTMinted {
        pub user: ContractAddress,
        pub token_id: u256,
        pub tier: u8
    }

    #[derive(Drop, starknet::Event)]
    pub struct NFTUsed {
        pub user: ContractAddress,
        pub token_id: u256,
        pub remaining_usage: u256
    }

    #[derive(Drop, starknet::Event)]
    pub struct NFTBurned {
        pub user: ContractAddress,
        pub token_id: u256
    }

    #[constructor]
    fn constructor(ref self: ContractState, point_storage: ContractAddress, epoch: u64) {
        self.point_storage_contract.write(point_storage);
        self.current_epoch.write(epoch);
        self.next_token_id.write(1);

        self.tier_costs.entry(1).write(5000);
        self.tier_discounts.entry(1).write(5);
        self.tier_max_usage.entry(1).write(5);

        self.tier_costs.entry(2).write(15000);
        self.tier_discounts.entry(2).write(10);
        self.tier_max_usage.entry(2).write(7);

        self.tier_costs.entry(3).write(50000);
        self.tier_discounts.entry(3).write(25);
        self.tier_max_usage.entry(3).write(10);

        self.tier_costs.entry(4).write(150000);
        self.tier_discounts.entry(4).write(35);
        self.tier_max_usage.entry(4).write(15);

        self.tier_costs.entry(5).write(500000);
        self.tier_discounts.entry(5).write(50);
        self.tier_max_usage.entry(5).write(20);
    }

    #[abi(embed_v0)]
    impl DiscountSoulboundImpl of super::IDiscountSoulbound<ContractState> {
        fn mint_nft(ref self: ContractState, tier: u8) {
            let user = get_caller_address();
            assert!(tier > 0 && tier <= 5, "Tier tidak valid");
            assert!(self.user_nft.entry(user).read() == 0, "User sudah memiliki NFT");

            let cost = self.tier_costs.entry(tier).read();
            let point_dispatcher = IPointStorageDispatcher { 
                contract_address: self.point_storage_contract.read() 
            };

            point_dispatcher.consume_points(user, cost);

            let token_id = self.next_token_id.read();
            let nft = DiscountNFT {
                tier: tier,
                discount_rate: self.tier_discounts.entry(tier).read(),
                max_usage: self.tier_max_usage.entry(tier).read(),
                current_usage: self.tier_max_usage.entry(tier).read(),
                owner: user,
            };

            self.nfts.entry(token_id).write(nft);
            self.user_nft.entry(user).write(token_id);
            self.next_token_id.write(token_id + 1);

            self.emit(Event::NFTMinted(NFTMinted { user, token_id, tier }));
        }

        fn use_discount(ref self: ContractState, user: ContractAddress) -> u256 {
            let token_id = self.user_nft.entry(user).read();
            if token_id == 0 {
                return 0;
            }

            let mut nft = self.nfts.entry(token_id).read();
            let discount = nft.discount_rate;

            nft.current_usage -= 1;

            if nft.current_usage == 0 {
                self.nfts.entry(token_id).write(Default::default());
                self.user_nft.entry(user).write(0);
                self.emit(Event::NFTBurned(NFTBurned { user, token_id }));
            } else {
                self.nfts.entry(token_id).write(nft);
                self.emit(Event::NFTUsed(NFTUsed { user, token_id, remaining_usage: nft.current_usage }));
            }

            discount
        }

        fn get_user_discount(self: @ContractState, user: ContractAddress) -> u256 {
            let token_id = self.user_nft.entry(user).read();
            if token_id == 0 {
                return 0;
            }
            self.nfts.entry(token_id).read().discount_rate
        }

        fn get_nft_info(self: @ContractState, token_id: u256) -> DiscountNFT {
            self.nfts.entry(token_id).read()
        }
    }

    #[abi(embed_v0)]
    impl SoulboundTransferImpl of super::ISoulbound<ContractState> {
        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            panic!("NFT ini bersifat Soulbound dan tidak dapat dipindahtangankan");
        }
    }
}