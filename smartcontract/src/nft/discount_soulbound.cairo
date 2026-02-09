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
    fn default() -> DiscountNFT {
        DiscountNFT {
            tier: 0,
            discount_rate: 0,
            max_usage: 0,
            used_in_period: 0,
            // Menggunakan TryInto untuk menggantikan contract_address_const yang deprecated
            owner: 0.try_into().unwrap(),
            last_reset: 0,
        }
    }
}

/// @title Point Storage Interface
/// @author CAREL Team
/// @notice Minimal interface for point balance and consumption.
/// @dev Used to charge points when minting discount NFTs.
#[starknet::interface]
pub trait IPointStorage<TContractState> {
    /// @notice Returns user points for a given epoch.
    /// @dev Read-only helper for eligibility checks.
    /// @param epoch Epoch identifier.
    /// @param user User address.
    /// @return points User points for the epoch.
    fn get_user_points(self: @TContractState, epoch: u64, user: ContractAddress) -> u256;
    /// @notice Consumes user points for a given epoch.
    /// @dev Used to charge points for NFT minting.
    /// @param epoch Epoch identifier.
    /// @param user User address.
    /// @param amount Amount of points to consume.
    fn consume_points(ref self: TContractState, epoch: u64, user: ContractAddress, amount: u256);
}

/// @title Discount Soulbound Interface
/// @author CAREL Team
/// @notice Defines minting and usage for discount NFTs.
/// @dev Soulbound NFTs provide fee discounts with limited uses.
#[starknet::interface]
pub trait IDiscountSoulbound<TContractState> {
    /// @notice Mints a discount NFT for the caller.
    /// @dev Charges points based on tier.
    /// @param tier Tier id to mint.
    fn mint_nft(ref self: TContractState, tier: u8);
    /// @notice Consumes a discount use for a user.
    /// @dev Burns NFT when usage is exhausted.
    /// @param user User address.
    /// @return discount Discount percentage or rate.
    fn use_discount(ref self: TContractState, user: ContractAddress) -> u256;
    /// @notice Consumes multiple discount uses for a user.
    /// @dev Bounded by remaining usage; returns 0 if insufficient.
    /// @param user User address.
    /// @param uses Number of uses to consume.
    /// @return discount Discount percentage or rate.
    fn use_discount_batch(ref self: TContractState, user: ContractAddress, uses: u256) -> u256;
    /// @notice Recharges monthly usage for the caller's NFT.
    /// @dev Consumes points based on tier recharge cost.
    fn recharge_nft(ref self: TContractState);
    /// @notice Returns a user's current discount rate.
    /// @dev Read-only helper for pricing.
    /// @param user User address.
    /// @return discount Discount rate.
    fn get_user_discount(self: @TContractState, user: ContractAddress) -> u256;
    /// @notice Checks if a user has an active discount.
    /// @dev Returns active flag and discount rate.
    /// @param user User address.
    /// @return active_and_discount Tuple of active flag and discount rate.
    fn has_active_discount(self: @TContractState, user: ContractAddress) -> (bool, u256);
    /// @notice Returns NFT metadata by token id.
    /// @dev Read-only helper for UIs.
    /// @param token_id Token id.
    /// @return nft Discount NFT metadata.
    fn get_nft_info(self: @TContractState, token_id: u256) -> DiscountNFT;
}

/// @title Discount Soulbound Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy entrypoints for discount NFT actions.
#[starknet::interface]
pub trait IDiscountSoulboundPrivacy<TContractState> {
    /// @notice Sets privacy router address.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    /// @notice Submits a private NFT action proof.
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

/// @title Soulbound Transfer Interface
/// @author CAREL Team
/// @notice ERC20-like transfer interface overridden to prevent transfers.
/// @dev Ensures NFTs remain non-transferable.
#[starknet::interface]
pub trait ISoulbound<TContractState> {
    /// @notice Attempted transfer (always reverts).
    /// @dev Enforces soulbound behavior.
    /// @param recipient Transfer recipient address.
    /// @param amount Transfer amount (unused).
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256);
}

/// @title Discount Soulbound Admin Interface
/// @author CAREL Team
/// @notice Administrative controls for NFT tiers and epochs.
/// @dev Admin-only updates for configuration.
#[starknet::interface]
pub trait IDiscountSoulboundAdmin<TContractState> {
    /// @notice Sets the current points epoch.
    /// @dev Admin-only to align with reward snapshots.
    /// @param epoch New current epoch.
    fn set_current_epoch(ref self: TContractState, epoch: u64);
    /// @notice Updates tier configuration.
    /// @dev Admin-only to control pricing and usage limits.
    /// @param tier Tier id.
    /// @param cost Points cost for minting.
    /// @param discount Discount rate for the tier.
    /// @param max_usage Max usage count per period.
    /// @param recharge_cost Points cost to recharge usage.
    fn set_tier_config(
        ref self: TContractState,
        tier: u8,
        cost: u256,
        discount: u256,
        max_usage: u256,
        recharge_cost: u256
    );
}

/// @title Discount Soulbound Contract
/// @author CAREL Team
/// @notice Soulbound discount NFTs backed by point spending.
/// @dev Burns NFTs when usage is exhausted (except base tier).
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

    const PERIOD_SECONDS: u64 = 2592000;

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

    /// @notice Initializes the discount NFT contract.
    /// @dev Sets admin, point storage, and default tier configs.
    /// @param point_storage Point storage contract address.
    /// @param epoch Initial epoch for point consumption.
    #[constructor]
    fn constructor(ref self: ContractState, point_storage: ContractAddress, epoch: u64) {
        self.admin.write(get_caller_address());
        self.point_storage_contract.write(point_storage);
        self.current_epoch.write(epoch);
        self.next_token_id.write(1);

        // Recharge model tiers
        self.tier_costs.entry(1).write(5000);
        self.tier_discounts.entry(1).write(5);
        self.tier_max_usage.entry(1).write(30);
        self.tier_recharge_costs.entry(1).write(500);

        self.tier_costs.entry(2).write(15000);
        self.tier_discounts.entry(2).write(10);
        self.tier_max_usage.entry(2).write(40);
        self.tier_recharge_costs.entry(2).write(1500);

        self.tier_costs.entry(3).write(50000);
        self.tier_discounts.entry(3).write(20);
        self.tier_max_usage.entry(3).write(50);
        self.tier_recharge_costs.entry(3).write(5000);

        self.tier_costs.entry(4).write(150000);
        self.tier_discounts.entry(4).write(30);
        self.tier_max_usage.entry(4).write(60);
        self.tier_recharge_costs.entry(4).write(15000);

        self.tier_costs.entry(5).write(500000);
        self.tier_discounts.entry(5).write(40);
        self.tier_max_usage.entry(5).write(100);
        self.tier_recharge_costs.entry(5).write(50000);
    }

    #[abi(embed_v0)]
    impl DiscountSoulboundImpl of super::IDiscountSoulbound<ContractState> {
        /// @notice Mints a discount NFT for the caller.
        /// @dev Charges points based on tier.
        /// @param tier Tier id to mint.
        fn mint_nft(ref self: ContractState, tier: u8) {
            let user = get_caller_address();
            assert!(tier >= 1 && tier <= 5, "Tier tidak valid");

            let existing_id = self.user_nft.entry(user).read();
            if existing_id != 0 {
                panic!("User sudah memiliki NFT");
            }

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

        /// @notice Consumes a discount use for a user.
        /// @dev Enforces monthly usage limits.
        /// @param user User address.
        /// @return discount Discount percentage or rate.
        fn use_discount(ref self: ContractState, user: ContractAddress) -> u256 {
            self.use_discount_batch(user, 1_u256)
        }

        /// @notice Consumes multiple discount uses for a user.
        /// @dev Enforces monthly usage limits in O(1).
        /// @param user User address.
        /// @param uses Number of uses to consume.
        /// @return discount Discount percentage or rate.
        fn use_discount_batch(ref self: ContractState, user: ContractAddress, uses: u256) -> u256 {
            if uses == 0 {
                return 0;
            }

            let token_id = self.user_nft.entry(user).read();
            if token_id == 0 {
                return 0;
            }

            let mut nft = self.nfts.entry(token_id).read();
            let now = get_block_timestamp();
            if now >= nft.last_reset + PERIOD_SECONDS {
                nft.used_in_period = 0;
                nft.last_reset = now;
            }
            let discount = nft.discount_rate;

            if nft.used_in_period + uses > nft.max_usage {
                return 0;
            }

            nft.used_in_period += uses;
            let remaining = nft.max_usage - nft.used_in_period;
            self.nfts.entry(token_id).write(nft);
            self.emit(Event::NFTUsed(NFTUsed { user, token_id, remaining_usage: remaining }));

            discount
        }

        /// @notice Recharges monthly usage for the caller's NFT.
        /// @dev Consumes points based on tier recharge cost.
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

        /// @notice Returns a user's current discount rate.
        /// @dev Read-only helper for pricing.
        /// @param user User address.
        /// @return discount Discount rate.
        fn get_user_discount(self: @ContractState, user: ContractAddress) -> u256 {
            let token_id = self.user_nft.entry(user).read();
            if token_id == 0 {
                return 0;
            }
            let nft = self.nfts.entry(token_id).read();
            let now = get_block_timestamp();
            let used = if now >= nft.last_reset + PERIOD_SECONDS { 0 } else { nft.used_in_period };
            if used >= nft.max_usage { return 0; }
            nft.discount_rate
        }

        /// @notice Checks if a user has an active discount.
        /// @dev Returns active flag and discount rate.
        /// @param user User address.
        /// @return active_and_discount Tuple of active flag and discount rate.
        fn has_active_discount(self: @ContractState, user: ContractAddress) -> (bool, u256) {
            let token_id = self.user_nft.entry(user).read();
            if token_id == 0 {
                return (false, 0);
            }
            let nft = self.nfts.entry(token_id).read();
            let now = get_block_timestamp();
            let used = if now >= nft.last_reset + PERIOD_SECONDS { 0 } else { nft.used_in_period };
            let active = used < nft.max_usage;
            let rate = if active { nft.discount_rate } else { 0 };
            (active, rate)
        }

        /// @notice Returns NFT metadata by token id.
        /// @dev Read-only helper for UIs.
        /// @param token_id Token id.
        /// @return nft Discount NFT metadata.
        fn get_nft_info(self: @ContractState, token_id: u256) -> DiscountNFT {
            self.nfts.entry(token_id).read()
        }
    }

    #[abi(embed_v0)]
    impl DiscountSoulboundAdminImpl of super::IDiscountSoulboundAdmin<ContractState> {
        /// @notice Sets the current points epoch.
        /// @dev Admin-only to align with reward snapshots.
        /// @param epoch New current epoch.
        fn set_current_epoch(ref self: ContractState, epoch: u64) {
            assert!(get_caller_address() == self.admin.read(), "Unauthorized");
            self.current_epoch.write(epoch);
        }

        /// @notice Updates tier configuration.
        /// @dev Admin-only to control pricing and usage limits.
        /// @param tier Tier id.
        /// @param cost Points cost for minting.
        /// @param discount Discount rate for the tier.
        /// @param max_usage Max usage count (0 for unlimited).
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
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            assert!(get_caller_address() == self.admin.read(), "Unauthorized");
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

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
        /// @notice Attempted transfer (always reverts).
        /// @dev Enforces soulbound behavior.
        /// @param recipient Transfer recipient address.
        /// @param amount Transfer amount (unused).
        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            panic!("NFT ini bersifat Soulbound dan tidak dapat dipindahtangankan");
        }
    }
}
