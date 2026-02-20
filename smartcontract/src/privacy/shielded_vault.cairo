use starknet::ContractAddress;

// Maintains Merkle root, nullifiers, and commitments for privacy notes.
#[starknet::interface]
pub trait IShieldedVault<TContractState> {
    // Returns the active shielded Merkle root used to validate privacy proofs.
    fn get_root(self: @TContractState) -> felt252;
    // Applies a shielded transition by validating root linkage, nullifiers, and new commitments.
    fn submit_transition(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>
    );
    // Read-only check for whether a nullifier has been consumed (double-spend protection).
    fn is_nullifier_used(self: @TContractState, nullifier: felt252) -> bool;
    // Read-only check for whether a commitment/note is already present in vault state.
    fn is_commitment_seen(self: @TContractState, commitment: felt252) -> bool;
}

// Administrative hooks for router + root bootstrap.
#[starknet::interface]
pub trait IShieldedVaultAdmin<TContractState> {
    // Owner-only setter for updating the trusted router allowed to submit vault transitions.
    fn set_router(ref self: TContractState, router: ContractAddress);
    // Owner-only root override used for controlled bootstrap or emergency recovery.
    fn set_root(ref self: TContractState, new_root: felt252);
}

// Stores privacy roots, nullifiers, and commitments.
#[starknet::contract]
pub mod ShieldedVault {
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::*;
    use core::num::traits::Zero;
    use openzeppelin::access::ownable::OwnableComponent;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub current_root: felt252,
        pub root_count: u64,
        pub roots: Map<u64, felt252>,
        pub nullifiers: Map<felt252, bool>,
        pub commitments: Map<felt252, bool>,
        pub router: ContractAddress,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        TransitionApplied: TransitionApplied,
        RouterUpdated: RouterUpdated,
        RootUpdated: RootUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct TransitionApplied {
        pub old_root: felt252,
        pub new_root: felt252,
        pub nullifier_count: u64,
        pub commitment_count: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RouterUpdated {
        pub router: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RootUpdated {
        pub new_root: felt252,
    }

    #[constructor]
    // Initializes owner/admin roles plus verifier/router dependencies required by privacy flows.
    fn constructor(ref self: ContractState, owner: ContractAddress, initial_root: felt252) {
        self.ownable.initializer(owner);
        self.current_root.write(initial_root);
        if initial_root != 0 {
            self.root_count.write(1);
            self.roots.entry(1).write(initial_root);
        }
    }

    #[abi(embed_v0)]
    impl ShieldedVaultImpl of super::IShieldedVault<ContractState> {
        // Returns the active shielded Merkle root used to validate privacy proofs.
            fn get_root(self: @ContractState) -> felt252 {
            self.current_root.read()
        }

        // Applies a shielded transition by validating root linkage, nullifiers, and new commitments.
            fn submit_transition(
            ref self: ContractState,
            old_root: felt252,
            new_root: felt252,
            nullifiers: Span<felt252>,
            commitments: Span<felt252>
        ) {
            let router = self.router.read();
            assert!(!router.is_zero(), "Router not set");
            assert!(get_caller_address() == router, "Unauthorized router");

            let current = self.current_root.read();
            if current != 0 {
                assert!(current == old_root, "Invalid root");
            } else {
                assert!(old_root == 0, "Invalid root");
            }

            let mut i: u64 = 0;
            let nullifier_len: u64 = nullifiers.len().into();
            while i < nullifier_len {
                let idx: u32 = i.try_into().unwrap();
                let n = *nullifiers.at(idx);
                assert!(!self.nullifiers.entry(n).read(), "Nullifier already used");
                self.nullifiers.entry(n).write(true);
                i += 1;
            };

            let mut j: u64 = 0;
            let commitment_len: u64 = commitments.len().into();
            while j < commitment_len {
                let idx: u32 = j.try_into().unwrap();
                let c = *commitments.at(idx);
                self.commitments.entry(c).write(true);
                j += 1;
            };

            self.current_root.write(new_root);
            let next = self.root_count.read() + 1;
            self.root_count.write(next);
            self.roots.entry(next).write(new_root);

            self.emit(Event::TransitionApplied(TransitionApplied {
                old_root,
                new_root,
                nullifier_count: nullifier_len,
                commitment_count: commitment_len
            }));
        }

        // Read-only check for whether a nullifier has been consumed (double-spend protection).
            fn is_nullifier_used(self: @ContractState, nullifier: felt252) -> bool {
            self.nullifiers.entry(nullifier).read()
        }

        // Read-only check for whether a commitment/note is already present in vault state.
            fn is_commitment_seen(self: @ContractState, commitment: felt252) -> bool {
            self.commitments.entry(commitment).read()
        }
    }

    #[abi(embed_v0)]
    impl ShieldedVaultAdminImpl of super::IShieldedVaultAdmin<ContractState> {
        // Owner-only setter for updating the trusted router allowed to submit vault transitions.
            fn set_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Router required");
            self.router.write(router);
            self.emit(Event::RouterUpdated(RouterUpdated { router }));
        }

        // Owner-only root override used for controlled bootstrap or emergency recovery.
            fn set_root(ref self: ContractState, new_root: felt252) {
            self.ownable.assert_only_owner();
            self.current_root.write(new_root);
            let next = self.root_count.read() + 1;
            self.root_count.write(next);
            self.roots.entry(next).write(new_root);
            self.emit(Event::RootUpdated(RootUpdated { new_root }));
        }
    }
}
