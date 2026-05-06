use starknet::ContractAddress;

/// @notice Parameters for a single claim within a batch operation.
#[derive(Copy, Drop, Serde)]
pub struct BatchClaim {
    pub user: ContractAddress,
    pub amount: u256,
    pub proof_offset: u32,
    pub proof_len: u32,
}

/// @notice Minimal staking balance interface for minimum stake enforcement.
#[starknet::interface]
pub trait IStaking<TContractState> {
    fn get_user_stake(self: @TContractState, user: ContractAddress) -> u256;
}

/// @notice Minimal CAREL token interface for reward distribution and burns.
#[starknet::interface]
pub trait ICarelToken<TContractState> {
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    fn burn(ref self: TContractState, amount: u256);
}

/// @title ISnapshotDistributor
/// @notice Snapshot-based Merkle reward distribution with per-epoch claim tracking.
#[starknet::interface]
pub trait ISnapshotDistributor<TContractState> {
    /// @notice Stores the Merkle root for an epoch.
    /// @dev Callable only by the backend signer. Root is immutable once set.
    /// @param epoch The distribution epoch.
    /// @param root Poseidon Merkle root committing user allocations.
    fn submit_merkle_root(ref self: TContractState, epoch: u64, root: felt252);

    /// @notice Claims the reward for the caller using a Merkle proof.
    /// @dev Requires minimum stake. Applies 1.25% treasury + 1.25% dev + 2.5% burn tax.
    ///      Marks claim before transfers (CEI pattern).
    /// @param epoch The epoch to claim for.
    /// @param amount Gross token allocation.
    /// @param proof Merkle sibling proof path.
    fn claim_reward(ref self: TContractState, epoch: u64, amount: u256, proof: Span<felt252>);

    /// @notice Processes multiple claims using a flat packed proofs array.
    /// @dev Skips already-claimed entries rather than reverting.
    /// @param epoch The epoch to batch-claim for.
    /// @param claims Array of `BatchClaim` structs.
    /// @param proofs Flat array of all proof hashes; each claim slices with `proof_offset`/`proof_len`.
    fn batch_claim_rewards(
        ref self: TContractState,
        epoch: u64,
        claims: Array<BatchClaim>,
        proofs: Span<felt252>
    );

    /// @notice Returns whether `user` has already claimed in `epoch`.
    /// @param epoch The epoch to check.
    /// @param user The address to check.
    /// @return true if already claimed.
    fn is_claimed(self: @TContractState, epoch: u64, user: ContractAddress) -> bool;
}

/// @title ISnapshotDistributorAdmin
/// @notice Owner-only configuration for operational dependencies and thresholds.
#[starknet::interface]
pub trait ISnapshotDistributorAdmin<TContractState> {
    /// @notice Replaces the backend signer authorized to submit Merkle roots.
    /// @param signer New backend signer address.
    fn set_backend_signer(ref self: TContractState, signer: ContractAddress);

    /// @notice Replaces the staking contract used for minimum stake checks.
    /// @param staking New staking contract address.
    fn set_staking_contract(ref self: TContractState, staking: ContractAddress);

    /// @notice Replaces the dev wallet for fee splits.
    /// @param dev New dev wallet address.
    fn set_dev_wallet(ref self: TContractState, dev: ContractAddress);

    /// @notice Replaces the treasury wallet for fee splits.
    /// @param treasury New treasury wallet address.
    fn set_treasury_wallet(ref self: TContractState, treasury: ContractAddress);

    /// @notice Updates the minimum staked balance required to claim rewards.
    /// @param min_stake New minimum stake (raw token units, 18 decimals).
    fn set_min_stake(ref self: TContractState, min_stake: u256);
}

/// @title ISnapshotDistributorPrivacy
/// @notice Hide Mode hooks for snapshot actions routed through the privacy layer.
#[starknet::interface]
pub trait ISnapshotDistributorPrivacy<TContractState> {
    /// @notice Sets the privacy router for private snapshot actions.
    /// @dev Callable only by the contract owner. Emits `PrivacyRouterUpdated`.
    /// @param router New privacy router address (must be non-zero).
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);

    /// @notice Forwards a nullifier/commitment-bound snapshot payload to the privacy router.
    /// @dev Nullifiers are replay-protected: each may only be consumed once.
    /// @param old_root Previous Merkle tree root.
    /// @param new_root Updated Merkle tree root after commitments.
    /// @param nullifiers Nullifiers for inputs being spent.
    /// @param commitments New Merkle commitments.
    /// @param public_inputs ZK circuit public inputs.
    /// @param proof Serialized ZK proof.
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

/// @title SnapshotDistributor
/// @notice Distributes rewards from backend-submitted Merkle snapshots.
///         Claims require minimum stake and apply a 5% protocol tax split (treasury + dev + burn).
#[starknet::contract]
pub mod SnapshotDistributor {
    use core::poseidon::PoseidonTrait;
    use core::hash::{HashStateTrait, HashStateExTrait};
    use starknet::storage::*;
    use starknet::{ContractAddress, get_caller_address};
    use core::traits::TryInto;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::security::reentrancyguard::ReentrancyGuardComponent;
    use super::{
        IStakingDispatcher, IStakingDispatcherTrait,
        ICarelTokenDispatcher, ICarelTokenDispatcherTrait,
        BatchClaim
    };
    use core::num::traits::Zero;
    use crate::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy_action_types::ACTION_SNAPSHOT;

    const BPS_DENOM: u256 = 10000;
    const TREASURY_FEE_BPS: u256 = 125; // 1.25%
    const DEV_FEE_BPS: u256 = 125;      // 1.25%
    const BURN_FEE_BPS: u256 = 250;     // 2.5%
    /// @dev Default minimum staked balance: 10 tokens (18 decimals).
    const DEFAULT_MIN_STAKE: u256 = 10_000_000_000_000_000_000_u256;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(path: ReentrancyGuardComponent, storage: reentrancy_guard, event: ReentrancyGuardEvent);

    #[abi(embed_v0)]
    impl OwnableTwoStepImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;
    impl ReentrancyGuardInternalImpl = ReentrancyGuardComponent::InternalImpl<ContractState>;

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
        pub min_stake: u256,
        pub used_nullifiers: Map<felt252, bool>,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
        #[substorage(v0)]
        pub reentrancy_guard: ReentrancyGuardComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        RewardClaimed: RewardClaimed,
        RootSubmitted: RootSubmitted,
        PrivacyRouterUpdated: PrivacyRouterUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
    }

    /// @notice Emitted when a user successfully claims a reward.
    #[derive(Drop, starknet::Event)]
    pub struct RewardClaimed {
        pub user: ContractAddress,
        pub epoch: u64,
        pub gross_amount: u256,
        pub net_amount: u256,
        pub burned_amount: u256,
    }

    /// @notice Emitted when the backend signer submits a Merkle root for an epoch.
    #[derive(Drop, starknet::Event)]
    pub struct RootSubmitted {
        pub epoch: u64,
        pub root: felt252,
    }

    /// @notice Emitted when the privacy router address is updated.
    #[derive(Drop, starknet::Event)]
    pub struct PrivacyRouterUpdated {
        pub router: ContractAddress,
    }

    /// @notice Initializes token dependencies, fee wallets, backend signer, and protocol start time.
    /// @param admin Initial contract owner (two-step transfer via OZ OwnableComponent).
    /// @param token CAREL token address for reward transfers and burns.
    /// @param staking Staking contract for minimum stake gate.
    /// @param dev Dev wallet receiving 1.25% fee split.
    /// @param treasury Treasury wallet receiving 1.25% fee split.
    /// @param signer Backend signer authorized to submit Merkle roots.
    /// @param protocol_start Protocol start timestamp.
    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        token: ContractAddress,
        staking: ContractAddress,
        dev: ContractAddress,
        treasury: ContractAddress,
        signer: ContractAddress,
        protocol_start: u64
    ) {
        self.ownable.initializer(admin);
        self.token_address.write(token);
        self.staking_contract.write(staking);
        self.dev_wallet.write(dev);
        self.treasury_wallet.write(treasury);
        self.backend_signer.write(signer);
        self.start_time.write(protocol_start);
        self.min_stake.write(DEFAULT_MIN_STAKE);
    }

    #[abi(embed_v0)]
    impl SnapshotDistributorImpl of super::ISnapshotDistributor<ContractState> {
        /// @inheritdoc ISnapshotDistributor
        fn submit_merkle_root(ref self: ContractState, epoch: u64, root: felt252) {
            assert!(get_caller_address() == self.backend_signer.read(), "Bukan authorized signer");
            let existing = self.merkle_roots.entry(epoch).read();
            assert!(existing == 0, "Root already finalized for epoch");
            self.merkle_roots.entry(epoch).write(root);
            self.emit(Event::RootSubmitted(RootSubmitted { epoch, root }));
        }

        /// @inheritdoc ISnapshotDistributor
        fn claim_reward(ref self: ContractState, epoch: u64, amount: u256, proof: Span<felt252>) {
            self.reentrancy_guard.start();
            let user = get_caller_address();
            assert!(!self.claimed.entry((epoch, user)).read(), "Sudah melakukan claim");

            let staking_disp = IStakingDispatcher { contract_address: self.staking_contract.read() };
            let min_stake = self.min_stake.read();
            assert!(staking_disp.get_user_stake(user) >= min_stake, "Stake tidak mencukupi");

            let leaf = PoseidonTrait::new()
                .update_with(user)
                .update_with(amount)
                .update_with(epoch)
                .finalize();
            let root = self.merkle_roots.entry(epoch).read();
            assert!(root != 0, "Merkle root not set");
            assert!(self.verify_proof(proof, root, leaf), "Merkle proof tidak valid");

            self.claimed.entry((epoch, user)).write(true);

            let treasury_tax = (amount * TREASURY_FEE_BPS) / BPS_DENOM;
            let dev_tax = (amount * DEV_FEE_BPS) / BPS_DENOM;
            let burn_tax = (amount * BURN_FEE_BPS) / BPS_DENOM;
            let net_reward = amount - treasury_tax - dev_tax - burn_tax;

            let token_disp = ICarelTokenDispatcher { contract_address: self.token_address.read() };
            let ok = token_disp.transfer(user, net_reward);
            assert!(ok, "Token transfer failed");
            if treasury_tax > 0 {
                let ok = token_disp.transfer(self.treasury_wallet.read(), treasury_tax);
                assert!(ok, "Token transfer failed");
            }
            if dev_tax > 0 {
                let ok = token_disp.transfer(self.dev_wallet.read(), dev_tax);
                assert!(ok, "Token transfer failed");
            }
            if burn_tax > 0 {
                token_disp.burn(burn_tax);
            }
            self.reentrancy_guard.end();

            self.emit(Event::RewardClaimed(RewardClaimed {
                user,
                epoch,
                gross_amount: amount,
                net_amount: net_reward,
                burned_amount: burn_tax,
            }));
        }

        /// @inheritdoc ISnapshotDistributor
        fn batch_claim_rewards(
            ref self: ContractState,
            epoch: u64,
            claims: Array<BatchClaim>,
            proofs: Span<felt252>
        ) {
            self.reentrancy_guard.start();
            let root = self.merkle_roots.entry(epoch).read();
            assert!(root != 0, "Merkle root not set");

            let staking_disp = IStakingDispatcher { contract_address: self.staking_contract.read() };
            let min_stake = self.min_stake.read();

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

                let treasury_tax = (claim.amount * TREASURY_FEE_BPS) / BPS_DENOM;
                let dev_tax = (claim.amount * DEV_FEE_BPS) / BPS_DENOM;
                let burn_tax = (claim.amount * BURN_FEE_BPS) / BPS_DENOM;
                let net_reward = claim.amount - treasury_tax - dev_tax - burn_tax;

                let token_disp = ICarelTokenDispatcher { contract_address: self.token_address.read() };
                let ok = token_disp.transfer(claim.user, net_reward);
                assert!(ok, "Token transfer failed");
                if treasury_tax > 0 {
                    let ok = token_disp.transfer(self.treasury_wallet.read(), treasury_tax);
                    assert!(ok, "Token transfer failed");
                }
                if dev_tax > 0 {
                    let ok = token_disp.transfer(self.dev_wallet.read(), dev_tax);
                    assert!(ok, "Token transfer failed");
                }
                if burn_tax > 0 {
                    token_disp.burn(burn_tax);
                }

                self.emit(Event::RewardClaimed(RewardClaimed {
                    user: claim.user,
                    epoch,
                    gross_amount: claim.amount,
                    net_amount: net_reward,
                    burned_amount: burn_tax,
                }));
                i += 1;
            };
            self.reentrancy_guard.end();
        }

        /// @inheritdoc ISnapshotDistributor
        fn is_claimed(self: @ContractState, epoch: u64, user: ContractAddress) -> bool {
            self.claimed.entry((epoch, user)).read()
        }
    }

    #[abi(embed_v0)]
    impl SnapshotDistributorAdminImpl of super::ISnapshotDistributorAdmin<ContractState> {
        /// @inheritdoc ISnapshotDistributorAdmin
        fn set_backend_signer(ref self: ContractState, signer: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!signer.is_zero(), "Signer required");
            self.backend_signer.write(signer);
        }

        /// @inheritdoc ISnapshotDistributorAdmin
        fn set_staking_contract(ref self: ContractState, staking: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!staking.is_zero(), "Staking required");
            self.staking_contract.write(staking);
        }

        /// @inheritdoc ISnapshotDistributorAdmin
        fn set_dev_wallet(ref self: ContractState, dev: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!dev.is_zero(), "Dev wallet required");
            self.dev_wallet.write(dev);
        }

        /// @inheritdoc ISnapshotDistributorAdmin
        fn set_treasury_wallet(ref self: ContractState, treasury: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!treasury.is_zero(), "Treasury wallet required");
            self.treasury_wallet.write(treasury);
        }

        /// @inheritdoc ISnapshotDistributorAdmin
        fn set_min_stake(ref self: ContractState, min_stake: u256) {
            self.ownable.assert_only_owner();
            self.min_stake.write(min_stake);
        }
    }

    #[abi(embed_v0)]
    impl SnapshotDistributorPrivacyImpl of super::ISnapshotDistributorPrivacy<ContractState> {
        /// @inheritdoc ISnapshotDistributorPrivacy
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
            self.emit(Event::PrivacyRouterUpdated(PrivacyRouterUpdated { router }));
        }

        /// @inheritdoc ISnapshotDistributorPrivacy
        fn submit_private_snapshot_action(
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
        fn hash_pair(self: @ContractState, left: felt252, right: felt252) -> felt252 {
            let left_u256: u256 = left.into();
            let right_u256: u256 = right.into();
            if left_u256 < right_u256 {
                PoseidonTrait::new().update(left).update(right).finalize()
            } else {
                PoseidonTrait::new().update(right).update(left).finalize()
            }
        }

        fn verify_proof(self: @ContractState, proof: Span<felt252>, root: felt252, leaf: felt252) -> bool {
            let mut computed_hash = leaf;
            for i in 0..proof.len() {
                computed_hash = self.hash_pair(computed_hash, *proof.at(i));
            };
            computed_hash == root
        }

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
