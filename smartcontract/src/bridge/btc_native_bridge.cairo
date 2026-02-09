use starknet::ContractAddress;

/// @title BTC Light Client Interface
/// @author CAREL Team
/// @notice Minimal interface to verify BTC deposits.
/// @dev Used to validate BTC proofs before minting.
#[starknet::interface]
pub trait IBtcLightClient<TContractState> {
    /// @notice Verifies a BTC transaction proof.
    /// @dev Returns true if the proof is valid.
    /// @param txid BTC transaction id.
    /// @param amount_sats Amount in satoshis.
    /// @param recipient Recipient address on Starknet.
    /// @param merkle_proof Merkle proof data.
    /// @param block_hash BTC block hash.
    /// @return valid True if the proof is valid.
    fn verify_tx(
        self: @TContractState,
        txid: felt252,
        amount_sats: u64,
        recipient: ContractAddress,
        merkle_proof: Span<felt252>,
        block_hash: felt252
    ) -> bool;
}

/// @title Mintable ERC20 Interface
/// @author CAREL Team
/// @notice Minimal mint interface for wrapped BTC tokens.
/// @dev Used to mint on successful BTC proof verification.
#[starknet::interface]
pub trait IMintableERC20<TContractState> {
    /// @notice Mints tokens to a recipient.
    /// @dev Called by the bridge on successful deposit.
    /// @param recipient Recipient address.
    /// @param amount Amount to mint.
    fn mint(ref self: TContractState, recipient: ContractAddress, amount: u256);
}

/// @title BTC Native Bridge Interface
/// @author CAREL Team
/// @notice Defines BTC deposit submission and config entrypoints.
/// @dev Mints wrapped tokens after BTC proof verification.
#[starknet::interface]
pub trait IBtcNativeBridge<TContractState> {
    /// @notice Submits a BTC deposit proof for minting.
    /// @dev Verifies via light client before minting.
    /// @param txid BTC transaction id.
    /// @param amount_sats Amount in satoshis.
    /// @param recipient Recipient address on Starknet.
    /// @param merkle_proof Merkle proof data.
    /// @param block_hash BTC block hash.
    fn submit_btc_deposit(
        ref self: TContractState,
        txid: felt252,
        amount_sats: u64,
        recipient: ContractAddress,
        merkle_proof: Span<felt252>,
        block_hash: felt252
    );
    /// @notice Checks whether a BTC deposit was processed.
    /// @dev Read-only helper for idempotency checks.
    /// @param txid BTC transaction id.
    /// @return processed True if already processed.
    fn is_processed(self: @TContractState, txid: felt252) -> bool;
    /// @notice Updates the light client contract address.
    /// @dev Owner-only to keep verification trusted.
    /// @param light_client New light client address.
    fn set_light_client(ref self: TContractState, light_client: ContractAddress);
    /// @notice Updates the mint token contract address.
    /// @dev Owner-only to control minting target.
    /// @param token Mint token address.
    fn set_mint_token(ref self: TContractState, token: ContractAddress);
    /// @notice Updates the satoshi-to-token multiplier.
    /// @dev Owner-only to control mint unit scaling.
    /// @param multiplier Unit multiplier.
    fn set_unit_multiplier(ref self: TContractState, multiplier: u256);
}

/// @title BTC Native Bridge Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy hooks for BTC bridge actions.
#[starknet::interface]
pub trait IBtcNativeBridgePrivacy<TContractState> {
    /// @notice Sets privacy router address.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    /// @notice Submits a private BTC bridge action proof.
    fn submit_private_btc_bridge_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

/// @title BTC Native Bridge Contract
/// @author CAREL Team
/// @notice Verifies BTC deposits and mints wrapped tokens.
/// @dev Uses light client verification and idempotent processing.
#[starknet::contract]
pub mod BtcNativeBridge {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use openzeppelin::access::ownable::OwnableComponent;
    use super::{IBtcLightClientDispatcher, IBtcLightClientDispatcherTrait, IMintableERC20Dispatcher, IMintableERC20DispatcherTrait};
    use core::num::traits::Zero;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_BTC_BRIDGE;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub light_client: ContractAddress,
        pub mint_token: ContractAddress,
        pub unit_multiplier: u256,
        pub processed: Map<felt252, bool>,
        pub privacy_router: ContractAddress,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        DepositProcessed: DepositProcessed,
        LightClientUpdated: LightClientUpdated,
        MintTokenUpdated: MintTokenUpdated,
        UnitMultiplierUpdated: UnitMultiplierUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct DepositProcessed {
        pub txid: felt252,
        pub recipient: ContractAddress,
        pub amount_sats: u64,
        pub minted_amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct LightClientUpdated {
        pub light_client: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MintTokenUpdated {
        pub token: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct UnitMultiplierUpdated {
        pub multiplier: u256,
    }

    /// @notice Initializes the BTC native bridge.
    /// @dev Sets owner, light client, mint token, and unit multiplier.
    /// @param admin Owner/admin address.
    /// @param light_client Light client contract address.
    /// @param token Mintable token contract address.
    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress, light_client: ContractAddress, token: ContractAddress) {
        self.ownable.initializer(admin);
        self.light_client.write(light_client);
        self.mint_token.write(token);
        self.unit_multiplier.write(1_u256);
    }

    #[abi(embed_v0)]
    impl BtcNativeBridgeImpl of super::IBtcNativeBridge<ContractState> {
        /// @notice Submits a BTC deposit proof for minting.
        /// @dev Verifies via light client before minting.
        /// @param txid BTC transaction id.
        /// @param amount_sats Amount in satoshis.
        /// @param recipient Recipient address on Starknet.
        /// @param merkle_proof Merkle proof data.
        /// @param block_hash BTC block hash.
        fn submit_btc_deposit(
            ref self: ContractState,
            txid: felt252,
            amount_sats: u64,
            recipient: ContractAddress,
            merkle_proof: Span<felt252>,
            block_hash: felt252
        ) {
            assert!(!self.processed.entry(txid).read(), "Deposit already processed");
            let client = self.light_client.read();
            assert!(!client.is_zero(), "Light client not set");

            let dispatcher = IBtcLightClientDispatcher { contract_address: client };
            assert!(dispatcher.verify_tx(txid, amount_sats, recipient, merkle_proof, block_hash), "Invalid BTC proof");

            self.processed.entry(txid).write(true);

            let mut minted_amount: u256 = 0;
            let token = self.mint_token.read();
            if !token.is_zero() {
                let multiplier = self.unit_multiplier.read();
                minted_amount = (amount_sats.into()) * multiplier;
                let mint_dispatcher = IMintableERC20Dispatcher { contract_address: token };
                mint_dispatcher.mint(recipient, minted_amount);
            }

            self.emit(Event::DepositProcessed(DepositProcessed {
                txid,
                recipient,
                amount_sats,
                minted_amount
            }));
        }

        /// @notice Checks whether a BTC deposit was processed.
        /// @dev Read-only helper for idempotency checks.
        /// @param txid BTC transaction id.
        /// @return processed True if already processed.
        fn is_processed(self: @ContractState, txid: felt252) -> bool {
            self.processed.entry(txid).read()
        }

        /// @notice Updates the light client contract address.
        /// @dev Owner-only to keep verification trusted.
        /// @param light_client New light client address.
        fn set_light_client(ref self: ContractState, light_client: ContractAddress) {
            self.ownable.assert_only_owner();
            self.light_client.write(light_client);
            self.emit(Event::LightClientUpdated(LightClientUpdated { light_client }));
        }

        /// @notice Updates the mint token contract address.
        /// @dev Owner-only to control minting target.
        /// @param token Mint token address.
        fn set_mint_token(ref self: ContractState, token: ContractAddress) {
            self.ownable.assert_only_owner();
            self.mint_token.write(token);
            self.emit(Event::MintTokenUpdated(MintTokenUpdated { token }));
        }

        /// @notice Updates the satoshi-to-token multiplier.
        /// @dev Owner-only to control mint unit scaling.
        /// @param multiplier Unit multiplier.
        fn set_unit_multiplier(ref self: ContractState, multiplier: u256) {
            self.ownable.assert_only_owner();
            assert!(multiplier > 0, "Multiplier required");
            self.unit_multiplier.write(multiplier);
            self.emit(Event::UnitMultiplierUpdated(UnitMultiplierUpdated { multiplier }));
        }
    }

    #[abi(embed_v0)]
    impl BtcNativeBridgePrivacyImpl of super::IBtcNativeBridgePrivacy<ContractState> {
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        fn submit_private_btc_bridge_action(
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
                ACTION_BTC_BRIDGE,
                old_root,
                new_root,
                nullifiers,
                commitments,
                public_inputs,
                proof
            );
        }
    }
}
