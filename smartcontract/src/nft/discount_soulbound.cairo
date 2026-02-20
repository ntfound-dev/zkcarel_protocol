use starknet::ContractAddress;

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct DiscountNFT {
    pub tier: u8,
    pub discount_rate: u256,
    pub max_usage: u256,
    pub used_in_period: u256,
    pub owner: ContractAddress,
    pub last_reset: u64,
}

impl DiscountNFTDefault of Default<DiscountNFT> {
    // Implements default logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn default() -> DiscountNFT {
        DiscountNFT {
            tier: 0,
            discount_rate: 0,
            max_usage: 0,
            used_in_period: 0,
            // Uses TryInto instead of deprecated contract_address_const helper.
            owner: 0.try_into().unwrap(),
            last_reset: 0,
        }
    }
}

// Minimal interface for point balance and consumption.
// Used to charge points when minting discount NFTs.
#[starknet::interface]
pub trait IPointStorage<TContractState> {
    // Returns get user points from state without mutating storage.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn get_user_points(self: @TContractState, epoch: u64, user: ContractAddress) -> u256;
    // Applies consume points after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn consume_points(ref self: TContractState, epoch: u64, user: ContractAddress, amount: u256);
}

// Defines minting and usage for discount NFTs.
// Soulbound NFTs provide fee discounts with limited uses.
#[starknet::interface]
pub trait IDiscountSoulbound<TContractState> {
    // Applies mint nft after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn mint_nft(ref self: TContractState, tier: u8);
    // Implements use discount logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn use_discount(ref self: TContractState, user: ContractAddress) -> u256;
    // Implements use discount batch logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn use_discount_batch(ref self: TContractState, user: ContractAddress, uses: u256) -> u256;
    // Implements recharge nft logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn recharge_nft(ref self: TContractState);
    // Returns get user discount from state without mutating storage.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn get_user_discount(self: @TContractState, user: ContractAddress) -> u256;
    // Returns has active discount from state without mutating storage.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn has_active_discount(self: @TContractState, user: ContractAddress) -> (bool, u256);
    // Returns get nft info from state without mutating storage.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn get_nft_info(self: @TContractState, token_id: u256) -> DiscountNFT;
}

// ZK privacy entrypoints for discount NFT actions.
#[starknet::interface]
pub trait IDiscountSoulboundPrivacy<TContractState> {
    // Updates privacy router configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    // Applies submit private nft action after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn submit_private_nft_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

// ERC20-like transfer interface overridden to prevent transfers.
// Ensures NFTs remain non-transferable.
#[starknet::interface]
pub trait ISoulbound<TContractState> {
    // Applies transfer after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256);
}

// Administrative controls for NFT tiers and epochs.
// Admin-only updates for configuration.
#[starknet::interface]
pub trait IDiscountSoulboundAdmin<TContractState> {
    // Updates current epoch configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_current_epoch(ref self: TContractState, epoch: u64);
    // Updates tier config configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_tier_config(
        ref self: TContractState,
        tier: u8,
        cost: u256,
        discount: u256,
        max_usage: u256,
        recharge_cost: u256
    );
}

// Soulbound discount NFTs backed by point spending.
// NFTs are not burned on usage exhaustion and become inactive until recharge or remint.
#[starknet::contract]
pub mod DiscountSoulbound {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use starknet::storage::*;
    use core::num::traits::Zero;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_NFT;
    use super::{DiscountNFT, IPointStorageDispatcher, IPointStorageDispatcherTrait};

    #[storage]
    pub struct Storage {
        pub nfts: Map<u256, DiscountNFT>,
        pub user_nft: Map<ContractAddress, u256>,
        pub tier_costs: Map<u8, u256>,
        pub tier_discounts: Map<u8, u256>,
        pub tier_max_usage: Map<u8, u256>,
        pub tier_recharge_costs: Map<u8, u256>,
        pub point_storage_contract: ContractAddress,
        pub next_token_id: u256,
        pub current_epoch: u64,
        pub admin: ContractAddress,
        pub privacy_router: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        NFTMinted: NFTMinted,
        NFTUsed: NFTUsed,
        NFTDeactivated: NFTDeactivated,
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
    pub struct NFTDeactivated {
        pub user: ContractAddress,
        pub token_id: u256,
        pub used_in_period: u256,
        pub max_usage: u256
    }

    // Initializes the discount NFT contract.
    // Sets admin, point storage, and default tier configs.
    // `point_storage` tracks point balances and `epoch` sets initial accounting period.
    #[constructor]
    // Initializes storage and role configuration during deployment.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn constructor(ref self: ContractState, point_storage: ContractAddress, epoch: u64) {
        self.admin.write(get_caller_address());
        self.point_storage_contract.write(point_storage);
        self.current_epoch.write(epoch);
        self.next_token_id.write(1);

        // Tier configuration used by discount and usage policies:
        // Bronze 5% (5 use), Silver 10% (7), Gold 25% (10), Platinum 35% (15), Onyx 50% (20).
        self.tier_costs.entry(1).write(5000);
        self.tier_discounts.entry(1).write(5);
        self.tier_max_usage.entry(1).write(5);
        self.tier_recharge_costs.entry(1).write(0);

        self.tier_costs.entry(2).write(15000);
        self.tier_discounts.entry(2).write(10);
        self.tier_max_usage.entry(2).write(7);
        self.tier_recharge_costs.entry(2).write(0);

        self.tier_costs.entry(3).write(50000);
        self.tier_discounts.entry(3).write(25);
        self.tier_max_usage.entry(3).write(10);
        self.tier_recharge_costs.entry(3).write(0);

        self.tier_costs.entry(4).write(150000);
        self.tier_discounts.entry(4).write(35);
        self.tier_max_usage.entry(4).write(15);
        self.tier_recharge_costs.entry(4).write(0);

        self.tier_costs.entry(5).write(500000);
        self.tier_discounts.entry(5).write(50);
        self.tier_max_usage.entry(5).write(20);
        self.tier_recharge_costs.entry(5).write(0);
    }

    #[abi(embed_v0)]
    impl DiscountSoulboundImpl of super::IDiscountSoulbound<ContractState> {
        // Applies mint nft after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn mint_nft(ref self: ContractState, tier: u8) {
            let user = get_caller_address();
            assert!(tier >= 1 && tier <= 5, "Tier tidak valid");

            // Unlimited mint allowed: user dapat mint lagi kapan pun selama points cukup.
            // Mapping user_nft akan menunjuk NFT terakhir yang aktif.

            let cost = self.tier_costs.entry(tier).read();
            let point_dispatcher = IPointStorageDispatcher { 
                contract_address: self.point_storage_contract.read() 
            };

            if cost > 0 {
                let epoch = self.current_epoch.read();
                point_dispatcher.consume_points(epoch, user, cost);
            }

            let token_id = self.next_token_id.read();
            let nft = DiscountNFT {
                tier: tier,
                discount_rate: self.tier_discounts.entry(tier).read(),
                max_usage: self.tier_max_usage.entry(tier).read(),
                used_in_period: 0,
                owner: user,
                last_reset: get_block_timestamp(),
            };

            self.nfts.entry(token_id).write(nft);
            self.user_nft.entry(user).write(token_id);
            self.next_token_id.write(token_id + 1);

            self.emit(Event::NFTMinted(NFTMinted { user, token_id, tier }));
        }

        // Implements use discount logic while keeping state transitions deterministic.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn use_discount(ref self: ContractState, user: ContractAddress) -> u256 {
            self.use_discount_batch(user, 1_u256)
        }

        // Implements use discount batch logic while keeping state transitions deterministic.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn use_discount_batch(ref self: ContractState, user: ContractAddress, uses: u256) -> u256 {
            if uses == 0 {
                return 0;
            }

            let token_id = self.user_nft.entry(user).read();
            if token_id == 0 {
                return 0;
            }

            let mut nft = self.nfts.entry(token_id).read();
            let discount = nft.discount_rate;

            if nft.used_in_period + uses > nft.max_usage {
                return 0;
            }

            nft.used_in_period += uses;
            let remaining = nft.max_usage - nft.used_in_period;
            self.nfts.entry(token_id).write(nft);
            self.emit(Event::NFTUsed(NFTUsed { user, token_id, remaining_usage: remaining }));
            if remaining == 0 {
                self.emit(Event::NFTDeactivated(NFTDeactivated {
                    user,
                    token_id,
                    used_in_period: nft.used_in_period,
                    max_usage: nft.max_usage
                }));
            }

            discount
        }

        // Implements recharge nft logic while keeping state transitions deterministic.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn recharge_nft(ref self: ContractState) {
            let user = get_caller_address();
            let token_id = self.user_nft.entry(user).read();
            assert!(token_id != 0, "NFT not found");

            let mut nft = self.nfts.entry(token_id).read();
            let cost = self.tier_recharge_costs.entry(nft.tier).read();
            assert!(cost > 0, "Recharge not available");

            let point_dispatcher = IPointStorageDispatcher {
                contract_address: self.point_storage_contract.read()
            };
            let epoch = self.current_epoch.read();
            point_dispatcher.consume_points(epoch, user, cost);

            nft.used_in_period = 0;
            nft.last_reset = get_block_timestamp();
            self.nfts.entry(token_id).write(nft);
        }

        // Returns get user discount from state without mutating storage.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn get_user_discount(self: @ContractState, user: ContractAddress) -> u256 {
            let token_id = self.user_nft.entry(user).read();
            if token_id == 0 {
                return 0;
            }
            let nft = self.nfts.entry(token_id).read();
            if nft.used_in_period >= nft.max_usage { return 0; }
            nft.discount_rate
        }

        // Returns has active discount from state without mutating storage.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn has_active_discount(self: @ContractState, user: ContractAddress) -> (bool, u256) {
            let token_id = self.user_nft.entry(user).read();
            if token_id == 0 {
                return (false, 0);
            }
            let nft = self.nfts.entry(token_id).read();
            let active = nft.used_in_period < nft.max_usage;
            let rate = if active { nft.discount_rate } else { 0 };
            (active, rate)
        }

        // Returns get nft info from state without mutating storage.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn get_nft_info(self: @ContractState, token_id: u256) -> DiscountNFT {
            self.nfts.entry(token_id).read()
        }
    }

    #[abi(embed_v0)]
    impl DiscountSoulboundAdminImpl of super::IDiscountSoulboundAdmin<ContractState> {
        // Updates current epoch configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_current_epoch(ref self: ContractState, epoch: u64) {
            assert!(get_caller_address() == self.admin.read(), "Unauthorized");
            self.current_epoch.write(epoch);
        }

        // Updates tier config configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_tier_config(
            ref self: ContractState,
            tier: u8,
            cost: u256,
            discount: u256,
            max_usage: u256,
            recharge_cost: u256
        ) {
            assert!(get_caller_address() == self.admin.read(), "Unauthorized");
            self.tier_costs.entry(tier).write(cost);
            self.tier_discounts.entry(tier).write(discount);
            self.tier_max_usage.entry(tier).write(max_usage);
            self.tier_recharge_costs.entry(tier).write(recharge_cost);
        }
    }

    #[abi(embed_v0)]
    impl DiscountSoulboundPrivacyImpl of super::IDiscountSoulboundPrivacy<ContractState> {
        // Updates privacy router configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            assert!(get_caller_address() == self.admin.read(), "Unauthorized");
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        // Applies submit private nft action after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn submit_private_nft_action(
            ref self: ContractState,
            old_root: felt252,
            new_root: felt252,
            nullifiers: Span<felt252>,
            commitments: Span<felt252>,
            public_inputs: Span<felt252>,
            proof: Span<felt252>
        ) {
            let router = self.privacy_router.read();
            assert!(!router.is_zero(), "Privacy router not set");
            let dispatcher = IPrivacyRouterDispatcher { contract_address: router };
            dispatcher.submit_action(
                ACTION_NFT,
                old_root,
                new_root,
                nullifiers,
                commitments,
                public_inputs,
                proof
            );
        }
    }

    #[abi(embed_v0)]
    impl SoulboundTransferImpl of super::ISoulbound<ContractState> {
        // Applies transfer after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            panic!("NFT ini bersifat Soulbound dan tidak dapat dipindahtangankan");
        }
    }
}
