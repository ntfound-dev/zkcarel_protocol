// Private swap entrypoint with proof-based validation.
// Enforces nullifier replay protection and commitment binding.
#[starknet::interface]
trait IZkVerifier<TContractState> {
    // Verifies a zero-knowledge proof via configured verifier.
    fn verify_proof(self: @TContractState, proof: Span<felt252>) -> bool;
}

#[contract]
mod PrivateSwap {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use array::ArrayTrait;
    use option::OptionTrait;
    use super::ICARELToken;
    use super::ITreasury;
    use super::IZkCarelNFT;
    use super::{IZkVerifierDispatcher, IZkVerifierDispatcherTrait};
    use core::num::traits::Zero;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_PRIVATE_SWAP;

    #[storage]
    struct Storage {
        owner: ContractAddress,
        treasury: ContractAddress,
        points_contract: ContractAddress,
        nft_contract: ContractAddress,
        router: ContractAddress,
        privacy_router: ContractAddress,
        private_fee_bps: u64,
        zk_verifier: ContractAddress,
        nullifiers: LegacyMap<felt252, bool>,
        commitments: LegacyMap<ContractAddress, Array<felt252>>,
        max_private_amount: u256,
        daily_private_limit: LegacyMap<ContractAddress, (u256, u64)>, // (amount, reset_time)
        whitelisted_tokens: LegacyMap<ContractAddress, bool>,
    }

    #[derive(Drop, Serde)]
    struct PrivateSwapParams {
        from_token: ContractAddress,
        to_token: ContractAddress,
        amount: u256, // Hidden amount (for ZK proof)
        min_amount_out: u256,
        recipient: ContractAddress,
        deadline: u64,
        nullifier: felt252,
        proof: Array<felt252>,
        commitment: felt252,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        PrivateSwapExecuted: PrivateSwapExecuted,
        CommitmentAdded: CommitmentAdded,
        NullifierUsed: NullifierUsed,
        PrivateLimitUpdated: PrivateLimitUpdated,
    }

    #[derive(Drop, starknet::Event)]
    struct PrivateSwapExecuted {
        user: ContractAddress,
        nullifier: felt252,
        from_token: ContractAddress,
        to_token: ContractAddress,
        fee: u256,
        timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct CommitmentAdded {
        user: ContractAddress,
        commitment: felt252,
        timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct NullifierUsed {
        nullifier: felt252,
        timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct PrivateLimitUpdated {
        max_amount: u256,
        daily_limit: u256,
    }

    // Initializes private swap dependencies and default fee/limit configuration.
    // treasury_address/points_contract_address/nft_contract_address/router_address: dependency contracts.
    #[constructor]
    fn constructor(
        treasury_address: ContractAddress,
        points_contract_address: ContractAddress,
        nft_contract_address: ContractAddress,
        router_address: ContractAddress
    ) {
        storage.owner.write(get_caller_address());
        storage.treasury.write(treasury_address);
        storage.points_contract.write(points_contract_address);
        storage.nft_contract.write(nft_contract_address);
        storage.router.write(router_address);
        storage.private_fee_bps.write(10); // 0.1%
        storage.max_private_amount.write(10000 * 10**18); // 10,000 tokens max
        let zero: ContractAddress = 0.try_into().unwrap();
        storage.zk_verifier.write(zero); // Will be set later
        storage.privacy_router.write(zero);
        
        // Whitelist common tokens
        let zero: ContractAddress = 0.try_into().unwrap();
        storage.whitelisted_tokens.write(zero, true); // ETH
    }

    // Sets the privacy router used for Hide Mode private swap actions.
    #[external(v0)]
    fn set_privacy_router(router: ContractAddress) {
        assert(get_caller_address() == storage.owner.read(), 'Unauthorized owner');
        assert(!router.is_zero(), 'Privacy router required');
        storage.privacy_router.write(router);
    }

    // Relays a private swap payload to privacy router for verification and execution.
    // `nullifiers` prevent replay and `commitments` bind the intended state transition.
    #[external(v0)]
    fn submit_private_swap_action(
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    ) {
        let router = storage.privacy_router.read();
        assert(!router.is_zero(), 'Privacy router not set');
        let dispatcher = IPrivacyRouterDispatcher { contract_address: router };
        dispatcher.submit_action(
            ACTION_PRIVATE_SWAP,
            old_root,
            new_root,
            nullifiers,
            commitments,
            public_inputs,
            proof
        );
    }

    // Executes a private swap after proof, nullifier, commitment, and daily-limit checks.
    // `params` carries hidden swap payload, proof data, and execution constraints.
    #[external(v0)]
    fn execute_private_swap(params: PrivateSwapParams) -> u256 {
        let user = get_caller_address();
        
        // Validations
        assert(params.deadline > get_block_timestamp(), 'Deadline expired');
        let zero: ContractAddress = 0.try_into().unwrap();
        assert(params.recipient != zero, 'Invalid recipient');
        assert(storage.whitelisted_tokens.read(params.from_token), 'From token not whitelisted');
        assert(storage.whitelisted_tokens.read(params.to_token), 'To token not whitelisted');
        
        // Verify ZK proof
        assert(_verify_zk_proof(params.proof), 'Invalid ZK proof');
        
        // Check nullifier not used
        assert(!storage.nullifiers.read(params.nullifier), 'Nullifier already used');
        
        // Check commitment exists for user
        let user_commitments = storage.commitments.read(user);
        let mut commitment_exists = false;
        let commitments_len = user_commitments.len();
        let mut i = 0;
        
        loop {
            if i >= commitments_len {
                break;
            }
            if user_commitments.at(i) == params.commitment {
                commitment_exists = true;
                break;
            }
            i += 1;
        }
        assert(commitment_exists, 'Commitment not found');
        
        // Check daily private limit
        let (daily_amount, reset_time) = storage.daily_private_limit.read(user);
        let current_time = get_block_timestamp();
        
        // Reset if 24 hours have passed
        let mut effective_daily = daily_amount;
        let mut effective_reset = reset_time;
        if current_time >= reset_time + 24 * 3600 {
            effective_daily = 0;
            effective_reset = current_time;
        }
        
        assert(effective_daily + params.amount <= storage.max_private_amount.read(), 'Daily private limit exceeded');
        
        // Update daily limit
        storage.daily_private_limit.write(user, (effective_daily + params.amount, effective_reset));
        
        // Mark nullifier as used
        storage.nullifiers.write(params.nullifier, true);
        
        // Calculate fee
        let fee_amount = (params.amount * storage.private_fee_bps.read().into()) / 10000;
        let amount_after_fee = params.amount - fee_amount;
        
        // Transfer tokens from user (using regular approval since amount is hidden)
        // In real implementation, would use private transfer mechanism
        
        // Transfer fee to treasury
        if fee_amount > 0 {
            let from_token_contract = ICARELTokenDispatcher { contract_address: params.from_token };
            from_token_contract.transfer(storage.treasury.read(), fee_amount);
            
            let treasury = ITreasuryDispatcher { contract_address: storage.treasury.read() };
            treasury.collect_fee(fee_amount, 'private_swap');
        }
        
        // Execute swap through router (private version)
        // This would call a modified router function that doesn't reveal amounts
        
        // Points are calculated off-chain from events.
        
        // Check and apply NFT discount (if any)
        let nft_contract = IZkCarelNFTDispatcher { contract_address: storage.nft_contract.read() };
        let (has_active_nft, discount_percent) = nft_contract.has_active_discount(user);
        
        if has_active_nft {
            // Apply discount (refund fee percentage)
            let discount_refund = (fee_amount * discount_percent.into()) / 100;
            
            if discount_refund > 0 {
                let from_token_contract = ICARELTokenDispatcher { contract_address: params.from_token };
                from_token_contract.transfer(user, discount_refund);
                
                // Update fee_amount for event
                // fee_amount = fee_amount - discount_refund;
            }
            
            // Use NFT discount
            nft_contract.use_discount(user, params.nullifier);
        }
        
        // Emit events (without revealing sensitive data)
        let mut events = array![];
        events.append(Event::PrivateSwapExecuted(PrivateSwapExecuted {
            user: params.recipient,
            nullifier: params.nullifier,
            from_token: params.from_token,
            to_token: params.to_token,
            fee: fee_amount,
            timestamp: get_block_timestamp(),
        }));
        
        events.append(Event::NullifierUsed(NullifierUsed {
            nullifier: params.nullifier,
            timestamp: get_block_timestamp(),
        }));
        
        starknet::emit_event_syscall(events.span()).unwrap();
        
        amount_after_fee
    }

    // Stores a commitment for caller to be referenced by future private swaps.
    // `commitment` binds future private swap intent to caller state.
    #[external(v0)]
    fn add_commitment(commitment: felt252) {
        let user = get_caller_address();
        
        // Add commitment to user's list
        let mut user_commitments = storage.commitments.read(user);
        user_commitments.append(commitment);
        storage.commitments.write(user, user_commitments);
        
        let mut events = array![];
        events.append(Event::CommitmentAdded(CommitmentAdded {
            user: user,
            commitment: commitment,
            timestamp: get_block_timestamp(),
        }));
        starknet::emit_event_syscall(events.span()).unwrap();
    }

    // Public helper to verify proof data against configured zk verifier.
    // `proof` is forwarded to the configured zk verifier contract.
    #[external(v0)]
    fn verify_proof(proof: Array<felt252>) -> bool {
        _verify_zk_proof(proof)
    }

    // Updates private swap fee in basis points.
    // `fee_bps` defines private-swap fee charged on input amount.
    #[external(v0)]
    fn set_private_fee(fee_bps: u64) {
        assert(get_caller_address() == storage.owner.read(), 'Unauthorized');
        storage.private_fee_bps.write(fee_bps);
    }

    // Updates zk verifier contract address used by `_verify_zk_proof`.
    // `verifier_address` must implement `IZkVerifier`.
    #[external(v0)]
    fn set_zk_verifier(verifier_address: ContractAddress) {
        assert(get_caller_address() == storage.owner.read(), 'Unauthorized');
        storage.zk_verifier.write(verifier_address);
    }

    // Updates max private amount and emits current limit configuration.
    // max_amount/daily_limit: admin-configured anti-abuse thresholds.
    #[external(v0)]
    fn set_private_limits(max_amount: u256, daily_limit: u256) {
        assert(get_caller_address() == storage.owner.read(), 'Unauthorized');
        storage.max_private_amount.write(max_amount);
        
        let mut events = array![];
        events.append(Event::PrivateLimitUpdated(PrivateLimitUpdated {
            max_amount: max_amount,
            daily_limit: daily_limit,
        }));
        starknet::emit_event_syscall(events.span()).unwrap();
    }

    // Adds or removes token from private swap allowlist.
    // token/is_whitelisted: token address and desired allowlist state.
    #[external(v0)]
    fn whitelist_token(token: ContractAddress, is_whitelisted: bool) {
        assert(get_caller_address() == storage.owner.read(), 'Unauthorized');
        storage.whitelisted_tokens.write(token, is_whitelisted);
    }

    // Returns current daily private usage and reset timestamp for a user.
    // `user` is the account whose private usage window is queried.
    #[external(v0)]
    fn get_daily_private_usage(user: ContractAddress) -> (u256, u64) {
        storage.daily_private_limit.read(user)
    }

    // Resets daily private usage accumulator for a user.
    // `user` is the account whose daily limit state is reset by admin.
    #[external(v0)]
    fn reset_daily_limit(user: ContractAddress) {
        assert(get_caller_address() == storage.owner.read(), 'Unauthorized');
        storage.daily_private_limit.write(user, (0, get_block_timestamp()));
    }

    // Internal helper that dispatches proof verification to zk verifier contract.
    fn _verify_zk_proof(proof: Array<felt252>) -> bool {
        let verifier = storage.zk_verifier.read();
        let zero: ContractAddress = 0.try_into().unwrap();
        assert(verifier != zero, 'Verifier not set');
        let dispatcher = IZkVerifierDispatcher { contract_address: verifier };
        dispatcher.verify_proof(proof.span())
    }
}
