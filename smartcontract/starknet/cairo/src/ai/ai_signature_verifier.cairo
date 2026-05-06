use starknet::ContractAddress;

/// @title IAISignatureVerifier
/// @notice SRC-6 account-based signature verification with single-use hash consumption.
/// @dev Verification delegates to the signer's own `is_valid_signature` (SRC-6).
///      Hash consumption prevents replay without requiring sequential nonces on this contract.
#[starknet::interface]
pub trait IAISignatureVerifier<TContractState> {
    /// @notice Checks whether a signature is valid without marking the hash as consumed.
    /// @dev Pure read-only check — safe to call multiple times for the same hash.
    /// @param signer The account contract address that produced the signature.
    /// @param message_hash Hash that was signed.
    /// @param signature Raw SRC-6 signature span.
    /// @return true if `signer.is_valid_signature(message_hash, signature) == 'VALID'`.
    fn verify_signature(
        self: @TContractState,
        signer: ContractAddress,
        message_hash: felt252,
        signature: Span<felt252>
    ) -> bool;

    /// @notice Verifies the signature and marks the hash as consumed in a single atomic call.
    /// @dev Panics if the hash has already been consumed for this signer (M-5 fix — prevents
    ///      callers from silently proceeding on replay by returning false).
    ///      Emits `HashConsumed` on success.
    /// @param signer The account contract address that produced the signature.
    /// @param message_hash Hash that was signed.
    /// @param signature Raw SRC-6 signature span.
    /// @return true if the signature is valid. Returns false (without panicking) if the signature
    ///         itself is invalid. Panics (does not return) if the hash was already consumed.
    fn verify_and_consume(
        ref self: TContractState,
        signer: ContractAddress,
        message_hash: felt252,
        signature: Span<felt252>
    ) -> bool;
}

/// @title IAISignatureVerifierPrivacy
/// @notice ZK privacy hooks for AI signature verification actions.
#[starknet::interface]
pub trait IAISignatureVerifierPrivacy<TContractState> {
    /// @notice Sets the privacy router address for ZK action dispatch.
    /// @param router Address of the `IPrivacyRouter` contract (must be non-zero).
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);

    /// @notice Submits a ZK-proven private AI signature action via the privacy router.
    /// @dev Nullifiers are verified for uniqueness and stored before dispatching to the router.
    /// @param old_root Merkle root before the state transition.
    /// @param new_root Merkle root after the state transition.
    /// @param nullifiers Nullifiers to mark as spent.
    /// @param commitments New commitments inserted into the tree.
    /// @param public_inputs Public inputs passed to the verifier.
    /// @param proof Garaga Honk proof bytes.
    fn submit_private_ai_signature_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

/// @notice Minimal Starknet account signature interface (SRC-6 compatible).
#[starknet::interface]
pub trait ISignatureAccount<TContractState> {
    /// @notice Returns `'VALID'` when the signature is valid for the given hash.
    /// @param message_hash The hash to verify.
    /// @param signature Raw signature bytes.
    /// @return `'VALID'` felt252 literal on success, any other value on failure.
    fn is_valid_signature(
        self: @TContractState,
        message_hash: felt252,
        signature: Span<felt252>
    ) -> felt252;
}

/// @title AISignatureVerifier
/// @notice Production-oriented account-based signature verifier for AI actions.
/// @dev Uses OZ OwnableComponent. Stores consumed hashes per signer to prevent replay.
///      Works with any SRC-6 compatible Starknet account (ArgentX, Braavos, OZ accounts).
#[starknet::contract]
pub mod AISignatureVerifier {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use openzeppelin::access::ownable::OwnableComponent;
    use core::num::traits::Zero;
    use core::traits::TryInto;
    use crate::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy_action_types::ACTION_AI;
    use super::{ISignatureAccountDispatcher, ISignatureAccountDispatcherTrait};

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        /// @dev Key: (signer, message_hash) → true if the hash has been consumed.
        pub used_hashes: Map<(ContractAddress, felt252), bool>,
        /// @dev Nullifiers spent via `submit_private_ai_signature_action`.
        pub used_nullifiers: Map<felt252, bool>,
        pub privacy_router: ContractAddress,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        HashConsumed: HashConsumed,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    /// @notice Emitted when a message hash is successfully verified and marked as consumed.
    #[derive(Drop, starknet::Event)]
    pub struct HashConsumed {
        pub signer: ContractAddress,
        pub message_hash: felt252,
    }

    /// @notice Initializes the signature verifier with the given admin as owner.
    /// @param admin Initial owner address (receives OwnableTwoStep ownership).
    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress) {
        self.ownable.initializer(admin);
    }

    #[abi(embed_v0)]
    impl VerifierImpl of super::IAISignatureVerifier<ContractState> {
        /// @inheritdoc IAISignatureVerifier
        fn verify_signature(
            self: @ContractState,
            signer: ContractAddress,
            message_hash: felt252,
            signature: Span<felt252>
        ) -> bool {
            if signer.is_zero() || message_hash == 0 || signature.len() == 0 {
                return false;
            }
            let account = ISignatureAccountDispatcher { contract_address: signer };
            account.is_valid_signature(message_hash, signature) == 'VALID'
        }

        /// @inheritdoc IAISignatureVerifier
        fn verify_and_consume(
            ref self: ContractState,
            signer: ContractAddress,
            message_hash: felt252,
            signature: Span<felt252>
        ) -> bool {
            let key = (signer, message_hash);
            // Panic (not silent return) on replay so callers that ignore the return value revert.
            assert!(!self.used_hashes.entry(key).read(), "Signature already consumed");
            if !self.verify_signature(signer, message_hash, signature) {
                return false;
            }
            self.used_hashes.entry(key).write(true);
            self.emit(Event::HashConsumed(HashConsumed { signer, message_hash }));
            true
        }
    }

    #[abi(embed_v0)]
    impl AISignatureVerifierPrivacyImpl of super::IAISignatureVerifierPrivacy<ContractState> {
        /// @inheritdoc IAISignatureVerifierPrivacy
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        /// @inheritdoc IAISignatureVerifierPrivacy
        fn submit_private_ai_signature_action(
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
            let total: u64 = nullifiers.len().into();
            let mut i: u64 = 0;
            while i < total {
                let idx: u32 = i.try_into().unwrap();
                let nf = *nullifiers.at(idx);
                assert!(!self.used_nullifiers.read(nf), "Nullifier already used");
                self.used_nullifiers.write(nf, true);
                i += 1;
            };
            let dispatcher = IPrivacyRouterDispatcher { contract_address: router };
            dispatcher.submit_action(
                ACTION_AI,
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
