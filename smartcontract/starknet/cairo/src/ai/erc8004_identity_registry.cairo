use starknet::ContractAddress;

/// @notice Core metadata for an ERC-8004 registered agent.
#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct AgentMeta {
    pub owner: ContractAddress,
    pub operator: ContractAddress,
    pub wallet: ContractAddress,
    pub created_at: u64,
    pub updated_at: u64,
    pub active: bool,
}

/// @title IERC8004IdentityRegistry
/// @notice ERC-8004 Identity Registry (Starknet adaptation).
/// @dev Stores agent ownership, operator delegation, wallet binding, and off-chain metadata pointers.
///      Wallet binding uses a NoncesComponent-backed sequential nonce to prevent replay of link signatures.
#[starknet::interface]
pub trait IERC8004IdentityRegistry<TContractState> {
    /// @notice Registers a new agent and returns its unique agent ID.
    /// @dev Agent IDs are monotonically incrementing felt252 values starting at 1.
    ///      If `operator` is zero, the caller is set as operator.
    /// @param operator Address that may perform operator actions on behalf of this agent.
    /// @param agent_uri Off-chain URI pointing to the agent's metadata document.
    /// @param metadata_uri Off-chain URI for extended metadata.
    /// @param metadata_hash Integrity hash of the metadata document.
    /// @return agent_id Unique identifier for the newly registered agent.
    fn register_agent(
        ref self: TContractState,
        operator: ContractAddress,
        agent_uri: ByteArray,
        metadata_uri: ByteArray,
        metadata_hash: felt252
    ) -> felt252;

    /// @notice Updates the operator address for an agent.
    /// @dev Callable only by the agent owner. New operator must be non-zero.
    /// @param agent_id Target agent identifier.
    /// @param operator New operator address.
    fn set_operator(ref self: TContractState, agent_id: felt252, operator: ContractAddress);

    /// @notice Updates the agent URI for an agent.
    /// @dev Callable only by the agent owner.
    /// @param agent_id Target agent identifier.
    /// @param agent_uri New off-chain agent URI.
    fn set_agent_uri(ref self: TContractState, agent_id: felt252, agent_uri: ByteArray);

    /// @notice Updates the metadata URI and integrity hash for an agent.
    /// @dev Callable only by the agent owner. `metadata_hash` must be non-zero.
    /// @param agent_id Target agent identifier.
    /// @param metadata_uri New metadata URI.
    /// @param metadata_hash New metadata integrity hash.
    fn set_metadata(
        ref self: TContractState,
        agent_id: felt252,
        metadata_uri: ByteArray,
        metadata_hash: felt252
    );

    /// @notice Links an on-chain wallet to an agent using a signature from the wallet.
    /// @dev The wallet signs a Poseidon hash of (chain_id, contract, agent_id, wallet, nonce)
    ///      where `nonce` is fetched via `get_wallet_set_nonce(wallet)`. The nonce is consumed
    ///      via NoncesComponent after successful verification. Each wallet can only be linked once.
    /// @param agent_id Target agent identifier (agent must not already have a wallet).
    /// @param wallet The wallet address to link. Must not be linked to another agent.
    /// @param signature SRC-6 signature from `wallet` over the computed link hash.
    fn set_agent_wallet(
        ref self: TContractState,
        agent_id: felt252,
        wallet: ContractAddress,
        signature: Span<felt252>
    );

    /// @notice Unlinks the wallet from an agent.
    /// @dev Callable by either the agent owner or the linked wallet.
    /// @param agent_id Target agent identifier (must have a linked wallet).
    fn unset_agent_wallet(ref self: TContractState, agent_id: felt252);

    /// @notice Sets the active flag for an agent.
    /// @dev Callable only by the agent owner. Inactive agents are rejected by `AIPlanRouter`.
    /// @param agent_id Target agent identifier.
    /// @param active New active state.
    fn set_active(ref self: TContractState, agent_id: felt252, active: bool);

    /// @notice Returns the full metadata bundle for an agent.
    /// @param agent_id The agent to query.
    /// @return (meta, agent_uri, metadata_uri, metadata_hash). `meta.owner == zero` if not found.
    fn get_agent(
        self: @TContractState,
        agent_id: felt252
    ) -> (AgentMeta, ByteArray, ByteArray, felt252);

    /// @notice Returns the current operator address for an agent.
    /// @param agent_id The agent to query.
    /// @return Operator address, or zero if the agent does not exist.
    fn get_operator(self: @TContractState, agent_id: felt252) -> ContractAddress;

    /// @notice Returns the linked wallet address for an agent.
    /// @param agent_id The agent to query.
    /// @return Wallet address, or zero if no wallet is linked.
    fn get_agent_wallet(self: @TContractState, agent_id: felt252) -> ContractAddress;

    /// @notice Returns the next expected nonce for a wallet's link signature.
    /// @dev Off-chain signers must call this before constructing the link hash.
    /// @param wallet The wallet address to query.
    /// @return Current nonce value (u64 cast of the NoncesComponent felt252 counter).
    fn get_wallet_set_nonce(self: @TContractState, wallet: ContractAddress) -> u64;
}

/// @notice Minimal Starknet account signature interface (SRC-6 compatible).
#[starknet::interface]
pub trait ISignatureAccount<TContractState> {
    /// @notice Returns `'VALID'` when the signature is valid for the given hash.
    fn is_valid_signature(
        self: @TContractState,
        message_hash: felt252,
        signature: Span<felt252>
    ) -> felt252;
}

/// @title ERC8004IdentityRegistry
/// @notice Implements IERC8004IdentityRegistry with OZ OwnableComponent and NoncesComponent.
/// @dev NoncesComponent replaces the custom `wallet_nonce: Map<ContractAddress, u64>` from the
///      original implementation, providing auditable sequential nonce management.
#[starknet::contract]
pub mod ERC8004IdentityRegistry {
    use super::{AgentMeta, IERC8004IdentityRegistry, ISignatureAccountDispatcher, ISignatureAccountDispatcherTrait};
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::{get_block_timestamp, get_caller_address, get_contract_address};
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::utils::cryptography::nonces::NoncesComponent;
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use core::traits::TryInto;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(path: NoncesComponent, storage: nonces, event: NoncesEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;
    #[abi(embed_v0)]
    impl NoncesImpl = NoncesComponent::NoncesImpl<ContractState>;
    impl NoncesInternalImpl = NoncesComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub next_agent_id: felt252,
        pub agent_meta: Map<felt252, AgentMeta>,
        pub agent_uri: Map<felt252, ByteArray>,
        pub metadata_uri: Map<felt252, ByteArray>,
        pub metadata_hash: Map<felt252, felt252>,
        pub wallet_to_agent: Map<ContractAddress, felt252>,
        pub chain_id: felt252,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
        #[substorage(v0)]
        pub nonces: NoncesComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        AgentRegistered: AgentRegistered,
        AgentUpdated: AgentUpdated,
        OperatorUpdated: OperatorUpdated,
        WalletLinked: WalletLinked,
        WalletUnlinked: WalletUnlinked,
        AgentActiveUpdated: AgentActiveUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        NoncesEvent: NoncesComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AgentRegistered {
        pub agent_id: felt252,
        pub owner: ContractAddress,
        pub operator: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AgentUpdated {
        pub agent_id: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OperatorUpdated {
        pub agent_id: felt252,
        pub operator: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct WalletLinked {
        pub agent_id: felt252,
        pub wallet: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct WalletUnlinked {
        pub agent_id: felt252,
        pub wallet: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AgentActiveUpdated {
        pub agent_id: felt252,
        pub active: bool,
    }

    /// @notice Initializes the registry with the given admin and chain ID.
    /// @param admin Initial owner address (receives OwnableTwoStep ownership).
    /// @param chain_id Starknet chain ID embedded in wallet link hashes (must be non-zero).
    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress, chain_id: felt252) {
        assert!(chain_id != 0, "Chain id required");
        self.ownable.initializer(admin);
        self.chain_id.write(chain_id);
    }

    /// @notice Asserts the caller is the owner of `agent_id` and returns its metadata.
    /// @dev Panics with "Agent not found" or "Not agent owner" on failure.
    /// @param agent_id The agent to check ownership of.
    /// @return The agent's `AgentMeta` struct.
    fn assert_owner(self: @ContractState, agent_id: felt252) -> AgentMeta {
        let meta = self.agent_meta.entry(agent_id).read();
        assert!(!meta.owner.is_zero(), "Agent not found");
        assert!(meta.owner == get_caller_address(), "Not agent owner");
        meta
    }

    /// @notice Computes the Poseidon hash the wallet must sign to authorize linking.
    /// @dev Hash inputs: (chain_id, contract_address, agent_id, wallet_felt, nonce).
    ///      The nonce is the wallet's current NoncesComponent value (consumed after verification).
    /// @param agent_id The agent being linked to.
    /// @param wallet The wallet address requesting linkage.
    /// @param nonce Current sequential nonce for this wallet (felt252 from NoncesComponent).
    /// @return Poseidon hash over the five-element field array.
    fn compute_wallet_link_hash(
        self: @ContractState,
        agent_id: felt252,
        wallet: ContractAddress,
        nonce: felt252
    ) -> felt252 {
        let mut fields: Array<felt252> = array![];
        fields.append(self.chain_id.read());
        let contract_felt: felt252 = get_contract_address().into();
        fields.append(contract_felt);
        fields.append(agent_id);
        let wallet_felt: felt252 = wallet.into();
        fields.append(wallet_felt);
        fields.append(nonce);
        poseidon_hash_span(fields.span())
    }

    #[abi(embed_v0)]
    impl ERC8004IdentityRegistryImpl of IERC8004IdentityRegistry<ContractState> {
        /// @inheritdoc IERC8004IdentityRegistry
        fn register_agent(
            ref self: ContractState,
            operator: ContractAddress,
            agent_uri: ByteArray,
            metadata_uri: ByteArray,
            metadata_hash: felt252
        ) -> felt252 {
            let caller = get_caller_address();
            let op = if operator.is_zero() { caller } else { operator };
            let agent_id = self.next_agent_id.read() + 1;
            let ts = get_block_timestamp();
            let meta = AgentMeta {
                owner: caller,
                operator: op,
                wallet: 0.try_into().unwrap(),
                created_at: ts,
                updated_at: ts,
                active: true,
            };
            self.agent_meta.entry(agent_id).write(meta);
            self.agent_uri.entry(agent_id).write(agent_uri);
            self.metadata_uri.entry(agent_id).write(metadata_uri);
            self.metadata_hash.entry(agent_id).write(metadata_hash);
            self.next_agent_id.write(agent_id);
            self.emit(Event::AgentRegistered(AgentRegistered { agent_id, owner: caller, operator: op }));
            agent_id
        }

        /// @inheritdoc IERC8004IdentityRegistry
        fn set_operator(ref self: ContractState, agent_id: felt252, operator: ContractAddress) {
            let mut meta = assert_owner(@self, agent_id);
            assert!(!operator.is_zero(), "Operator required");
            meta.operator = operator;
            meta.updated_at = get_block_timestamp();
            self.agent_meta.entry(agent_id).write(meta);
            self.emit(Event::OperatorUpdated(OperatorUpdated { agent_id, operator }));
        }

        /// @inheritdoc IERC8004IdentityRegistry
        fn set_agent_uri(ref self: ContractState, agent_id: felt252, agent_uri: ByteArray) {
            let mut meta = assert_owner(@self, agent_id);
            self.agent_uri.entry(agent_id).write(agent_uri);
            meta.updated_at = get_block_timestamp();
            self.agent_meta.entry(agent_id).write(meta);
            self.emit(Event::AgentUpdated(AgentUpdated { agent_id }));
        }

        /// @inheritdoc IERC8004IdentityRegistry
        fn set_metadata(
            ref self: ContractState,
            agent_id: felt252,
            metadata_uri: ByteArray,
            metadata_hash: felt252
        ) {
            let mut meta = assert_owner(@self, agent_id);
            assert!(metadata_hash != 0, "Metadata hash required");
            self.metadata_uri.entry(agent_id).write(metadata_uri);
            self.metadata_hash.entry(agent_id).write(metadata_hash);
            meta.updated_at = get_block_timestamp();
            self.agent_meta.entry(agent_id).write(meta);
            self.emit(Event::AgentUpdated(AgentUpdated { agent_id }));
        }

        /// @inheritdoc IERC8004IdentityRegistry
        fn set_agent_wallet(
            ref self: ContractState,
            agent_id: felt252,
            wallet: ContractAddress,
            signature: Span<felt252>
        ) {
            let mut meta = assert_owner(@self, agent_id);
            assert!(!wallet.is_zero(), "Wallet required");
            assert!(meta.wallet.is_zero(), "Wallet already linked");
            let existing = self.wallet_to_agent.entry(wallet).read();
            assert!(existing == 0, "Wallet already linked");

            // Read current nonce, verify signature, then consume atomically.
            let nonce = self.nonces.nonces(wallet);
            let msg_hash = compute_wallet_link_hash(@self, agent_id, wallet, nonce);
            let account = ISignatureAccountDispatcher { contract_address: wallet };
            let ok = account.is_valid_signature(msg_hash, signature);
            assert!(ok == 'VALID', "Invalid wallet signature");
            self.nonces.use_checked_nonce(wallet, nonce);

            meta.wallet = wallet;
            meta.updated_at = get_block_timestamp();
            self.agent_meta.entry(agent_id).write(meta);
            self.wallet_to_agent.entry(wallet).write(agent_id);
            self.emit(Event::WalletLinked(WalletLinked { agent_id, wallet }));
        }

        /// @inheritdoc IERC8004IdentityRegistry
        fn unset_agent_wallet(ref self: ContractState, agent_id: felt252) {
            let mut meta = self.agent_meta.entry(agent_id).read();
            assert!(!meta.owner.is_zero(), "Agent not found");
            let caller = get_caller_address();
            assert!(caller == meta.owner || caller == meta.wallet, "Not authorized");
            let wallet = meta.wallet;
            assert!(!wallet.is_zero(), "Wallet not linked");
            meta.wallet = 0.try_into().unwrap();
            meta.updated_at = get_block_timestamp();
            self.agent_meta.entry(agent_id).write(meta);
            self.wallet_to_agent.entry(wallet).write(0);
            self.emit(Event::WalletUnlinked(WalletUnlinked { agent_id, wallet }));
        }

        /// @inheritdoc IERC8004IdentityRegistry
        fn set_active(ref self: ContractState, agent_id: felt252, active: bool) {
            let mut meta = assert_owner(@self, agent_id);
            meta.active = active;
            meta.updated_at = get_block_timestamp();
            self.agent_meta.entry(agent_id).write(meta);
            self.emit(Event::AgentActiveUpdated(AgentActiveUpdated { agent_id, active }));
        }

        /// @inheritdoc IERC8004IdentityRegistry
        fn get_agent(
            self: @ContractState,
            agent_id: felt252
        ) -> (AgentMeta, ByteArray, ByteArray, felt252) {
            (
                self.agent_meta.entry(agent_id).read(),
                self.agent_uri.entry(agent_id).read(),
                self.metadata_uri.entry(agent_id).read(),
                self.metadata_hash.entry(agent_id).read()
            )
        }

        /// @inheritdoc IERC8004IdentityRegistry
        fn get_operator(self: @ContractState, agent_id: felt252) -> ContractAddress {
            self.agent_meta.entry(agent_id).read().operator
        }

        /// @inheritdoc IERC8004IdentityRegistry
        fn get_agent_wallet(self: @ContractState, agent_id: felt252) -> ContractAddress {
            self.agent_meta.entry(agent_id).read().wallet
        }

        /// @inheritdoc IERC8004IdentityRegistry
        fn get_wallet_set_nonce(self: @ContractState, wallet: ContractAddress) -> u64 {
            self.nonces.nonces(wallet).try_into().unwrap()
        }
    }
}
