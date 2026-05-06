/// @title IMockSignatureAccount
/// @notice ISRC6-compatible signature validation interface used in tests.
#[starknet::interface]
pub trait IMockSignatureAccount<TContractState> {
    /// @notice Returns `'VALID'` if the signature `(r, s)` over `message_hash` was pre-registered
    ///         as valid; returns `0` otherwise.
    /// @param message_hash Hash of the signed message.
    /// @param signature Two-element span `[r, s]`.
    /// @return `'VALID'` (shortstring) on success, `0` on failure.
    fn is_valid_signature(
        self: @TContractState,
        message_hash: felt252,
        signature: Span<felt252>,
    ) -> felt252;
}

/// @title IMockSignatureAccountAdmin
/// @notice Admin interface for pre-registering valid signatures in the mock account.
#[starknet::interface]
pub trait IMockSignatureAccountAdmin<TContractState> {
    /// @notice Registers or revokes a `(message_hash, r, s)` tuple as valid/invalid.
    /// @param message_hash Hash of the message to pre-register.
    /// @param r Signature scalar r.
    /// @param s Signature scalar s.
    /// @param valid True to mark as valid; false to revoke.
    fn set_valid_signature(
        ref self: TContractState,
        message_hash: felt252,
        r: felt252,
        s: felt252,
        valid: bool,
    );
}

/// @title MockSignatureAccount
/// @notice Test-only contract that simulates an account contract's signature validation.
///         Valid signatures are pre-registered by the admin via `set_valid_signature`.
#[starknet::contract]
pub mod MockSignatureAccount {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::get_caller_address;

    #[storage]
    pub struct Storage {
        pub admin: ContractAddress,
        pub valid_signatures: Map<(felt252, felt252, felt252), bool>,
    }

    /// @notice Initializes the mock account with an admin address.
    /// @param admin Address authorized to call `set_valid_signature`.
    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress) {
        self.admin.write(admin);
    }

    #[abi(embed_v0)]
    impl SignatureImpl of super::IMockSignatureAccount<ContractState> {
        /// @inheritdoc IMockSignatureAccount
        fn is_valid_signature(
            self: @ContractState,
            message_hash: felt252,
            signature: Span<felt252>,
        ) -> felt252 {
            if signature.len() != 2 {
                return 0;
            }
            let r = *signature.at(0);
            let s = *signature.at(1);
            if self.valid_signatures.entry((message_hash, r, s)).read() {
                'VALID'
            } else {
                0
            }
        }
    }

    #[abi(embed_v0)]
    impl SignatureAdminImpl of super::IMockSignatureAccountAdmin<ContractState> {
        /// @inheritdoc IMockSignatureAccountAdmin
        fn set_valid_signature(
            ref self: ContractState,
            message_hash: felt252,
            r: felt252,
            s: felt252,
            valid: bool,
        ) {
            assert!(get_caller_address() == self.admin.read(), "Unauthorized admin");
            self.valid_signatures.entry((message_hash, r, s)).write(valid);
        }
    }
}
