use starknet::ContractAddress;

/// @notice On-chain state for a single discount NFT token.
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
            owner: 0.try_into().unwrap(),
            last_reset: 0,
        }
    }
}

/// @title IPointStorage
/// @notice Minimal interface for point balance and consumption.
#[starknet::interface]
pub trait IPointStorage<TContractState> {
    /// @notice Returns the point balance for a user in a given epoch.
    /// @param epoch The accounting epoch.
    /// @param user The address to query.
    /// @return Point balance.
    fn get_user_points(self: @TContractState, epoch: u64, user: ContractAddress) -> u256;

    /// @notice Deducts points from a user's balance in a given epoch.
    /// @param epoch The accounting epoch.
    /// @param user The address to deduct from.
    /// @param amount Points to consume.
    fn consume_points(ref self: TContractState, epoch: u64, user: ContractAddress, amount: u256);
}

/// @title IDiscountSoulbound
/// @notice Minting and usage lifecycle for soulbound discount NFTs.
#[starknet::interface]
pub trait IDiscountSoulbound<TContractState> {
    /// @notice Mints a discount NFT for the caller at the given tier.
    /// @dev Consumes tier cost in points. Maps caller to the new token ID.
    ///      Multiple mints are allowed; `user_nft` tracks the latest token.
    /// @param tier Tier index 1–5 (Bronze, Silver, Gold, Platinum, Onyx).
    fn mint_nft(ref self: TContractState, tier: u8);

    /// @notice Applies a single discount usage for a user.
    /// @dev Shorthand for `use_discount_batch(user, 1)`.
    /// @param user Address whose NFT to consume.
    /// @return The discount rate applied, or 0 if no active NFT.
    fn use_discount(ref self: TContractState, user: ContractAddress) -> u256;

    /// @notice Applies multiple discount usages for a user in one call.
    /// @dev Callable by the user themselves or an authorized caller.
    ///      Returns 0 without reverting if the NFT is exhausted.
    /// @param user Address whose NFT to consume.
    /// @param uses Number of usages to deduct.
    /// @return The discount rate applied, or 0 if NFT is unavailable or exhausted.
    fn use_discount_batch(ref self: TContractState, user: ContractAddress, uses: u256) -> u256;

    /// @notice Recharges the caller's NFT usage quota for the current epoch.
    /// @dev Consumes the tier's recharge cost in points. Reverts if cooldown has not passed.
    fn recharge_nft(ref self: TContractState);

    /// @notice Returns the active discount rate for a user.
    /// @param user The address to query.
    /// @return Discount rate, or 0 if no active NFT.
    fn get_user_discount(self: @TContractState, user: ContractAddress) -> u256;

    /// @notice Returns whether a user has an active discount and its rate.
    /// @param user The address to query.
    /// @return (active, discount_rate).
    fn has_active_discount(self: @TContractState, user: ContractAddress) -> (bool, u256);

    /// @notice Returns the full NFT struct for a given token ID.
    /// @param token_id The token to query.
    /// @return The `DiscountNFT` struct.
    fn get_nft_info(self: @TContractState, token_id: u256) -> DiscountNFT;

    /// @notice Grants or revokes authorization for a caller to consume discounts on behalf of users.
    /// @dev Callable only by the contract owner.
    /// @param caller Address to authorize or deauthorize.
    /// @param authorized true to authorize, false to revoke.
    fn set_authorized_caller(ref self: TContractState, caller: ContractAddress, authorized: bool);
}

/// @title IDiscountSoulboundMetadata
/// @notice Metadata resolution for soulbound NFT tokens.
#[starknet::interface]
pub trait IDiscountSoulboundMetadata<TContractState> {
    /// @notice Returns the metadata URI for a given token ID.
    /// @param token_id The token to query.
    /// @return Tier URI string.
    fn token_uri(self: @TContractState, token_id: u256) -> ByteArray;

    /// @notice Returns the base URI used for metadata resolution.
    /// @return Base URI string.
    fn get_base_uri(self: @TContractState) -> ByteArray;
}

/// @title IDiscountSoulboundPrivacy
/// @notice ZK privacy entrypoints for discount NFT actions.
#[starknet::interface]
pub trait IDiscountSoulboundPrivacy<TContractState> {
    /// @notice Sets the privacy router address.
    /// @dev Callable only by the contract owner. Emits `PrivacyRouterUpdated`.
    /// @param router New privacy router address (must be non-zero).
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);

    /// @notice Submits a ZK-proven NFT action to the privacy router.
    /// @dev Nullifiers are replay-protected: each nullifier may only be consumed once.
    /// @param old_root Previous Merkle tree root.
    /// @param new_root Updated Merkle tree root after commitments.
    /// @param nullifiers Nullifiers for inputs being spent.
    /// @param commitments New Merkle commitments.
    /// @param public_inputs ZK circuit public inputs.
    /// @param proof Serialized ZK proof.
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

/// @title ISoulbound
/// @notice ERC20-like transfer override — always reverts to enforce non-transferability.
#[starknet::interface]
pub trait ISoulbound<TContractState> {
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256);
}

/// @title IDiscountSoulboundAdmin
/// @notice Owner-only administrative controls for NFT tiers and epochs.
#[starknet::interface]
pub trait IDiscountSoulboundAdmin<TContractState> {
    /// @notice Updates the current epoch for point accounting.
    /// @dev Callable only by the contract owner.
    /// @param epoch New epoch value.
    fn set_current_epoch(ref self: TContractState, epoch: u64);

    /// @notice Updates the configuration for a discount tier.
    /// @dev Callable only by the contract owner.
    /// @param tier Tier index 1–5.
    /// @param cost Point cost to mint.
    /// @param discount Discount rate (percentage).
    /// @param max_usage Maximum usages per epoch.
    /// @param recharge_cost Point cost to recharge.
    fn set_tier_config(
        ref self: TContractState,
        tier: u8,
        cost: u256,
        discount: u256,
        max_usage: u256,
        recharge_cost: u256
    );

    /// @notice Updates the base URI for NFT metadata resolution.
    /// @param base_uri New base URI string.
    fn set_base_uri(ref self: TContractState, base_uri: ByteArray);

    /// @notice Sets the metadata URI for a specific tier.
    /// @param tier Tier index 1–5.
    /// @param uri Metadata URI for the tier.
    fn set_tier_uri(ref self: TContractState, tier: u8, uri: ByteArray);
}

/// @title IDiscountSoulboundERC721
/// @notice ERC721-compatible transfer entrypoints — always revert for soulbound enforcement.
#[starknet::interface]
pub trait IDiscountSoulboundERC721<TContractState> {
    fn transfer_from(
        ref self: TContractState,
        sender: ContractAddress,
        recipient: ContractAddress,
        token_id: u256
    );
    fn safe_transfer_from(
        ref self: TContractState,
        sender: ContractAddress,
        recipient: ContractAddress,
        token_id: u256,
        data: Span<felt252>
    );
}

/// @title DiscountSoulbound
/// @notice Soulbound discount NFTs backed by point spending.
///         NFTs are not burned on usage exhaustion; they become inactive until recharge or remint.
///         Tiers: Bronze (1) 5%, Silver (2) 10%, Gold (3) 25%, Platinum (4) 35%, Onyx (5) 50%.
#[starknet::contract]
pub mod DiscountSoulbound {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use starknet::storage::*;
    use core::num::traits::Zero;
    use openzeppelin::access::ownable::OwnableComponent;
    use crate::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy_action_types::ACTION_NFT;
    use super::{DiscountNFT, IPointStorageDispatcher, IPointStorageDispatcherTrait};

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableTwoStepImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub nfts: Map<u256, DiscountNFT>,
        pub user_nft: Map<ContractAddress, u256>,
        pub tier_costs: Map<u8, u256>,
        pub tier_discounts: Map<u8, u256>,
        pub tier_max_usage: Map<u8, u256>,
        pub tier_recharge_costs: Map<u8, u256>,
        pub tier_uris: Map<u8, ByteArray>,
        pub point_storage_contract: ContractAddress,
        pub next_token_id: u256,
        pub current_epoch: u64,
        pub last_recharge_epoch: Map<u256, u64>,
        pub authorized_callers: Map<ContractAddress, bool>,
        pub privacy_router: ContractAddress,
        pub base_uri: ByteArray,
        pub used_nullifiers: Map<felt252, bool>,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        NFTMinted: NFTMinted,
        NFTUsed: NFTUsed,
        NFTDeactivated: NFTDeactivated,
        NFTRecharged: NFTRecharged,
        AuthorizedCallerUpdated: AuthorizedCallerUpdated,
        PrivacyRouterUpdated: PrivacyRouterUpdated,
        BaseUriUpdated: BaseUriUpdated,
        TierUriUpdated: TierUriUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    /// @notice Emitted when a new discount NFT is minted.
    #[derive(Drop, starknet::Event)]
    pub struct NFTMinted {
        pub user: ContractAddress,
        pub token_id: u256,
        pub tier: u8,
    }

    /// @notice Emitted when a discount usage is consumed.
    #[derive(Drop, starknet::Event)]
    pub struct NFTUsed {
        pub user: ContractAddress,
        pub token_id: u256,
        pub remaining_usage: u256,
    }

    /// @notice Emitted when an NFT's usage quota is fully exhausted.
    #[derive(Drop, starknet::Event)]
    pub struct NFTDeactivated {
        pub user: ContractAddress,
        pub token_id: u256,
        pub used_in_period: u256,
        pub max_usage: u256,
    }

    /// @notice Emitted when an NFT is recharged for a new epoch.
    #[derive(Drop, starknet::Event)]
    pub struct NFTRecharged {
        pub user: ContractAddress,
        pub token_id: u256,
        pub tier: u8,
        pub cost: u256,
    }

    /// @notice Emitted when an authorized caller is added or removed.
    #[derive(Drop, starknet::Event)]
    pub struct AuthorizedCallerUpdated {
        pub caller: ContractAddress,
        pub authorized: bool,
    }

    /// @notice Emitted when the privacy router address is updated.
    #[derive(Drop, starknet::Event)]
    pub struct PrivacyRouterUpdated {
        pub router: ContractAddress,
    }

    /// @notice Emitted when the base metadata URI is updated.
    #[derive(Drop, starknet::Event)]
    pub struct BaseUriUpdated {
        pub base_uri: ByteArray,
    }

    /// @notice Emitted when a tier-specific metadata URI is updated.
    #[derive(Drop, starknet::Event)]
    pub struct TierUriUpdated {
        pub tier: u8,
        pub uri: ByteArray,
    }

    /// @notice Initializes the contract with default tier configurations.
    /// @param point_storage Address of the point balance contract.
    /// @param epoch Initial accounting epoch.
    /// @dev Deployer becomes the initial owner via OZ OwnableComponent.
    #[constructor]
    fn constructor(ref self: ContractState, point_storage: ContractAddress, epoch: u64) {
        self.ownable.initializer(get_caller_address());
        self.point_storage_contract.write(point_storage);
        self.current_epoch.write(epoch);
        self.next_token_id.write(1);
        let empty_uri: ByteArray = "";
        self.base_uri.write(empty_uri);

        // Tier configuration: Bronze 5% (5 uses), Silver 10% (7), Gold 25% (10), Platinum 35% (15), Onyx 50% (20).
        self.tier_costs.entry(1).write(5000);
        self.tier_discounts.entry(1).write(5);
        self.tier_max_usage.entry(1).write(5);
        self.tier_recharge_costs.entry(1).write(1000);

        self.tier_costs.entry(2).write(15000);
        self.tier_discounts.entry(2).write(10);
        self.tier_max_usage.entry(2).write(7);
        self.tier_recharge_costs.entry(2).write(3000);

        self.tier_costs.entry(3).write(50000);
        self.tier_discounts.entry(3).write(25);
        self.tier_max_usage.entry(3).write(10);
        self.tier_recharge_costs.entry(3).write(10000);

        self.tier_costs.entry(4).write(150000);
        self.tier_discounts.entry(4).write(35);
        self.tier_max_usage.entry(4).write(15);
        self.tier_recharge_costs.entry(4).write(30000);

        self.tier_costs.entry(5).write(500000);
        self.tier_discounts.entry(5).write(50);
        self.tier_max_usage.entry(5).write(20);
        self.tier_recharge_costs.entry(5).write(100000);
    }

    #[abi(embed_v0)]
    impl DiscountSoulboundImpl of super::IDiscountSoulbound<ContractState> {
        /// @inheritdoc IDiscountSoulbound
        fn mint_nft(ref self: ContractState, tier: u8) {
            let user = get_caller_address();
            assert!(tier >= 1 && tier <= 5, "Tier tidak valid");

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
            self.last_recharge_epoch.entry(token_id).write(self.current_epoch.read());
            self.next_token_id.write(token_id + 1);

            self.emit(Event::NFTMinted(NFTMinted { user, token_id, tier }));
        }

        /// @inheritdoc IDiscountSoulbound
        fn use_discount(ref self: ContractState, user: ContractAddress) -> u256 {
            self.use_discount_batch(user, 1_u256)
        }

        /// @inheritdoc IDiscountSoulbound
        fn use_discount_batch(ref self: ContractState, user: ContractAddress, uses: u256) -> u256 {
            let caller = get_caller_address();
            assert!(
                caller == user || self.authorized_callers.entry(caller).read(),
                "Unauthorized caller"
            );
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

        /// @inheritdoc IDiscountSoulbound
        fn recharge_nft(ref self: ContractState) {
            let user = get_caller_address();
            let token_id = self.user_nft.entry(user).read();
            assert!(token_id != 0, "NFT not found");

            let mut nft = self.nfts.entry(token_id).read();
            let cost = self.tier_recharge_costs.entry(nft.tier).read();
            assert!(cost > 0, "Recharge not available");

            let current_epoch = self.current_epoch.read();
            let last_epoch = self.last_recharge_epoch.entry(token_id).read();
            assert!(current_epoch > last_epoch, "Recharge cooldown");

            let point_dispatcher = IPointStorageDispatcher {
                contract_address: self.point_storage_contract.read()
            };
            point_dispatcher.consume_points(current_epoch, user, cost);

            nft.used_in_period = 0;
            nft.last_reset = get_block_timestamp();
            self.nfts.entry(token_id).write(nft);
            self.last_recharge_epoch.entry(token_id).write(current_epoch);

            self.emit(Event::NFTRecharged(NFTRecharged { user, token_id, tier: nft.tier, cost }));
        }

        /// @inheritdoc IDiscountSoulbound
        fn get_user_discount(self: @ContractState, user: ContractAddress) -> u256 {
            let token_id = self.user_nft.entry(user).read();
            if token_id == 0 {
                return 0;
            }
            let nft = self.nfts.entry(token_id).read();
            if nft.used_in_period >= nft.max_usage { return 0; }
            nft.discount_rate
        }

        /// @inheritdoc IDiscountSoulbound
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

        /// @inheritdoc IDiscountSoulbound
        fn get_nft_info(self: @ContractState, token_id: u256) -> DiscountNFT {
            self.nfts.entry(token_id).read()
        }

        /// @inheritdoc IDiscountSoulbound
        fn set_authorized_caller(
            ref self: ContractState, caller: ContractAddress, authorized: bool
        ) {
            self.ownable.assert_only_owner();
            assert!(!caller.is_zero(), "Invalid caller");
            self.authorized_callers.entry(caller).write(authorized);
            self.emit(Event::AuthorizedCallerUpdated(AuthorizedCallerUpdated { caller, authorized }));
        }
    }

    #[abi(embed_v0)]
    impl DiscountSoulboundMetadataImpl of super::IDiscountSoulboundMetadata<ContractState> {
        /// @inheritdoc IDiscountSoulboundMetadata
        fn token_uri(self: @ContractState, token_id: u256) -> ByteArray {
            let nft = self.nfts.entry(token_id).read();
            assert!(!nft.owner.is_zero(), "Token not found");
            self.tier_uris.entry(nft.tier).read()
        }

        /// @inheritdoc IDiscountSoulboundMetadata
        fn get_base_uri(self: @ContractState) -> ByteArray {
            self.base_uri.read()
        }
    }

    #[abi(embed_v0)]
    impl DiscountSoulboundAdminImpl of super::IDiscountSoulboundAdmin<ContractState> {
        /// @inheritdoc IDiscountSoulboundAdmin
        fn set_current_epoch(ref self: ContractState, epoch: u64) {
            self.ownable.assert_only_owner();
            self.current_epoch.write(epoch);
        }

        /// @inheritdoc IDiscountSoulboundAdmin
        fn set_tier_config(
            ref self: ContractState,
            tier: u8,
            cost: u256,
            discount: u256,
            max_usage: u256,
            recharge_cost: u256
        ) {
            self.ownable.assert_only_owner();
            self.tier_costs.entry(tier).write(cost);
            self.tier_discounts.entry(tier).write(discount);
            self.tier_max_usage.entry(tier).write(max_usage);
            self.tier_recharge_costs.entry(tier).write(recharge_cost);
        }

        /// @inheritdoc IDiscountSoulboundAdmin
        fn set_base_uri(ref self: ContractState, base_uri: ByteArray) {
            self.ownable.assert_only_owner();
            self.base_uri.write(base_uri.clone());
            self.emit(Event::BaseUriUpdated(BaseUriUpdated { base_uri }));
        }

        /// @inheritdoc IDiscountSoulboundAdmin
        fn set_tier_uri(ref self: ContractState, tier: u8, uri: ByteArray) {
            self.ownable.assert_only_owner();
            assert!(tier >= 1 && tier <= 5, "Tier tidak valid");
            self.tier_uris.entry(tier).write(uri.clone());
            self.emit(Event::TierUriUpdated(TierUriUpdated { tier, uri }));
        }
    }

    #[abi(embed_v0)]
    impl DiscountSoulboundPrivacyImpl of super::IDiscountSoulboundPrivacy<ContractState> {
        /// @inheritdoc IDiscountSoulboundPrivacy
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
            self.emit(Event::PrivacyRouterUpdated(PrivacyRouterUpdated { router }));
        }

        /// @inheritdoc IDiscountSoulboundPrivacy
        fn submit_private_nft_action(
            ref self: ContractState,
            old_root: felt252,
            new_root: felt252,
            nullifiers: Span<felt252>,
            commitments: Span<felt252>,
            public_inputs: Span<felt252>,
            proof: Span<felt252>
        ) {
            let total: u64 = nullifiers.len().into();
            let mut i: u64 = 0;
            while i < total {
                let idx: u32 = i.try_into().unwrap();
                let nf = *nullifiers.at(idx);
                assert!(!self.used_nullifiers.entry(nf).read(), "Nullifier already used");
                self.used_nullifiers.entry(nf).write(true);
                i += 1;
            };
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
        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            panic!("SBT: Non-transferable");
        }
    }

    #[abi(embed_v0)]
    impl DiscountSoulboundERC721Impl of super::IDiscountSoulboundERC721<ContractState> {
        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            token_id: u256
        ) {
            let _ = sender;
            let _ = recipient;
            let _ = token_id;
            panic!("SBT: Non-transferable");
        }

        fn safe_transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            token_id: u256,
            data: Span<felt252>
        ) {
            let _ = sender;
            let _ = recipient;
            let _ = token_id;
            let _ = data;
            panic!("SBT: Non-transferable");
        }
    }
}
