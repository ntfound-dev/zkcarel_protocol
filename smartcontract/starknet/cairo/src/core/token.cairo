use starknet::ContractAddress;

/// @notice Defines mint/burn and role management for CAREL token.
/// @dev Protocol-controlled minting with a hard supply cap.
#[starknet::interface]
pub trait ICarelToken<TContractState> {
    /// @notice Mints `amount` tokens to `recipient`.
    /// @param recipient Address receiving the newly minted tokens.
    /// @param amount Number of tokens to mint (must not exceed supply cap).
    fn mint(ref self: TContractState, recipient: ContractAddress, amount: u256);

    /// @notice Burns `amount` tokens from the caller's balance.
    /// @param amount Number of tokens to burn.
    fn burn(ref self: TContractState, amount: u256);

    /// @notice Grants MINTER_ROLE to `address`.
    /// @param address Address to be granted the minter role.
    fn set_minter(ref self: TContractState, address: ContractAddress);

    /// @notice Grants BURNER_ROLE to `address`.
    /// @param address Address to be granted the burner role.
    fn set_burner(ref self: TContractState, address: ContractAddress);

    /// @notice Returns the current voting power (live balance) for `account`.
    /// @param account Address whose voting power is queried.
    /// @return Current token balance used as voting weight.
    fn get_votes(self: @TContractState, account: ContractAddress) -> u256;

    /// @notice Returns the historical voting power at a specific block number.
    /// @param account Address whose historical balance is queried.
    /// @param block_number Block at which to look up the balance checkpoint.
    /// @return Balance checkpoint value at or before `block_number`.
    fn get_past_votes(self: @TContractState, account: ContractAddress, block_number: u64) -> u256;
}

/// @notice ZK privacy entrypoints for token actions.
#[starknet::interface]
pub trait ICarelTokenPrivacy<TContractState> {
    /// @notice Sets the privacy router contract address.
    /// @dev Only callable by DEFAULT_ADMIN_ROLE. Router must be non-zero.
    /// @param router Address of the deployed privacy router.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);

    /// @notice Submits a ZK-proven private token action to the privacy router.
    /// @dev Replay protection: each nullifier is asserted unused and then marked.
    /// @param old_root Merkle root before this action.
    /// @param new_root Merkle root after this action.
    /// @param nullifiers Span of nullifiers preventing double-spend.
    /// @param commitments Span of new Pedersen commitments.
    /// @param public_inputs Public inputs consumed by the ZK verifier.
    /// @param proof Serialised ZK proof bytes.
    fn submit_private_token_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

/// @notice ERC20 token with capped supply and role-based mint/burn.
/// @dev Uses OpenZeppelin ERC20 and AccessControl components.
#[starknet::contract]
pub mod CarelToken {
    use openzeppelin::token::erc20::ERC20Component;
    use openzeppelin::access::accesscontrol::{AccessControlComponent, DEFAULT_ADMIN_ROLE};
    use openzeppelin::introspection::src5::SRC5Component;
    use starknet::ContractAddress;
    use starknet::{get_caller_address, get_block_number};
    use starknet::storage::*;
    use core::num::traits::Zero;
    use core::traits::TryInto;
    use crate::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy_action_types::ACTION_TOKEN;

    component!(path: ERC20Component, storage: erc20, event: ERC20Event);
    component!(path: AccessControlComponent, storage: accesscontrol, event: AccessControlEvent);
    component!(path: SRC5Component, storage: src5, event: SRC5Event);

    #[derive(Copy, Drop, Serde, starknet::Store)]
    pub struct BalanceCheckpoint {
        pub from_block: u64,
        pub balance: u256,
    }

    /// @dev Records balance snapshots after mint/burn/transfer for governance voting.
    impl ERC20HooksImpl of ERC20Component::ERC20HooksTrait<ContractState> {
        fn before_update(
            ref self: ERC20Component::ComponentState<ContractState>,
            from: ContractAddress,
            recipient: ContractAddress,
            amount: u256
        ) {
            let _ = from;
            let _ = recipient;
            let _ = amount;
        }

        fn after_update(
            ref self: ERC20Component::ComponentState<ContractState>,
            from: ContractAddress,
            recipient: ContractAddress,
            amount: u256
        ) {
            let _ = amount;
            let mut contract_state = self.get_contract_mut();
            let block_number = get_block_number();

            if !from.is_zero() {
                let from_balance = self.balance_of(from);
                contract_state._write_checkpoint(from, block_number, from_balance);
            }
            if !recipient.is_zero() {
                let to_balance = self.balance_of(recipient);
                contract_state._write_checkpoint(recipient, block_number, to_balance);
            }
        }
    }

    #[abi(embed_v0)]
    impl ERC20MixinImpl = ERC20Component::ERC20MixinImpl<ContractState>;
    impl ERC20InternalImpl = ERC20Component::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl AccessControlImpl = AccessControlComponent::AccessControlImpl<ContractState>;
    impl AccessControlInternalImpl = AccessControlComponent::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl SRC5Impl = SRC5Component::SRC5Impl<ContractState>;

    pub const MINTER_ROLE: felt252 = selector!("MINTER_ROLE");
    pub const BURNER_ROLE: felt252 = selector!("BURNER_ROLE");

    const ONE_TOKEN: u256 = 1_000_000_000_000_000_000_u256;
    const TOTAL_SUPPLY_CAP: u256 = 1_000_000_000_u256 * ONE_TOKEN; // 1B CAREL

    #[storage]
    pub struct Storage {
        #[substorage(v0)]
        erc20: ERC20Component::Storage,
        #[substorage(v0)]
        accesscontrol: AccessControlComponent::Storage,
        #[substorage(v0)]
        src5: SRC5Component::Storage,
        pub total_minted: u256,
        pub cap: u256,
        pub balance_checkpoints: Map<(ContractAddress, u64), BalanceCheckpoint>,
        pub num_checkpoints: Map<ContractAddress, u64>,
        pub privacy_router: ContractAddress,
        pub used_nullifiers: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        ERC20Event: ERC20Component::Event,
        #[flat]
        AccessControlEvent: AccessControlComponent::Event,
        #[flat]
        SRC5Event: SRC5Component::Event,
    }

    /// @notice Initializes the CAREL token contract.
    /// @dev Sets name/symbol, admin role, and total supply cap.
    /// @param multisig_admin Address that receives DEFAULT_ADMIN_ROLE at deployment.
    #[constructor]
    fn constructor(ref self: ContractState, multisig_admin: ContractAddress) {
        let name: ByteArray = "Carel Protocol";
        let symbol: ByteArray = "CAREL";

        self.erc20.initializer(name, symbol);
        self.accesscontrol.initializer();
        self.accesscontrol._grant_role(DEFAULT_ADMIN_ROLE, multisig_admin);
        self.total_minted.write(0);
        self.cap.write(TOTAL_SUPPLY_CAP);
    }

    #[abi(embed_v0)]
    impl CarelTokenImpl of super::ICarelToken<ContractState> {
        /// @notice Mints `amount` tokens to `recipient`.
        /// @dev Requires MINTER_ROLE. Reverts if total supply cap would be exceeded.
        /// @param recipient Address receiving the newly minted tokens.
        /// @param amount Number of tokens to mint.
        fn mint(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            self.accesscontrol.assert_only_role(MINTER_ROLE);
            let new_total = self.total_minted.read() + amount;
            assert!(new_total <= self.cap.read(), "Total supply cap exceeded");
            self.total_minted.write(new_total);
            self.erc20.mint(recipient, amount);
        }

        /// @notice Burns `amount` tokens from the caller's balance.
        /// @dev Requires BURNER_ROLE. Reverts if burn amount exceeds total minted.
        /// @param amount Number of tokens to burn.
        fn burn(ref self: ContractState, amount: u256) {
            self.accesscontrol.assert_only_role(BURNER_ROLE);
            let caller = get_caller_address();
            let total = self.total_minted.read();
            assert!(total >= amount, "Burn exceeds minted supply");
            self.total_minted.write(total - amount);
            self.erc20.burn(caller, amount);
        }

        /// @notice Grants MINTER_ROLE to `address`.
        /// @dev Requires DEFAULT_ADMIN_ROLE.
        /// @param address Address to be granted the minter role.
        fn set_minter(ref self: ContractState, address: ContractAddress) {
            self.accesscontrol.assert_only_role(DEFAULT_ADMIN_ROLE);
            self.accesscontrol._grant_role(MINTER_ROLE, address);
        }

        /// @notice Grants BURNER_ROLE to `address`.
        /// @dev Requires DEFAULT_ADMIN_ROLE.
        /// @param address Address to be granted the burner role.
        fn set_burner(ref self: ContractState, address: ContractAddress) {
            self.accesscontrol.assert_only_role(DEFAULT_ADMIN_ROLE);
            self.accesscontrol._grant_role(BURNER_ROLE, address);
        }

        /// @notice Returns the current voting power (live balance) for `account`.
        /// @param account Address whose voting power is queried.
        /// @return Current ERC20 balance used as voting weight.
        fn get_votes(self: @ContractState, account: ContractAddress) -> u256 {
            self.erc20.balance_of(account)
        }

        /// @notice Returns the historical voting power at a specific block number.
        /// @dev Performs binary search over on-chain checkpoints.
        /// @param account Address whose historical balance is queried.
        /// @param block_number Block at which to look up the balance checkpoint.
        /// @return Balance checkpoint value at or before `block_number`.
        fn get_past_votes(self: @ContractState, account: ContractAddress, block_number: u64) -> u256 {
            let count = self.num_checkpoints.entry(account).read();
            if count == 0 {
                return 0;
            }

            let last_idx = count - 1;
            let last = self.balance_checkpoints.entry((account, last_idx)).read();
            if last.from_block <= block_number {
                return last.balance;
            }

            let first = self.balance_checkpoints.entry((account, 0)).read();
            if block_number < first.from_block {
                return 0;
            }

            // Binary search over checkpoints.
            let mut low: u64 = 0;
            let mut high: u64 = last_idx;
            while low < high {
                let mid: u64 = (low + high + 1) / 2;
                let mid_cp = self.balance_checkpoints.entry((account, mid)).read();
                if mid_cp.from_block <= block_number {
                    low = mid;
                } else {
                    high = mid - 1;
                }
            }

            self.balance_checkpoints.entry((account, low)).read().balance
        }
    }

    #[abi(embed_v0)]
    impl CarelTokenPrivacyImpl of super::ICarelTokenPrivacy<ContractState> {
        /// @notice Sets the privacy router contract address.
        /// @dev Only callable by DEFAULT_ADMIN_ROLE. Router must be non-zero.
        /// @param router Address of the deployed privacy router.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.accesscontrol.assert_only_role(DEFAULT_ADMIN_ROLE);
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        /// @notice Submits a ZK-proven private token action to the privacy router.
        /// @dev Iterates nullifiers for replay protection before dispatching to router.
        /// @param old_root Merkle root before this action.
        /// @param new_root Merkle root after this action.
        /// @param nullifiers Span of nullifiers preventing double-spend.
        /// @param commitments Span of new Pedersen commitments.
        /// @param public_inputs Public inputs consumed by the ZK verifier.
        /// @param proof Serialised ZK proof bytes.
        fn submit_private_token_action(
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

            // Nullifier replay protection
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
                ACTION_TOKEN,
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
        /// @dev Writes or updates a balance checkpoint for `account` at `block_number`.
        /// @param account Address whose checkpoint is updated.
        /// @param block_number Block number for the snapshot.
        /// @param balance Token balance at `block_number`.
        fn _write_checkpoint(
            ref self: ContractState,
            account: ContractAddress,
            block_number: u64,
            balance: u256
        ) {
            let count = self.num_checkpoints.entry(account).read();
            if count == 0 {
                let cp = BalanceCheckpoint { from_block: block_number, balance };
                self.balance_checkpoints.entry((account, 0)).write(cp);
                self.num_checkpoints.entry(account).write(1);
                return;
            }

            let last_idx = count - 1;
            let last = self.balance_checkpoints.entry((account, last_idx)).read();
            if last.from_block == block_number {
                let updated = BalanceCheckpoint { from_block: block_number, balance };
                self.balance_checkpoints.entry((account, last_idx)).write(updated);
                return;
            }

            let cp = BalanceCheckpoint { from_block: block_number, balance };
            self.balance_checkpoints.entry((account, count)).write(cp);
            self.num_checkpoints.entry(account).write(count + 1);
        }
    }
}
