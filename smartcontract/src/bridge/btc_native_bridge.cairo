use starknet::ContractAddress;

// Minimal interface to verify BTC deposits.
// Used to validate BTC proofs before minting.
#[starknet::interface]
pub trait IBtcLightClient<TContractState> {
    // Applies verify tx after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn verify_tx(
        self: @TContractState,
        txid: felt252,
        amount_sats: u64,
        recipient: ContractAddress,
        merkle_proof: Span<felt252>,
        block_hash: felt252
    ) -> bool;
}

// Minimal mint interface for wrapped BTC tokens.
// Used to mint on successful BTC proof verification.
#[starknet::interface]
pub trait IMintableERC20<TContractState> {
    // Applies mint after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn mint(ref self: TContractState, recipient: ContractAddress, amount: u256);
}

// Defines BTC deposit submission and config entrypoints.
// Mints wrapped tokens after BTC proof verification.
#[starknet::interface]
pub trait IBtcNativeBridge<TContractState> {
    // Applies submit btc deposit after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn submit_btc_deposit(
        ref self: TContractState,
        txid: felt252,
        amount_sats: u64,
        recipient: ContractAddress,
        merkle_proof: Span<felt252>,
        block_hash: felt252
    );
    // Returns is processed from state without mutating storage.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn is_processed(self: @TContractState, txid: felt252) -> bool;
    // Updates light client configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_light_client(ref self: TContractState, light_client: ContractAddress);
    // Updates mint token configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_mint_token(ref self: TContractState, token: ContractAddress);
    // Updates unit multiplier configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_unit_multiplier(ref self: TContractState, multiplier: u256);
}

// ZK privacy hooks for BTC bridge actions.
#[starknet::interface]
pub trait IBtcNativeBridgePrivacy<TContractState> {
    // Updates privacy router configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    // Applies submit private btc bridge action after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
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

// Verifies BTC deposits and mints wrapped tokens.
// Uses light client verification and idempotent processing.
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

    // Initializes the BTC native bridge.
    // Sets owner, light client, mint token, and unit multiplier.
    // `admin` owns config updates, `light_client` verifies proofs, and `token` receives minted supply.
    #[constructor]
    // Initializes storage and role configuration during deployment.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn constructor(ref self: ContractState, admin: ContractAddress, light_client: ContractAddress, token: ContractAddress) {
        self.ownable.initializer(admin);
        self.light_client.write(light_client);
        self.mint_token.write(token);
        self.unit_multiplier.write(1_u256);
    }

    #[abi(embed_v0)]
    impl BtcNativeBridgeImpl of super::IBtcNativeBridge<ContractState> {
        // Applies submit btc deposit after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
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

        // Returns is processed from state without mutating storage.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn is_processed(self: @ContractState, txid: felt252) -> bool {
            self.processed.entry(txid).read()
        }

        // Updates light client configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_light_client(ref self: ContractState, light_client: ContractAddress) {
            self.ownable.assert_only_owner();
            self.light_client.write(light_client);
            self.emit(Event::LightClientUpdated(LightClientUpdated { light_client }));
        }

        // Updates mint token configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_mint_token(ref self: ContractState, token: ContractAddress) {
            self.ownable.assert_only_owner();
            self.mint_token.write(token);
            self.emit(Event::MintTokenUpdated(MintTokenUpdated { token }));
        }

        // Updates unit multiplier configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_unit_multiplier(ref self: ContractState, multiplier: u256) {
            self.ownable.assert_only_owner();
            assert!(multiplier > 0, "Multiplier required");
            self.unit_multiplier.write(multiplier);
            self.emit(Event::UnitMultiplierUpdated(UnitMultiplierUpdated { multiplier }));
        }
    }

    #[abi(embed_v0)]
    impl BtcNativeBridgePrivacyImpl of super::IBtcNativeBridgePrivacy<ContractState> {
        // Updates privacy router configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        // Applies submit private btc bridge action after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
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
