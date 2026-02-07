#[contract]
mod ZkCarelPoints {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use array::ArrayTrait;
    use super::ICARELToken;
    use super::IZkCarelNFT;

    #[storage]
    struct Storage {
        owner: ContractAddress,
        carel_token: ContractAddress,
        nft_contract: ContractAddress,
        router_contract: ContractAddress,
        user_points: LegacyMap<ContractAddress, UserPoints>,
        point_to_carel_rate: u256, // 1 point = ? CAREL
        conversion_fee_bps: u64,
        referral_bonus_bps: u64, // 1000 = 10%
        last_conversion_time: LegacyMap<ContractAddress, u64>,
        conversion_cooldown: u64,
    }

    #[derive(Drop, Serde)]
    struct UserPoints {
        lifetime_points: u256,
        current_points: u256,
        tier: u8,
        referral_code: felt252,
        referred_by: ContractAddress,
        total_referrals: u64,
        referral_points_earned: u256,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        PointsEarned: PointsEarned,
        PointsSpent: PointsSpent,
        PointsConverted: PointsConverted,
        ReferralRegistered: ReferralRegistered,
        TierUpdated: TierUpdated,
    }

    #[derive(Drop, starknet::Event)]
    struct PointsEarned {
        user: ContractAddress,
        amount: u256,
        activity: felt252,
        new_total: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct PointsSpent {
        user: ContractAddress,
        amount: u256,
        remaining: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct PointsConverted {
        user: ContractAddress,
        points: u256,
        carel_amount: u256,
        fee: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct ReferralRegistered {
        user: ContractAddress,
        referrer: ContractAddress,
        referral_code: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct TierUpdated {
        user: ContractAddress,
        old_tier: u8,
        new_tier: u8,
    }

    #[constructor]
    fn constructor(
        carel_token_address: ContractAddress,
        nft_contract_address: ContractAddress
    ) {
        storage.owner.write(get_caller_address());
        storage.carel_token.write(carel_token_address);
        storage.nft_contract.write(nft_contract_address);
        storage.point_to_carel_rate.write(10**15); // 0.001 CAREL per point
        storage.conversion_fee_bps.write(500); // 5%
        storage.referral_bonus_bps.write(1000); // 10%
        storage.conversion_cooldown.write(24 * 3600); // 24 jam
    }

    #[external(v0)]
    fn add_points(user: ContractAddress, amount: u256, activity: felt252) {
        // Hanya approved contracts (router, staking) yang bisa add points
        assert(_is_approved_caller(), 'Unauthorized');
        
        let mut user_data = storage.user_points.read(user);
        
        // Initialize jika baru
        if user_data.lifetime_points == 0 {
            user_data = UserPoints {
                lifetime_points: 0,
                current_points: 0,
                tier: 0,
                referral_code: _generate_referral_code(user),
                referred_by: ContractAddress::default(),
                total_referrals: 0,
                referral_points_earned: 0,
            };
        }
        
        // Tambah points
        user_data.lifetime_points += amount;
        user_data.current_points += amount;
        
        // Update tier berdasarkan lifetime points
        let new_tier = _calculate_tier(user_data.lifetime_points);
        if new_tier != user_data.tier {
            let old_tier = user_data.tier;
            user_data.tier = new_tier;
            
            let mut events = array![];
            events.append(Event::TierUpdated(TierUpdated {
                user: user,
                old_tier: old_tier,
                new_tier: new_tier,
            }));
            starknet::emit_event_syscall(events.span()).unwrap();
        }
        
        // Jika user direferral, berikan bonus ke referrer
        if user_data.referred_by != ContractAddress::default() {
            let referral_bonus = (amount * storage.referral_bonus_bps.read().into()) / 10000;
            
            let mut referrer_data = storage.user_points.read(user_data.referred_by);
            referrer_data.current_points += referral_bonus;
            referrer_data.referral_points_earned += referral_bonus;
            storage.user_points.write(user_data.referred_by, referrer_data);
            
            // Log untuk referrer juga
            let mut events = array![];
            events.append(Event::PointsEarned(PointsEarned {
                user: user_data.referred_by,
                amount: referral_bonus,
                activity: 'referral_bonus',
                new_total: referrer_data.current_points,
            }));
            starknet::emit_event_syscall(events.span()).unwrap();
        }
        
        storage.user_points.write(user, user_data);
        
        let mut events = array![];
        events.append(Event::PointsEarned(PointsEarned {
            user: user,
            amount: amount,
            activity: activity,
            new_total: user_data.current_points,
        }));
        starknet::emit_event_syscall(events.span()).unwrap();
    }

    #[external(v0)]
    fn spend_points(user: ContractAddress, amount: u256) -> bool {
        // Hanya NFT contract yang bisa spend points
        assert(get_caller_address() == storage.nft_contract.read(), 'Unauthorized');
        
        let mut user_data = storage.user_points.read(user);
        assert(user_data.current_points >= amount, 'Insufficient points');
        
        user_data.current_points -= amount;
        storage.user_points.write(user, user_data);
        
        let mut events = array![];
        events.append(Event::PointsSpent(PointsSpent {
            user: user,
            amount: amount,
            remaining: user_data.current_points,
        }));
        starknet::emit_event_syscall(events.span()).unwrap();
        
        true
    }

    #[external(v0)]
    fn convert_to_carel(points: u256) -> u256 {
        let user = get_caller_address();
        
        // Cek cooldown
        let last_conversion = storage.last_conversion_time.read(user);
        let current_time = get_block_timestamp();
        assert(
            current_time >= last_conversion + storage.conversion_cooldown.read(),
            'Conversion cooldown active'
        );
        
        let user_data = storage.user_points.read(user);
        assert(user_data.current_points >= points, 'Insufficient points');
        
        // Hitung CAREL amount
        let carel_amount = points * storage.point_to_carel_rate.read();
        let fee = (carel_amount * storage.conversion_fee_bps.read().into()) / 10000;
        let net_carel = carel_amount - fee;
        
        // Update points
        let mut updated_data = user_data;
        updated_data.current_points -= points;
        storage.user_points.write(user, updated_data);
        
        // Update conversion time
        storage.last_conversion_time.write(user, current_time);
        
        // Transfer CAREL ke user
        let token = ICARELTokenDispatcher { contract_address: storage.carel_token.read() };
        token.transfer(user, net_carel);
        
        // Transfer fee ke treasury (contract itu sendiri untuk sekarang)
        if fee > 0 {
            token.transfer(get_contract_address(), fee);
        }
        
        let mut events = array![];
        events.append(Event::PointsConverted(PointsConverted {
            user: user,
            points: points,
            carel_amount: net_carel,
            fee: fee,
        }));
        starknet::emit_event_syscall(events.span()).unwrap();
        
        net_carel
    }

    #[external(v0)]
    fn register_referral(referral_code: felt252) {
        let user = get_caller_address();
        
        // Cari referrer berdasarkan code
        // (Untuk simplicity, kita skip implementasi pencarian)
        // Anggap kita menemukan referrer
        let referrer = _find_user_by_referral_code(referral_code);
        
        assert(referrer != ContractAddress::default(), 'Invalid referral code');
        assert(referrer != user, 'Cannot refer yourself');
        
        let mut user_data = storage.user_points.read(user);
        assert(user_data.referred_by == ContractAddress::default(), 'Already referred');
        
        user_data.referred_by = referrer;
        storage.user_points.write(user, user_data);
        
        // Update referrer's referral count
        let mut referrer_data = storage.user_points.read(referrer);
        referrer_data.total_referrals += 1;
        storage.user_points.write(referrer, referrer_data);
        
        let mut events = array![];
        events.append(Event::ReferralRegistered(ReferralRegistered {
            user: user,
            referrer: referrer,
            referral_code: referral_code,
        }));
        starknet::emit_event_syscall(events.span()).unwrap();
    }

    #[external(v0)]
    fn get_points(user: ContractAddress) -> UserPoints {
        storage.user_points.read(user)
    }

    #[external(v0)]
    fn get_referral_code(user: ContractAddress) -> felt252 {
        let user_data = storage.user_points.read(user);
        user_data.referral_code
    }

    #[external(v0)]
    fn set_point_rate(rate: u256) {
        assert(get_caller_address() == storage.owner.read(), 'Ownable: caller is not owner');
        storage.point_to_carel_rate.write(rate);
    }

    #[external(v0)]
    fn set_conversion_fee(fee_bps: u64) {
        assert(get_caller_address() == storage.owner.read(), 'Ownable: caller is not owner');
        storage.conversion_fee_bps.write(fee_bps);
    }

    #[external(v0)]
    fn set_referral_bonus(bonus_bps: u64) {
        assert(get_caller_address() == storage.owner.read(), 'Ownable: caller is not owner');
        storage.referral_bonus_bps.write(bonus_bps);
    }

    fn _is_approved_caller() -> bool {
        let caller = get_caller_address();
        
        // Router dan staking contract bisa add points
        // (Untuk simplicity, return true)
        true
    }

    fn _generate_referral_code(user: ContractAddress) -> felt252 {
        // Generate simple referral code dari address
        let user_str = user.to_string();
        let code = 'CAREL_' + user_str.slice(0, 6);
        code
    }

    fn _calculate_tier(points: u256) -> u8 {
        if points >= 500000 * 10**18 {
            5 // Onyx
        } else if points >= 150000 * 10**18 {
            4 // Platinum
        } else if points >= 50000 * 10**18 {
            3 // Gold
        } else if points >= 15000 * 10**18 {
            2 // Silver
        } else if points >= 5000 * 10**18 {
            1 // Bronze
        } else {
            0 // Basic
        }
    }

    fn _find_user_by_referral_code(code: felt252) -> ContractAddress {
        // Implementasi pencarian user by referral code
        // Untuk simplicity, return default address
        ContractAddress::default()
    }
}