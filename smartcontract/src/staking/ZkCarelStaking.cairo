#[contract]
mod ZkCarelStaking {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use array::ArrayTrait;
    use super::ICARELToken;
    use super::IZkCarelPoints;

    #[storage]
    struct Storage {
        owner: ContractAddress,
        carel_token: ContractAddress,
        points_contract: ContractAddress,
        next_stake_id: u256,
        stakes: LegacyMap<u256, StakePosition>,
        user_stakes: LegacyMap<ContractAddress, Array<u256>>,
        pools: LegacyMap<u8, PoolConfig>,
        total_tvl: u256,
    }

    #[derive(Drop, Serde)]
    struct StakePosition {
        id: u256,
        owner: ContractAddress,
        token: ContractAddress,
        amount: u256,
        staked_at: u64,
        last_claim_time: u64,
        pending_rewards: u256,
        pool_id: u8,
        is_active: bool,
        tier_multiplier: u64,
    }

    #[derive(Drop, Serde)]
    struct PoolConfig {
        token: ContractAddress,
        apy_percentage: u64, // basis points (1000 = 10%)
        point_multiplier: u64, // basis points (100 = 1x)
        min_stake_tier1: u256,
        min_stake_tier2: u256,
        min_stake_tier3: u256,
        is_active: bool,
        lock_period: u64, // seconds
        early_withdrawal_penalty: u64, // basis points
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Staked: Staked,
        Unstaked: Unstaked,
        RewardsClaimed: RewardsClaimed,
        PoolConfigured: PoolConfigured,
    }

    #[derive(Drop, starknet::Event)]
    struct Staked {
        user: ContractAddress,
        stake_id: u256,
        token: ContractAddress,
        amount: u256,
        pool_id: u8,
        tier_multiplier: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct Unstaked {
        user: ContractAddress,
        stake_id: u256,
        amount: u256,
        rewards: u256,
        penalty: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct RewardsClaimed {
        user: ContractAddress,
        stake_id: u256,
        rewards: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct PoolConfigured {
        pool_id: u8,
        token: ContractAddress,
        apy_percentage: u64,
        point_multiplier: u64,
    }

    #[constructor]
    fn constructor(
        carel_token_address: ContractAddress,
        points_contract_address: ContractAddress
    ) {
        storage.owner.write(get_caller_address());
        storage.carel_token.write(carel_token_address);
        storage.points_contract.write(points_contract_address);
        storage.next_stake_id.write(1);
        
        // Setup default pools
        _setup_default_pools();
    }

    #[external(v0)]
    fn stake(
        token: ContractAddress,
        amount: u256,
        pool_id: u8
    ) -> u256 {
        let user = get_caller_address();
        
        // Cek pool valid dan aktif
        let pool = storage.pools.read(pool_id);
        assert(pool.is_active, 'Pool not active');
        assert(pool.token == token, 'Invalid token for pool');
        
        // Cek approval
        let token_contract = ICARELTokenDispatcher { contract_address: token };
        let allowance = token_contract.allowance(user, get_contract_address());
        assert(allowance >= amount, 'Insufficient allowance');
        
        // Transfer token dari user ke contract
        token_contract.transfer_from(user, get_contract_address(), amount);
        
        // Tentukan tier multiplier berdasarkan amount
        let tier_multiplier = _calculate_tier_multiplier(amount, pool);
        
        // Buat stake position
        let stake_id = storage.next_stake_id.read();
        storage.next_stake_id.write(stake_id + 1);
        
        let stake_position = StakePosition {
            id: stake_id,
            owner: user,
            token: token,
            amount: amount,
            staked_at: get_block_timestamp(),
            last_claim_time: get_block_timestamp(),
            pending_rewards: 0,
            pool_id: pool_id,
            is_active: true,
            tier_multiplier: tier_multiplier,
        };
        
        storage.stakes.write(stake_id, stake_position);
        
        // Tambah ke user's stake list
        let mut user_stakes = storage.user_stakes.read(user);
        user_stakes.append(stake_id);
        storage.user_stakes.write(user, user_stakes);
        
        // Update TVL
        let total_tvl = storage.total_tvl.read();
        storage.total_tvl.write(total_tvl + amount);
        
        // Add points untuk staking
        let points_contract = IZkCarelPointsDispatcher { contract_address: storage.points_contract.read() };
        
        // Hitung points per hari: 1 CAREL = 20 points/hari (dengan multiplier)
        let daily_points = (amount / 10**18) * 20 * tier_multiplier / 100;
        points_contract.add_points(user, daily_points, 'stake_daily');
        
        let mut events = array![];
        events.append(Event::Staked(Staked {
            user: user,
            stake_id: stake_id,
            token: token,
            amount: amount,
            pool_id: pool_id,
            tier_multiplier: tier_multiplier,
        }));
        starknet::emit_event_syscall(events.span()).unwrap();
        
        stake_id
    }

    #[external(v0)]
    fn unstake(stake_id: u256, amount: u256) -> (u256, u256) {
        let user = get_caller_address();
        
        let mut stake = storage.stakes.read(stake_id);
        assert(stake.owner == user, 'Not stake owner');
        assert(stake.is_active, 'Stake not active');
        assert(stake.amount >= amount, 'Insufficient staked amount');
        
        // Hitung rewards sebelum unstake
        let rewards = _calculate_rewards(stake_id);
        let total_withdraw = amount + rewards;
        
        // Cek early withdrawal penalty
        let pool = storage.pools.read(stake.pool_id);
        let current_time = get_block_timestamp();
        let time_staked = current_time - stake.staked_at;
        
        let mut penalty = 0;
        if time_staked < pool.lock_period {
            penalty = (rewards * pool.early_withdrawal_penalty.into()) / 10000;
        }
        
        let net_withdraw = total_withdraw - penalty;
        
        // Update stake position
        if amount == stake.amount {
            stake.is_active = false;
            stake.amount = 0;
        } else {
            stake.amount -= amount;
        }
        
        stake.last_claim_time = current_time;
        stake.pending_rewards = 0;
        storage.stakes.write(stake_id, stake);
        
        // Transfer tokens ke user
        let token_contract = ICARELTokenDispatcher { contract_address: stake.token };
        
        // Transfer principal
        token_contract.transfer(user, amount);
        
        // Transfer rewards (minus penalty)
        if net_withdraw > amount {
            let rewards_to_transfer = net_withdraw - amount;
            
            // Mint rewards dari treasury atau transfer dari contract balance
            // Untuk simplicity, transfer dari contract balance
            token_contract.transfer(user, rewards_to_transfer);
        }
        
        // Update TVL
        let total_tvl = storage.total_tvl.read();
        storage.total_tvl.write(total_tvl - amount);
        
        let mut events = array![];
        events.append(Event::Unstaked(Unstaked {
            user: user,
            stake_id: stake_id,
            amount: amount,
            rewards: rewards,
            penalty: penalty,
        }));
        starknet::emit_event_syscall(events.span()).unwrap();
        
        (amount, rewards)
    }

    #[external(v0)]
    fn claim_rewards(stake_id: u256) -> u256 {
        let user = get_caller_address();
        
        let mut stake = storage.stakes.read(stake_id);
        assert(stake.owner == user, 'Not stake owner');
        assert(stake.is_active, 'Stake not active');
        
        // Hitung rewards
        let rewards = _calculate_rewards(stake_id);
        assert(rewards > 0, 'No rewards to claim');
        
        // Update stake
        stake.last_claim_time = get_block_timestamp();
        stake.pending_rewards = 0;
        storage.stakes.write(stake_id, stake);
        
        // Transfer rewards
        let token_contract = ICARELTokenDispatcher { contract_address: stake.token };
        token_contract.transfer(user, rewards);
        
        // Add points untuk claimed rewards
        let points_contract = IZkCarelPointsDispatcher { contract_address: storage.points_contract.read() };
        let reward_points = (rewards / 10**18) * 10; // $1 = 10 points
        points_contract.add_points(user, reward_points, 'reward_claim');
        
        let mut events = array![];
        events.append(Event::RewardsClaimed(RewardsClaimed {
            user: user,
            stake_id: stake_id,
            rewards: rewards,
        }));
        starknet::emit_event_syscall(events.span()).unwrap();
        
        rewards
    }

    #[external(v0)]
    fn get_stake_info(stake_id: u256) -> StakePosition {
        storage.stakes.read(stake_id)
    }

    #[external(v0)]
    fn get_pool_info(pool_id: u8) -> PoolConfig {
        storage.pools.read(pool_id)
    }

    #[external(v0)]
    fn get_user_stakes(user: ContractAddress) -> Array<u256> {
        storage.user_stakes.read(user)
    }

    #[external(v0)]
    fn calculate_pending_rewards(stake_id: u256) -> u256 {
        _calculate_rewards(stake_id)
    }

    #[external(v0)]
    fn configure_pool(
        pool_id: u8,
        token: ContractAddress,
        apy_percentage: u64,
        point_multiplier: u64,
        min_stake_tier1: u256,
        min_stake_tier2: u256,
        min_stake_tier3: u256,
        lock_period: u64,
        early_withdrawal_penalty: u64
    ) {
        assert(get_caller_address() == storage.owner.read(), 'Ownable: caller is not owner');
        
        let pool_config = PoolConfig {
            token: token,
            apy_percentage: apy_percentage,
            point_multiplier: point_multiplier,
            min_stake_tier1: min_stake_tier1,
            min_stake_tier2: min_stake_tier2,
            min_stake_tier3: min_stake_tier3,
            is_active: true,
            lock_period: lock_period,
            early_withdrawal_penalty: early_withdrawal_penalty,
        };
        
        storage.pools.write(pool_id, pool_config);
        
        let mut events = array![];
        events.append(Event::PoolConfigured(PoolConfigured {
            pool_id: pool_id,
            token: token,
            apy_percentage: apy_percentage,
            point_multiplier: point_multiplier,
        }));
        starknet::emit_event_syscall(events.span()).unwrap();
    }

    fn _calculate_rewards(stake_id: u256) -> u256 {
        let stake = storage.stakes.read(stake_id);
        
        if !stake.is_active || stake.amount == 0 {
            return 0;
        }
        
        let pool = storage.pools.read(stake.pool_id);
        let current_time = get_block_timestamp();
        let time_elapsed = current_time - stake.last_claim_time;
        
        // Hitung rewards: amount * apy% * time_elapsed / seconds_per_year
        let seconds_per_year = 365 * 24 * 3600;
        
        let rewards = (stake.amount * pool.apy_percentage.into() * time_elapsed.into())
            / (10000 * seconds_per_year.into());
        
        stake.pending_rewards + rewards
    }

    fn _calculate_tier_multiplier(amount: u256, pool: PoolConfig) -> u64 {
        if amount >= pool.min_stake_tier3 {
            400 // 4x point multiplier untuk tier 3
        } else if amount >= pool.min_stake_tier2 {
            300 // 3x point multiplier untuk tier 2
        } else if amount >= pool.min_stake_tier1 {
            200 // 2x point multiplier untuk tier 1
        } else {
            100 // 1x point multiplier (default)
        }
    }

    fn _setup_default_pools() {
        // Pool 0: CAREL Staking
        storage.pools.write(0, PoolConfig {
            token: storage.carel_token.read(),
            apy_percentage: 1000, // 10%
            point_multiplier: 200, // 2x points
            min_stake_tier1: 100 * 10**18,    // 100 CAREL
            min_stake_tier2: 1000 * 10**18,   // 1,000 CAREL
            min_stake_tier3: 10000 * 10**18,  // 10,000 CAREL
            is_active: true,
            lock_period: 30 * 24 * 3600, // 30 hari
            early_withdrawal_penalty: 500, // 5%
        });
        
        // Pool 1: BTC Staking (wBTC)
        storage.pools.write(1, PoolConfig {
            token: ContractAddress::default(), // akan di-set nanti
            apy_percentage: 500, // 5%
            point_multiplier: 300, // 3x points
            min_stake_tier1: 0, // BTC tier berbeda
            min_stake_tier2: 0,
            min_stake_tier3: 0,
            is_active: false, // aktif setelah di-configure
            lock_period: 30 * 24 * 3600,
            early_withdrawal_penalty: 500,
        });
        
        // Pool 2: Stablecoin Staking
        storage.pools.write(2, PoolConfig {
            token: ContractAddress::default(), // akan di-set nanti
            apy_percentage: 500, // 5%
            point_multiplier: 50, // 0.5x points
            min_stake_tier1: 0,
            min_stake_tier2: 0,
            min_stake_tier3: 0,
            is_active: false,
            lock_period: 7 * 24 * 3600, // 7 hari
            early_withdrawal_penalty: 200, // 2%
        });
        
        // Pool 3: LP Staking (CAREL/STRK)
        storage.pools.write(3, PoolConfig {
            token: ContractAddress::default(), // LP token address
            apy_percentage: 2500, // 25%
            point_multiplier: 500, // 5x points
            min_stake_tier1: 0,
            min_stake_tier2: 0,
            min_stake_tier3: 0,
            is_active: false,
            lock_period: 90 * 24 * 3600, // 90 hari
            early_withdrawal_penalty: 1000, // 10%
        });
    }
}