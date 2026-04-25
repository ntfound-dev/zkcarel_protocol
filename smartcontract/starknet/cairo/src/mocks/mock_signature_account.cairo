#[starknet::interface]
pub trait IMockSignatureAccount<TContractState> {
    fn is_valid_signature(
        self: @TContractState,
        message_hash: felt252,
        signature: Span<felt252>
    ) -> felt252;
}

#[starknet::interface]
pub trait IMockSignatureAccountAdmin<TContractState> {
    fn set_valid_signature(
        ref self: TContractState,
        message_hash: felt252,
        r: felt252,
        s: felt252,
        valid: bool
    );
}

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

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress) {
        self.admin.write(admin);
    }

    #[abi(embed_v0)]
    impl SignatureImpl of super::IMockSignatureAccount<ContractState> {
        fn is_valid_signature(
            self: @ContractState,
            message_hash: felt252,
            signature: Span<felt252>
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
        fn set_valid_signature(
            ref self: ContractState,
            message_hash: felt252,
            r: felt252,
            s: felt252,
            valid: bool
        ) {
            assert!(get_caller_address() == self.admin.read(), "Unauthorized admin");
            self.valid_signatures.entry((message_hash, r, s)).write(valid);
        }
    }
}
