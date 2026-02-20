// Admin controls for mock verifier contracts.
// Test-only helpers to toggle verification results.
#[starknet::interface]
pub trait IMockVerifierAdmin<TContractState> {
    // Test-admin setter for forcing mock verifier pass/fail outcomes in test scenarios.
    fn set_result(ref self: TContractState, result: bool);
}

// Test-only verifier for Garaga adapter.
// Returns a configurable boolean result.
#[starknet::contract]
pub mod MockGaragaVerifier {
    use starknet::storage::*;
    use starknet::ContractAddress;
    use openzeppelin::access::ownable::OwnableComponent;

    #[starknet::interface]
    pub trait IGaragaVerifier<TContractState> {
        // Verifies the supplied proof payload before allowing private state transitions.
            fn verify_proof(self: @TContractState, proof: Span<felt252>, public_inputs: Span<felt252>) -> bool;
    }

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub result: bool,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[constructor]
    // Initializes owner/admin roles plus verifier/router dependencies required by privacy flows.
    fn constructor(ref self: ContractState, admin: ContractAddress, result: bool) {
        self.ownable.initializer(admin);
        self.result.write(result);
    }

    #[abi(embed_v0)]
    impl VerifierImpl of IGaragaVerifier<ContractState> {
        // Verifies the supplied proof payload before allowing private state transitions.
            fn verify_proof(self: @ContractState, proof: Span<felt252>, public_inputs: Span<felt252>) -> bool {
            let _ = proof;
            let _ = public_inputs;
            self.result.read()
        }
    }

    #[abi(embed_v0)]
    impl AdminImpl of super::IMockVerifierAdmin<ContractState> {
        // Test-admin setter for forcing mock verifier pass/fail outcomes in test scenarios.
            fn set_result(ref self: ContractState, result: bool) {
            self.ownable.assert_only_owner();
            self.result.write(result);
        }
    }
}

// Test-only verifier for Tongo adapter.
// Returns a configurable boolean result.
#[starknet::contract]
pub mod MockTongoVerifier {
    use starknet::storage::*;
    use starknet::ContractAddress;
    use openzeppelin::access::ownable::OwnableComponent;

    #[starknet::interface]
    pub trait ITongoVerifier<TContractState> {
        // Verifies the supplied proof payload before allowing private state transitions.
            fn verify_proof(self: @TContractState, proof: Span<felt252>, public_inputs: Span<felt252>) -> bool;
    }

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub result: bool,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[constructor]
    // Initializes owner/admin roles plus verifier/router dependencies required by privacy flows.
    fn constructor(ref self: ContractState, admin: ContractAddress, result: bool) {
        self.ownable.initializer(admin);
        self.result.write(result);
    }

    #[abi(embed_v0)]
    impl VerifierImpl of ITongoVerifier<ContractState> {
        // Verifies the supplied proof payload before allowing private state transitions.
            fn verify_proof(self: @ContractState, proof: Span<felt252>, public_inputs: Span<felt252>) -> bool {
            let _ = proof;
            let _ = public_inputs;
            self.result.read()
        }
    }

    #[abi(embed_v0)]
    impl AdminImpl of super::IMockVerifierAdmin<ContractState> {
        // Test-admin setter for forcing mock verifier pass/fail outcomes in test scenarios.
            fn set_result(ref self: ContractState, result: bool) {
            self.ownable.assert_only_owner();
            self.result.write(result);
        }
    }
}

// Test-only verifier for Semaphore adapter.
// Returns a configurable boolean result.
#[starknet::contract]
pub mod MockSemaphoreVerifier {
    use starknet::storage::*;
    use starknet::ContractAddress;
    use openzeppelin::access::ownable::OwnableComponent;

    #[starknet::interface]
    pub trait ISemaphoreVerifier<TContractState> {
        // Verifies the supplied proof payload before allowing private state transitions.
            fn verify_proof(
            self: @TContractState,
            root: felt252,
            nullifier_hash: felt252,
            signal: felt252,
            proof: Span<felt252>
        ) -> bool;
    }

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub result: bool,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[constructor]
    // Initializes owner/admin roles plus verifier/router dependencies required by privacy flows.
    fn constructor(ref self: ContractState, admin: ContractAddress, result: bool) {
        self.ownable.initializer(admin);
        self.result.write(result);
    }

    #[abi(embed_v0)]
    impl VerifierImpl of ISemaphoreVerifier<ContractState> {
        // Verifies the supplied proof payload before allowing private state transitions.
            fn verify_proof(
            self: @ContractState,
            root: felt252,
            nullifier_hash: felt252,
            signal: felt252,
            proof: Span<felt252>
        ) -> bool {
            let _ = root;
            let _ = nullifier_hash;
            let _ = signal;
            let _ = proof;
            self.result.read()
        }
    }

    #[abi(embed_v0)]
    impl AdminImpl of super::IMockVerifierAdmin<ContractState> {
        // Test-admin setter for forcing mock verifier pass/fail outcomes in test scenarios.
            fn set_result(ref self: ContractState, result: bool) {
            self.ownable.assert_only_owner();
            self.result.write(result);
        }
    }
}
