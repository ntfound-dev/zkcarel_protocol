use starknet::ContractAddress;

#[derive(Copy, Drop, Serde)]
pub struct BatchClaim {
    pub user: ContractAddress,
    pub amount: u256,
    pub proof_offset: u32,
    pub proof_len: u32,
}

// Minimal interface for staking balance checks.
// Used to enforce minimum stake for reward claims.
#[starknet::interface]
pub trait IStaking<TContractState> {
    // Returns current staked balance for a user.
    fn get_user_stake(self: @TContractState, user: ContractAddress) -> u256;
}

// Minimal mint interface for reward distribution.
// Used to mint rewards on claims.
#[starknet::interface]
pub trait ICarelToken<TContractState> {
    // Mints CAREL to the provided recipient.
    fn mint(ref self: TContractState, recipient: ContractAddress, amount: u256);
}

// Snapshot-based reward distribution API.
// Each epoch has one Merkle root with user claim allocations.
#[starknet::interface]
pub trait ISnapshotDistributor<TContractState> {
    // Stores Merkle root for an epoch.
    fn submit_merkle_root(ref self: TContractState, epoch: u64, root: felt252);
    // Claims reward for caller using Merkle proof.
    fn claim_reward(ref self: TContractState, epoch: u64, amount: u256, proof: Span<felt252>);
    // Processes multiple claims using a flat proofs array.
    fn batch_claim_rewards(
        ref self: TContractState,
        epoch: u64,
        claims: Array<BatchClaim>,
        proofs: Span<felt252>
    );
    // Returns whether `user` has already claimed in `epoch`.
    fn is_claimed(self: @TContractState, epoch: u64, user: ContractAddress) -> bool;
}

// Hide Mode hooks for snapshot actions routed through privacy layer.
#[starknet::interface]
pub trait ISnapshotDistributorPrivacy<TContractState> {
    // Sets privacy router for private snapshot actions.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    // Forwards nullifier/commitment-bound snapshot payload to privacy router.
    fn submit_private_snapshot_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

// Distributes rewards from backend-submitted Merkle snapshots.
// Claims require minimum stake and apply protocol tax split.
#[starknet::contract]
pub mod SnapshotDistributor {
    use core::poseidon::PoseidonTrait;
    use core::hash::{HashStateTrait, HashStateExTrait};
    use starknet::storage::*;
    use starknet::{ContractAddress, get_caller_address};
    use core::traits::TryInto;
    use super::{IStakingDispatcher, IStakingDispatcherTrait, ICarelTokenDispatcher, ICarelTokenDispatcherTrait, BatchClaim};
    use core::num::traits::Zero;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_SNAPSHOT;

    #[storage]
    pub struct Storage {
        pub token_address: ContractAddress,
        pub staking_contract: ContractAddress,
        pub dev_wallet: ContractAddress,
        pub treasury_wallet: ContractAddress,
        pub backend_signer: ContractAddress,
        pub merkle_roots: Map<u64, felt252>,
        pub claimed: Map<(u64, ContractAddress), bool>,
        pub start_time: u64,
        pub privacy_router: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        RewardClaimed: RewardClaimed,
        RootSubmitted: RootSubmitted,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RewardClaimed {
        pub user: ContractAddress,
        pub epoch: u64,
        pub net_amount: u256
    }

    #[derive(Drop, starknet::Event)]
    pub struct RootSubmitted {
        pub epoch: u64,
        pub root: felt252
    }

    // Initializes token dependencies, fee wallets, signer, and protocol start time.
    #[constructor]
    fn constructor(
        ref self: ContractState,
        token: ContractAddress,
        staking: ContractAddress,
        dev: ContractAddress,
        treasury: ContractAddress,
        signer: ContractAddress,
        protocol_start: u64
    ) {
        self.token_address.write(token);
        self.staking_contract.write(staking);
        self.dev_wallet.write(dev);
        self.treasury_wallet.write(treasury);
        self.backend_signer.write(signer);
        self.start_time.write(protocol_start);
    }

    #[abi(embed_v0)]
    impl SnapshotDistributorImpl of super::ISnapshotDistributor<ContractState> {
        // Backend signer publishes Merkle root for the target epoch.
        fn submit_merkle_root(ref self: ContractState, epoch: u64, root: felt252) {
            assert!(get_caller_address() == self.backend_signer.read(), "Bukan authorized signer");
            self.merkle_roots.entry(epoch).write(root);
            self.emit(Event::RootSubmitted(RootSubmitted { epoch, root }));
        }

        // Claims reward for caller after stake and proof validation.
        // Marks claimed before minting and splits 5% tax between treasury and dev wallet.
        fn claim_reward(ref self: ContractState, epoch: u64, amount: u256, proof: Span<felt252>) {
            let user = get_caller_address();
            assert!(!self.claimed.entry((epoch, user)).read(), "Sudah melakukan claim");

            // Minimum staking requirement check
            let staking_disp = IStakingDispatcher { contract_address: self.staking_contract.read() };
            let min_stake: u256 = 10_000_000_000_000_000_000_u256; // 10 Tokens
            assert!(staking_disp.get_user_stake(user) >= min_stake, "Stake tidak mencukupi");

            // Generate leaf and verify Merkle proof using Poseidon (include epoch to prevent replay)
            let leaf = PoseidonTrait::new()
                .update_with(user)
                .update_with(amount)
                .update_with(epoch)
                .finalize();
            let root = self.merkle_roots.entry(epoch).read();
            assert!(root != 0, "Merkle root not set");
            assert!(self.verify_proof(proof, root, leaf), "Merkle proof tidak valid");

            // Mark claimed before external calls to prevent reentrancy
            self.claimed.entry((epoch, user)).write(true);

            // Calculate 5% total tax (500/10000): 2.5% management + 2.5% dev
            let total_tax = (amount * 500) / 10000;
            let management_tax = total_tax / 2;
            let dev_tax = total_tax - management_tax;
            let net_reward = amount - total_tax;

            // Execute minting via ICarelTokenDispatcher
            let token_disp = ICarelTokenDispatcher { contract_address: self.token_address.read() };
            token_disp.mint(user, net_reward);
            if management_tax > 0 {
                token_disp.mint(self.treasury_wallet.read(), management_tax);
            }
            if dev_tax > 0 {
                token_disp.mint(self.dev_wallet.read(), dev_tax);
            }

            // Emit event
            self.emit(Event::RewardClaimed(RewardClaimed { user, epoch, net_amount: net_reward }));
        }

        // Batch variant of `claim_reward` using packed proof segments per user.
        fn batch_claim_rewards(
            ref self: ContractState,
            epoch: u64,
            claims: Array<BatchClaim>,
            proofs: Span<felt252>
        ) {
            let root = self.merkle_roots.entry(epoch).read();
            assert!(root != 0, "Merkle root not set");

            let staking_disp = IStakingDispatcher { contract_address: self.staking_contract.read() };
            let min_stake: u256 = 10_000_000_000_000_000_000_u256; // 10 Tokens

            let total: u64 = claims.len().into();
            let mut i: u64 = 0;
            while i < total {
                let idx: u32 = i.try_into().unwrap();
                let claim = *claims.at(idx);
                if self.claimed.entry((epoch, claim.user)).read() {
                    i += 1;
                    continue;
                }

                assert!(staking_disp.get_user_stake(claim.user) >= min_stake, "Stake tidak mencukupi");

                let leaf = PoseidonTrait::new()
                    .update_with(claim.user)
                    .update_with(claim.amount)
                    .update_with(epoch)
                    .finalize();

                let ok = self.verify_proof_from_flat(proofs, claim.proof_offset, claim.proof_len, root, leaf);
                assert!(ok, "Merkle proof tidak valid");

                self.claimed.entry((epoch, claim.user)).write(true);

                // Calculate 5% total tax (500/10000): 2.5% management + 2.5% dev
                let total_tax = (claim.amount * 500) / 10000;
                let management_tax = total_tax / 2;
                let dev_tax = total_tax - management_tax;
                let net_reward = claim.amount - total_tax;

                let token_disp = ICarelTokenDispatcher { contract_address: self.token_address.read() };
                token_disp.mint(claim.user, net_reward);
                if management_tax > 0 {
                    token_disp.mint(self.treasury_wallet.read(), management_tax);
                }
                if dev_tax > 0 {
                    token_disp.mint(self.dev_wallet.read(), dev_tax);
                }

                self.emit(Event::RewardClaimed(RewardClaimed { user: claim.user, epoch, net_amount: net_reward }));
                i += 1;
            };
        }

        // Returns whether a claim has already been consumed for `(epoch, user)`.
        fn is_claimed(self: @ContractState, epoch: u64, user: ContractAddress) -> bool {
            self.claimed.entry((epoch, user)).read()
        }
    }

    #[abi(embed_v0)]
    impl SnapshotDistributorPrivacyImpl of super::ISnapshotDistributorPrivacy<ContractState> {
        // Sets privacy router for Hide Mode snapshot submissions.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            assert!(get_caller_address() == self.backend_signer.read(), "Unauthorized backend");
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        // Relays private snapshot action to privacy router.
        // Router enforces proof validity and nullifier replay protection.
        fn submit_private_snapshot_action(
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
                ACTION_SNAPSHOT,
                old_root,
                new_root,
                nullifiers,
                commitments,
                public_inputs,
                proof
            );
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        // Deterministic node hashing with sorted pair ordering.
        fn hash_pair(self: @ContractState, left: felt252, right: felt252) -> felt252 {
            let left_u256: u256 = left.into();
            let right_u256: u256 = right.into();

            if left_u256 < right_u256 {
                PoseidonTrait::new().update(left).update(right).finalize()
            } else {
                PoseidonTrait::new().update(right).update(left).finalize()
            }
        }

        // Verifies a standard sibling proof against the provided root.
        fn verify_proof(self: @ContractState, proof: Span<felt252>, root: felt252, leaf: felt252) -> bool {
            let mut computed_hash = leaf;
            for i in 0..proof.len() {
                computed_hash = self.hash_pair(computed_hash, *proof.at(i));
            };
            computed_hash == root
        }

        // Verifies a proof slice stored inside a flattened proofs array.
        fn verify_proof_from_flat(
            self: @ContractState,
            proofs: Span<felt252>,
            offset: u32,
            len: u32,
            root: felt252,
            leaf: felt252
        ) -> bool {
            let total: u64 = proofs.len().into();
            let start: u64 = offset.into();
            let proof_len: u64 = len.into();
            if start + proof_len > total {
                return false;
            }

            let mut computed_hash = leaf;
            let mut i: u64 = 0;
            while i < proof_len {
                let idx: usize = (start + i).try_into().unwrap();
                computed_hash = self.hash_pair(computed_hash, *proofs.at(idx));
                i += 1;
            };
            computed_hash == root
        }
    }
}
