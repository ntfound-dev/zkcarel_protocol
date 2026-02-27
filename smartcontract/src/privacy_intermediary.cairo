use starknet::ContractAddress;

#[derive(Drop, Serde, starknet::Store, Copy)]
pub struct PrivacyParams {
    pub signature_selector: felt252,
    pub submit_selector: felt252,
    pub execute_selector: felt252,
    pub nullifier: felt252,
    pub commitment: felt252,
    pub action_selector: felt252,
    pub nonce: felt252,
    pub deadline: u64,
}

#[starknet::interface]
pub trait IPrivacyIntermediary<TContractState> {
    fn set_executor(ref self: TContractState, executor: ContractAddress);
    fn execute(
        ref self: TContractState,
        user: ContractAddress,
        token: ContractAddress,
        amount: u256,
        signature: Span<felt252>,
        params: PrivacyParams,
        proof: Span<felt252>,
        public_inputs: Span<felt252>,
        action_calldata: Span<felt252>,
    );
    fn is_nonce_used(self: @TContractState, user: ContractAddress, nonce: felt252) -> bool;
}

#[starknet::contract]
pub mod PrivacyIntermediary {
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use openzeppelin::access::ownable::OwnableComponent;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{
        ContractAddress, SyscallResultTrait, get_block_timestamp, get_caller_address,
        get_contract_address,
    };
    use super::{IPrivacyIntermediary, PrivacyParams};

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[starknet::interface]
    pub trait IERC20<TContractState> {
        fn transfer_from(
            ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
        ) -> bool;
    }

    #[storage]
    pub struct Storage {
        pub executor: ContractAddress,
        pub used_nonces: Map<felt252, bool>,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        ExecutorUpdated: ExecutorUpdated,
        Executed: Executed,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ExecutorUpdated {
        pub executor: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Executed {
        pub relayer: ContractAddress,
        pub user: ContractAddress,
        pub token: ContractAddress,
        pub amount: u256,
        pub nonce: felt252,
        pub commitment: felt252,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress, executor: ContractAddress) {
        self.ownable.initializer(owner);
        self.executor.write(executor);
    }

    #[abi(embed_v0)]
    impl PrivacyIntermediaryImpl of IPrivacyIntermediary<ContractState> {
        fn set_executor(ref self: ContractState, executor: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!executor.is_zero(), "Executor required");
            self.executor.write(executor);
            self.emit(Event::ExecutorUpdated(ExecutorUpdated { executor }));
        }

        fn execute(
            ref self: ContractState,
            user: ContractAddress,
            token: ContractAddress,
            amount: u256,
            signature: Span<felt252>,
            params: PrivacyParams,
            proof: Span<felt252>,
            public_inputs: Span<felt252>,
            action_calldata: Span<felt252>,
        ) {
            assert!(!user.is_zero(), "User required");
            assert!(!token.is_zero(), "Token required");
            assert!(get_block_timestamp() <= params.deadline, "Signature expired");

            let nonce_key = self._nonce_key(user, params.nonce);
            assert!(!self.used_nonces.read(nonce_key), "Nonce already used");

            let params_hash = self
                ._hash_for_signature(user, token, amount, params, proof, public_inputs, action_calldata);
            assert!(
                self._verify_signature(user, params.signature_selector, params_hash, signature),
                "Invalid signature",
            );

            let erc20 = IERC20Dispatcher { contract_address: token };
            let transferred = erc20.transfer_from(user, get_contract_address(), amount);
            assert!(transferred, "transferFrom failed");

            let executor = self.executor.read();
            assert!(!executor.is_zero(), "Executor not configured");

            let mut submit_calldata: Array<felt252> = array![];
            submit_calldata.append(params.nullifier);
            submit_calldata.append(params.commitment);

            let proof_len: u64 = proof.len().into();
            submit_calldata.append(proof_len.into());
            let mut i: u64 = 0;
            while i < proof_len {
                let idx: u32 = i.try_into().unwrap();
                submit_calldata.append(*proof.at(idx));
                i += 1;
            };

            let public_len: u64 = public_inputs.len().into();
            submit_calldata.append(public_len.into());
            let mut j: u64 = 0;
            while j < public_len {
                let idx: u32 = j.try_into().unwrap();
                submit_calldata.append(*public_inputs.at(idx));
                j += 1;
            };

            let _ = starknet::syscalls::call_contract_syscall(
                executor, params.submit_selector, submit_calldata.span(),
            )
                .unwrap_syscall();

            let mut execute_calldata: Array<felt252> = array![];
            execute_calldata.append(params.commitment);
            execute_calldata.append(params.action_selector);

            let action_len: u64 = action_calldata.len().into();
            execute_calldata.append(action_len.into());
            let mut k: u64 = 0;
            while k < action_len {
                let idx: u32 = k.try_into().unwrap();
                execute_calldata.append(*action_calldata.at(idx));
                k += 1;
            };

            let _ = starknet::syscalls::call_contract_syscall(
                executor, params.execute_selector, execute_calldata.span(),
            )
                .unwrap_syscall();

            self.used_nonces.write(nonce_key, true);
            self
                .emit(
                    Event::Executed(
                        Executed {
                            relayer: get_caller_address(),
                            user,
                            token,
                            amount,
                            nonce: params.nonce,
                            commitment: params.commitment,
                        },
                    ),
                );
        }

        fn is_nonce_used(self: @ContractState, user: ContractAddress, nonce: felt252) -> bool {
            self.used_nonces.read(self._nonce_key(user, nonce))
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _nonce_key(self: @ContractState, user: ContractAddress, nonce: felt252) -> felt252 {
            let mut data: Array<felt252> = array![];
            let user_felt: felt252 = user.into();
            data.append(user_felt);
            data.append(nonce);
            poseidon_hash_span(data.span())
        }

        fn _hash_for_signature(
            self: @ContractState,
            user: ContractAddress,
            token: ContractAddress,
            amount: u256,
            params: PrivacyParams,
            proof: Span<felt252>,
            public_inputs: Span<felt252>,
            action_calldata: Span<felt252>,
        ) -> felt252 {
            let mut fields: Array<felt252> = array![];
            let user_felt: felt252 = user.into();
            let token_felt: felt252 = token.into();
            let executor_felt: felt252 = self.executor.read().into();
            let proof_hash = poseidon_hash_span(proof);
            let public_hash = poseidon_hash_span(public_inputs);
            let action_hash = poseidon_hash_span(action_calldata);

            fields.append(user_felt);
            fields.append(token_felt);
            fields.append(amount.low.into());
            fields.append(amount.high.into());
            fields.append(executor_felt);
            fields.append(params.submit_selector);
            fields.append(params.execute_selector);
            fields.append(params.nullifier);
            fields.append(params.commitment);
            fields.append(params.action_selector);
            fields.append(params.nonce);
            fields.append(params.deadline.into());
            fields.append(proof_hash);
            fields.append(public_hash);
            fields.append(action_hash);
            poseidon_hash_span(fields.span())
        }

        fn _verify_signature(
            self: @ContractState,
            user: ContractAddress,
            signature_selector: felt252,
            message_hash: felt252,
            signature: Span<felt252>,
        ) -> bool {
            let mut calldata: Array<felt252> = array![];
            calldata.append(message_hash);
            let sig_len: u64 = signature.len().into();
            calldata.append(sig_len.into());

            let mut i: u64 = 0;
            while i < sig_len {
                let idx: u32 = i.try_into().unwrap();
                calldata.append(*signature.at(idx));
                i += 1;
            };

            let response = starknet::syscalls::call_contract_syscall(
                user, signature_selector, calldata.span(),
            )
                .unwrap_syscall();
            if response.len() == 0 {
                return false;
            }
            return *response.at(0_usize) != 0;
        }
    }
}
