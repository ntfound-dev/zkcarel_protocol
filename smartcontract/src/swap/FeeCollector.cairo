#[contract]
mod FeeCollector {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use array::ArrayTrait;
    use super::ICARELToken;
    use super::ITreasury;
    use super::IZkCarelRouter;

    #[storage]
    struct Storage {
        owner: ContractAddress,
        router: ContractAddress,
        treasury: ContractAddress,
        collected_fees: LegacyMap<ContractAddress, u256>, // token -> amount
        fee_allocations: LegacyMap<felt252, FeeAllocation>, // fee_type -> allocation
        last_distribution: u64,
        distribution_interval: u64,
        whitelisted_collectors: LegacyMap<ContractAddress, bool>,
    }

    #[derive(Drop, Serde)]
    struct FeeAllocation {
        fee_type: felt252,
        lp_percentage: u64,    // basis points
        dev_percentage: u64,   // basis points
        treasury_percentage: u64, // basis points
        burn_percentage: u64,  // basis points
        lp_wallet: ContractAddress,
        dev_wallet: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        FeeCollected: FeeCollected,
        FeesDistributed: FeesDistributed,
        CollectorWhitelisted: CollectorWhitelisted,
        AllocationUpdated: AllocationUpdated,
    }

    #[derive(Drop, starknet::Event)]
    struct FeeCollected {
        from: ContractAddress,
        token: ContractAddress,
        amount: u256,
        fee_type: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct FeesDistributed {
        token: ContractAddress,
        total_amount: u256,
        lp_amount: u256,
        dev_amount: u256,
        treasury_amount: u256,
        burn_amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct CollectorWhitelisted {
        collector: ContractAddress,
        is_whitelisted: bool,
    }

    #[derive(Drop, starknet::Event)]
    struct AllocationUpdated {
        fee_type: felt252,
        lp_percentage: u64,
        dev_percentage: u64,
        treasury_percentage: u64,
        burn_percentage: u64,
    }

    #[constructor]
    fn constructor(
        router_address: ContractAddress,
        treasury_address: ContractAddress
    ) {
        storage.owner.write(get_caller_address());
        storage.router.write(router_address);
        storage.treasury.write(treasury_address);
        storage.distribution_interval.write(7 * 24 * 3600); // 1 week
        storage.last_distribution.write(get_block_timestamp());
        
        // Whitelist router
        storage.whitelisted_collectors.write(router_address, true);
        
        // Setup default fee allocations
        _setup_default_allocations();
    }

    #[external(v0)]
    fn collect_fee(
        from: ContractAddress,
        token: ContractAddress,
        amount: u256,
        fee_type: felt252
    ) {
        // Only whitelisted collectors can call this
        assert(storage.whitelisted_collectors.read(get_caller_address()), 'Unauthorized');
        
        // Get fee allocation for this fee type
        let allocation = storage.fee_allocations.read(fee_type);
        
        // Transfer fee from caller
        let token_contract = ICARELTokenDispatcher { contract_address: token };
        let allowance = token_contract.allowance(from, get_contract_address());
        assert(allowance >= amount, 'Insufficient allowance');
        
        token_contract.transfer_from(from, get_contract_address(), amount);
        
        // Update collected fees
        let current_fees = storage.collected_fees.read(token);
        storage.collected_fees.write(token, current_fees + amount);
        
        // Emit event
        let mut events = array![];
        events.append(Event::FeeCollected(FeeCollected {
            from: from,
            token: token,
            amount: amount,
            fee_type: fee_type,
        }));
        starknet::emit_event_syscall(events.span()).unwrap();
    }

    #[external(v0)]
    fn distribute_fees(token: ContractAddress) {
        assert(get_caller_address() == storage.owner.read(), 'Unauthorized');
        
        let current_time = get_block_timestamp();
        assert(
            current_time >= storage.last_distribution.read() + storage.distribution_interval.read(),
            'Distribution interval not reached'
        );
        
        let total_fees = storage.collected_fees.read(token);
        assert(total_fees > 0, 'No fees to distribute');
        
        // Distribute each fee type according to its allocation
        let mut total_distributed = 0;
        
        // Get all fee types (simplified - in production would iterate through all)
        let fee_types = array!['swap', 'bridge', 'mev_protection', 'private_mode'];
        let fee_types_len = fee_types.len();
        let mut i = 0;
        
        loop {
            if i >= fee_types_len {
                break;
            }
            
            let fee_type = fee_types.at(i);
            let allocation = storage.fee_allocations.read(fee_type);
            
            // Calculate amounts for this fee type
            // In production, would track fees per type separately
            // For simplicity, we distribute total fees equally among types
            
            let type_fees = total_fees / fee_types_len.into();
            
            let lp_amount = (type_fees * allocation.lp_percentage.into()) / 10000;
            let dev_amount = (type_fees * allocation.dev_percentage.into()) / 10000;
            let treasury_amount = (type_fees * allocation.treasury_percentage.into()) / 10000;
            let burn_amount = (type_fees * allocation.burn_percentage.into()) / 10000;
            
            // Transfer to recipients
            let token_contract = ICARELTokenDispatcher { contract_address: token };
            
            if lp_amount > 0 && allocation.lp_wallet != ContractAddress::default() {
                token_contract.transfer(allocation.lp_wallet, lp_amount);
            }
            
            if dev_amount > 0 && allocation.dev_wallet != ContractAddress::default() {
                token_contract.transfer(allocation.dev_wallet, dev_amount);
            }
            
            if treasury_amount > 0 {
                token_contract.transfer(storage.treasury.read(), treasury_amount);
                let treasury = ITreasuryDispatcher { contract_address: storage.treasury.read() };
                treasury.collect_fee(treasury_amount, fee_type);
            }
            
            if burn_amount > 0 {
                // Burn tokens
                token_contract.burn(get_contract_address(), burn_amount);
            }
            
            total_distributed = total_distributed + lp_amount + dev_amount + treasury_amount + burn_amount;
            
            i += 1;
        }
        
        // Reset collected fees
        storage.collected_fees.write(token, 0);
        storage.last_distribution.write(current_time);
        
        // Emit event
        let mut events = array![];
        events.append(Event::FeesDistributed(FeesDistributed {
            token: token,
            total_amount: total_distributed,
            lp_amount: 0, // Would calculate actual amounts
            dev_amount: 0,
            treasury_amount: 0,
            burn_amount: 0,
        }));
        starknet::emit_event_syscall(events.span()).unwrap();
    }

    #[external(v0)]
    fn update_allocation(
        fee_type: felt252,
        lp_percentage: u64,
        dev_percentage: u64,
        treasury_percentage: u64,
        burn_percentage: u64,
        lp_wallet: ContractAddress,
        dev_wallet: ContractAddress
    ) {
        assert(get_caller_address() == storage.owner.read(), 'Unauthorized');
        
        // Validate percentages sum to 100%
        let total = lp_percentage + dev_percentage + treasury_percentage + burn_percentage;
        assert(total == 10000, 'Percentages must sum to 10000 (100%)');
        
        let allocation = FeeAllocation {
            fee_type: fee_type,
            lp_percentage: lp_percentage,
            dev_percentage: dev_percentage,
            treasury_percentage: treasury_percentage,
            burn_percentage: burn_percentage,
            lp_wallet: lp_wallet,
            dev_wallet: dev_wallet,
        };
        
        storage.fee_allocations.write(fee_type, allocation);
        
        let mut events = array![];
        events.append(Event::AllocationUpdated(AllocationUpdated {
            fee_type: fee_type,
            lp_percentage: lp_percentage,
            dev_percentage: dev_percentage,
            treasury_percentage: treasury_percentage,
            burn_percentage: burn_percentage,
        }));
        starknet::emit_event_syscall(events.span()).unwrap();
    }

    #[external(v0)]
    fn whitelist_collector(collector: ContractAddress, is_whitelisted: bool) {
        assert(get_caller_address() == storage.owner.read(), 'Unauthorized');
        
        storage.whitelisted_collectors.write(collector, is_whitelisted);
        
        let mut events = array![];
        events.append(Event::CollectorWhitelisted(CollectorWhitelisted {
            collector: collector,
            is_whitelisted: is_whitelisted,
        }));
        starknet::emit_event_syscall(events.span()).unwrap();
    }

    #[external(v0)]
    fn get_collected_fees(token: ContractAddress) -> u256 {
        storage.collected_fees.read(token)
    }

    #[external(v0)]
    fn get_allocation(fee_type: felt252) -> FeeAllocation {
        storage.fee_allocations.read(fee_type)
    }

    #[external(v0)]
    fn set_distribution_interval(interval: u64) {
        assert(get_caller_address() == storage.owner.read(), 'Unauthorized');
        storage.distribution_interval.write(interval);
    }

    #[external(v0)]
    fn emergency_withdraw(token: ContractAddress, amount: u256) {
        assert(get_caller_address() == storage.owner.read(), 'Unauthorized');
        
        let token_contract = ICARELTokenDispatcher { contract_address: token };
        token_contract.transfer(storage.owner.read(), amount);
        
        // Update collected fees
        let current_fees = storage.collected_fees.read(token);
        if amount > current_fees {
            storage.collected_fees.write(token, 0);
        } else {
            storage.collected_fees.write(token, current_fees - amount);
        }
    }

    fn _setup_default_allocations() {
        // Swap fees: 0.3% total
        // 0.2% to LP, 0.1% split between dev and treasury
        storage.fee_allocations.write('swap', FeeAllocation {
            fee_type: 'swap',
            lp_percentage: 6667, // 66.67% of 0.3% = 0.2%
            dev_percentage: 1667, // 16.67% of 0.3% = 0.05%
            treasury_percentage: 1666, // 16.66% of 0.3% = 0.05%
            burn_percentage: 0,
            lp_wallet: ContractAddress::default(), // Will be set later
            dev_wallet: ContractAddress::default(), // Will be set later
        });
        
        // Bridge fees: 0.4% total
        // 0.3% to bridge provider, 0.1% to treasury
        storage.fee_allocations.write('bridge', FeeAllocation {
            fee_type: 'bridge',
            lp_percentage: 7500, // 75% of 0.4% = 0.3%
            dev_percentage: 0,
            treasury_percentage: 2500, // 25% of 0.4% = 0.1%
            burn_percentage: 0,
            lp_wallet: ContractAddress::default(),
            dev_wallet: ContractAddress::default(),
        });
        
        // MEV Protection fees: 0.15% total
        // All to treasury
        storage.fee_allocations.write('mev_protection', FeeAllocation {
            fee_type: 'mev_protection',
            lp_percentage: 0,
            dev_percentage: 0,
            treasury_percentage: 10000, // 100% to treasury
            burn_percentage: 0,
            lp_wallet: ContractAddress::default(),
            dev_wallet: ContractAddress::default(),
        });
        
        // Private mode fees: 0.1% total
        // All to treasury
        storage.fee_allocations.write('private_mode', FeeAllocation {
            fee_type: 'private_mode',
            lp_percentage: 0,
            dev_percentage: 0,
            treasury_percentage: 10000, // 100% to treasury
            burn_percentage: 0,
            lp_wallet: ContractAddress::default(),
            dev_wallet: ContractAddress::default(),
        });
    }
}