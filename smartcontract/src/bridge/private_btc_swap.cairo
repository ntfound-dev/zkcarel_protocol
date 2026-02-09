use starknet::ContractAddress;

#[derive(Drop, Serde, starknet::Store)]
pub struct PrivateBTCSwapData {
    pub ciphertext: felt252,
    pub commitment: felt252,
    pub finalized: bool,
}

/// @title Private BTC Swap Interface
/// @author CAREL Team
/// @notice Private BTC swap flow with ZK proofs.
/// @dev Uses external verifier for proof validation.
#[starknet::interface]
pub trait IPrivateBTCSwap<TContractState> {
    /// @notice Initiates a private BTC swap.
    /// @param swap Encrypted swap payload.
    /// @param proof ZK proof.
    /// @param public_inputs Public inputs.
    /// @return swap_id New swap id.
    fn initiate_private_btc_swap(
        ref self: TContractState,
        swap: PrivateBTCSwapData,
        proof: Span<felt252>,
        public_inputs: Span<felt252>
    ) -> u64;
    /// @notice Finalizes a private BTC swap.
    /// @param swap_id Swap id.
    /// @param recipient Recipient address.
    /// @param nullifier Nullifier to prevent replay.
    /// @param proof ZK proof.
    /// @param public_inputs Public inputs.
    fn finalize_private_btc_swap(
        ref self: TContractState,
        swap_id: u64,
        recipient: ContractAddress,
        nullifier: felt252,
        proof: Span<felt252>,
        public_inputs: Span<felt252>
    );
    /// @notice Checks if a nullifier has been used.
    /// @param nullifier Nullifier to check.
    /// @return used True if used.
    fn is_nullifier_used(self: @TContractState, nullifier: felt252) -> bool;
}

/// @title Private BTC Swap Admin Interface
/// @author CAREL Team
/// @notice Admin controls for verifier configuration.
#[starknet::interface]
pub trait IPrivateBTCSwapAdmin<TContractState> {
    /// @notice Updates verifier address.
    /// @dev Owner-only.
    /// @param verifier New verifier address.
    fn set_verifier(ref self: TContractState, verifier: ContractAddress);
}

/// @title Private BTC Swap Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy hooks for private BTC swaps.
#[starknet::interface]
pub trait IPrivateBTCSwapPrivacy<TContractState> {
    /// @notice Sets privacy router address.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    /// @notice Submits a private BTC swap action proof.
    fn submit_private_btc_swap_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

/// @title Private BTC Swap Contract
/// @author CAREL Team
/// @notice Private BTC swap with ZK verification and nullifiers.
/// @dev Integrates external verifier.
#[starknet::contract]
pub mod PrivateBTCSwap {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use openzeppelin::access::ownable::OwnableComponent;
    use core::num::traits::Zero;
    use super::PrivateBTCSwapData;
    use crate::privacy::zk_privacy_router::{IProofVerifierDispatcher, IProofVerifierDispatcherTrait};
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_PRIVATE_BTC_SWAP;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub verifier: ContractAddress,
        pub swaps: Map<u64, PrivateBTCSwapData>,
        pub nullifiers: Map<felt252, bool>,
        pub swap_count: u64,
        pub privacy_router: ContractAddress,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        SwapInitiated: SwapInitiated,
        SwapFinalized: SwapFinalized,
        VerifierUpdated: VerifierUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SwapInitiated {
        pub swap_id: u64,
        pub commitment: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SwapFinalized {
        pub swap_id: u64,
        pub recipient: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct VerifierUpdated {
        pub verifier: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress, verifier: ContractAddress) {
        self.ownable.initializer(admin);
        self.verifier.write(verifier);
    }

    #[abi(embed_v0)]
    impl PrivateBTCSwapImpl of super::IPrivateBTCSwap<ContractState> {
        fn initiate_private_btc_swap(
            ref self: ContractState,
            swap: PrivateBTCSwapData,
            proof: Span<felt252>,
            public_inputs: Span<felt252>
        ) -> u64 {
            let verifier = IProofVerifierDispatcher { contract_address: self.verifier.read() };
            assert!(verifier.verify_proof(proof, public_inputs), "Invalid proof");

            let id = self.swap_count.read() + 1;
            self.swap_count.write(id);
            let commitment = swap.commitment;
            self.swaps.entry(id).write(swap);
            self.emit(Event::SwapInitiated(SwapInitiated { swap_id: id, commitment }));
            id
        }

        fn finalize_private_btc_swap(
            ref self: ContractState,
            swap_id: u64,
            recipient: ContractAddress,
            nullifier: felt252,
            proof: Span<felt252>,
            public_inputs: Span<felt252>
        ) {
            assert!(!self.nullifiers.entry(nullifier).read(), "Nullifier already used");
            let verifier = IProofVerifierDispatcher { contract_address: self.verifier.read() };
            assert!(verifier.verify_proof(proof, public_inputs), "Invalid proof");

            let mut swap = self.swaps.entry(swap_id).read();
            assert!(!swap.finalized, "Swap already finalized");
            swap.finalized = true;
            self.swaps.entry(swap_id).write(swap);
            self.nullifiers.entry(nullifier).write(true);
            self.emit(Event::SwapFinalized(SwapFinalized { swap_id, recipient }));
        }

        fn is_nullifier_used(self: @ContractState, nullifier: felt252) -> bool {
            self.nullifiers.entry(nullifier).read()
        }
    }

    #[abi(embed_v0)]
    impl PrivateBTCSwapPrivacyImpl of super::IPrivateBTCSwapPrivacy<ContractState> {
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        fn submit_private_btc_swap_action(
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
                ACTION_PRIVATE_BTC_SWAP,
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
    impl AdminImpl of super::IPrivateBTCSwapAdmin<ContractState> {
        fn set_verifier(ref self: ContractState, verifier: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!verifier.is_zero(), "Verifier required");
            self.verifier.write(verifier);
            self.emit(Event::VerifierUpdated(VerifierUpdated { verifier }));
        }
    }
}
