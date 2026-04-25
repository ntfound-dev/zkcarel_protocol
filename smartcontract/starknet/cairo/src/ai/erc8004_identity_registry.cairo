use starknet::ContractAddress;

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct AgentMeta {
    pub owner: ContractAddress,
    pub operator: ContractAddress,
    pub wallet: ContractAddress,
    pub created_at: u64,
    pub updated_at: u64,
    pub active: bool,
}

// ERC-8004 Identity Registry (Starknet adaptation).
// Stores agent ownership, operator, wallet binding, and metadata pointers.
#[starknet::interface]
pub trait IERC8004IdentityRegistry<TContractState> {
    // Registers a new agent and returns the agent id.
    fn register_agent(
        ref self: TContractState,
        operator: ContractAddress,
        agent_uri: ByteArray,
        metadata_uri: ByteArray,
        metadata_hash: felt252
    ) -> felt252;
    // Updates the operator for a given agent id.
    fn set_operator(ref self: TContractState, agent_id: felt252, operator: ContractAddress);
    // Updates the agent URI for a given agent id.
    fn set_agent_uri(ref self: TContractState, agent_id: felt252, agent_uri: ByteArray);
    // Updates metadata pointers for a given agent id.
    fn set_metadata(
        ref self: TContractState,
        agent_id: felt252,
        metadata_uri: ByteArray,
        metadata_hash: felt252
    );
    // Links an agent wallet using a signature from the wallet.
    fn set_agent_wallet(
        ref self: TContractState,
        agent_id: felt252,
        wallet: ContractAddress,
        signature: Span<felt252>
    );
    // Unlinks the agent wallet (owner or wallet).
    fn unset_agent_wallet(ref self: TContractState, agent_id: felt252);
    // Updates active flag for a given agent id.
    fn set_active(ref self: TContractState, agent_id: felt252, active: bool);
    // Returns agent metadata bundle.
    fn get_agent(
        self: @TContractState,
        agent_id: felt252
    ) -> (AgentMeta, ByteArray, ByteArray, felt252);
    // Returns current operator for a given agent id.
    fn get_operator(self: @TContractState, agent_id: felt252) -> ContractAddress;
    // Returns agent wallet for a given agent id.
    fn get_agent_wallet(self: @TContractState, agent_id: felt252) -> ContractAddress;
    // Returns wallet set nonce for replay protection.
    fn get_wallet_set_nonce(self: @TContractState, wallet: ContractAddress) -> u64;
}

// Minimal Starknet account signature interface (SRC-6 compatible).
#[starknet::interface]
pub trait ISignatureAccount<TContractState> {
    // Returns `'VALID'` when signature is valid for the given hash.
    fn is_valid_signature(
        self: @TContractState,
        message_hash: felt252,
        signature: Span<felt252>
    ) -> felt252;
}

#[starknet::contract]
pub mod ERC8004IdentityRegistry {
    use super::{AgentMeta, IERC8004IdentityRegistry, ISignatureAccountDispatcher, ISignatureAccountDispatcherTrait};
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::{get_block_timestamp, get_caller_address, get_contract_address};
    use openzeppelin::access::ownable::OwnableComponent;
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use core::traits::TryInto;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub next_agent_id: felt252,
        pub agent_meta: Map<felt252, AgentMeta>,
        pub agent_uri: Map<felt252, ByteArray>,
        pub metadata_uri: Map<felt252, ByteArray>,
        pub metadata_hash: Map<felt252, felt252>,
        pub wallet_to_agent: Map<ContractAddress, felt252>,
        pub wallet_nonce: Map<ContractAddress, u64>,
        pub chain_id: felt252,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
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

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress, chain_id: felt252) {
        self.ownable.initializer(admin);
        self.chain_id.write(chain_id);
    }

    fn assert_owner(self: @ContractState, agent_id: felt252) -> AgentMeta {
        let meta = self.agent_meta.entry(agent_id).read();
        assert!(!meta.owner.is_zero(), "Agent not found");
        assert!(meta.owner == get_caller_address(), "Not agent owner");
        meta
    }

    fn compute_wallet_link_hash(
        self: @ContractState,
        agent_id: felt252,
        wallet: ContractAddress,
        nonce: u64
    ) -> felt252 {
        let mut fields: Array<felt252> = array![];
        fields.append(self.chain_id.read());
        let contract_felt: felt252 = get_contract_address().into();
        fields.append(contract_felt);
        fields.append(agent_id);
        let wallet_felt: felt252 = wallet.into();
        fields.append(wallet_felt);
        let nonce_felt: felt252 = nonce.try_into().unwrap();
        fields.append(nonce_felt);
        poseidon_hash_span(fields.span())
    }

    #[abi(embed_v0)]
    impl ERC8004IdentityRegistryImpl of IERC8004IdentityRegistry<ContractState> {
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

        fn set_operator(ref self: ContractState, agent_id: felt252, operator: ContractAddress) {
            let mut meta = assert_owner(@self, agent_id);
            assert!(!operator.is_zero(), "Operator required");
            meta.operator = operator;
            meta.updated_at = get_block_timestamp();
            self.agent_meta.entry(agent_id).write(meta);
            self.emit(Event::OperatorUpdated(OperatorUpdated { agent_id, operator }));
        }

        fn set_agent_uri(ref self: ContractState, agent_id: felt252, agent_uri: ByteArray) {
            let mut meta = assert_owner(@self, agent_id);
            self.agent_uri.entry(agent_id).write(agent_uri);
            meta.updated_at = get_block_timestamp();
            self.agent_meta.entry(agent_id).write(meta);
            self.emit(Event::AgentUpdated(AgentUpdated { agent_id }));
        }

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
            let nonce = self.wallet_nonce.entry(wallet).read();
            let msg_hash = compute_wallet_link_hash(@self, agent_id, wallet, nonce);
            let account = ISignatureAccountDispatcher { contract_address: wallet };
            let ok = account.is_valid_signature(msg_hash, signature);
            assert!(ok == 'VALID', "Invalid wallet signature");

            meta.wallet = wallet;
            meta.updated_at = get_block_timestamp();
            self.agent_meta.entry(agent_id).write(meta);
            self.wallet_to_agent.entry(wallet).write(agent_id);
            self.wallet_nonce.entry(wallet).write(nonce + 1);
            self.emit(Event::WalletLinked(WalletLinked { agent_id, wallet }));
        }

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

        fn set_active(ref self: ContractState, agent_id: felt252, active: bool) {
            let mut meta = assert_owner(@self, agent_id);
            meta.active = active;
            meta.updated_at = get_block_timestamp();
            self.agent_meta.entry(agent_id).write(meta);
            self.emit(Event::AgentActiveUpdated(AgentActiveUpdated { agent_id, active }));
        }

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

        fn get_operator(self: @ContractState, agent_id: felt252) -> ContractAddress {
            self.agent_meta.entry(agent_id).read().operator
        }

        fn get_agent_wallet(self: @ContractState, agent_id: felt252) -> ContractAddress {
            self.agent_meta.entry(agent_id).read().wallet
        }

        fn get_wallet_set_nonce(self: @ContractState, wallet: ContractAddress) -> u64 {
            self.wallet_nonce.entry(wallet).read()
        }
    }
}
