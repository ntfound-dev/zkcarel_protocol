#[contract]
mod ZkCarelNFT {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use openzeppelin::token::erc721::ERC721;
    use openzeppelin::token::erc721::ERC721::Transfer;
    use openzeppelin::utils::address::Address;
    use super::IZkCarelPoints;

    #[storage]
    struct Storage {
        name: felt252,
        symbol: felt252,
        owner: ContractAddress,
        points_contract: ContractAddress,
        base_uri: felt252,
        next_token_id: u256,
        token_info: LegacyMap<u256, NFTInfo>,
        user_active_nft: LegacyMap<ContractAddress, u256>,
        tier_config: LegacyMap<u8, TierConfig>,
    }

    #[derive(Drop, Serde)]
    struct NFTInfo {
        owner: ContractAddress,
        tier: u8,
        uses: u8,
        max_uses: u8,
        discount_percent: u8,
        minted_at: u64,
        is_active: bool,
    }

    #[derive(Drop, Serde)]
    struct TierConfig {
        point_cost: u256,
        discount_percent: u8,
        max_uses: u8,
        name: felt252,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        NFTMinted: NFTMinted,
        DiscountUsed: DiscountUsed,
        NFTExpired: NFTExpired,
        TierConfigured: TierConfigured,
    }

    #[derive(Drop, starknet::Event)]
    struct NFTMinted {
        user: ContractAddress,
        token_id: u256,
        tier: u8,
        points_spent: u256,
        uses: u8,
    }

    #[derive(Drop, starknet::Event)]
    struct DiscountUsed {
        user: ContractAddress,
        token_id: u256,
        remaining_uses: u8,
    }

    #[derive(Drop, starknet::Event)]
    struct NFTExpired {
        user: ContractAddress,
        token_id: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct TierConfigured {
        tier: u8,
        point_cost: u256,
        discount_percent: u8,
        max_uses: u8,
    }

    #[constructor]
    fn constructor(points_contract_address: ContractAddress) {
        storage.name.write('ZkCarel Discount NFT');
        storage.symbol.write('ZKDNFT');
        storage.owner.write(get_caller_address());
        storage.points_contract.write(points_contract_address);
        storage.base_uri.write('https://api.zkcarel.io/nft/');
        storage.next_token_id.write(1);
        
        // Setup default tiers
        _setup_default_tiers();
    }

    #[external(v0)]
    fn mint(tier: u8) -> u256 {
        let user = get_caller_address();
        
        // Cek tier valid
        let tier_config = storage.tier_config.read(tier);
        assert(tier_config.point_cost > 0, 'Invalid tier');
        
        // Cek user belum punya NFT aktif
        let current_active = storage.user_active_nft.read(user);
        if current_active > 0 {
            let current_info = storage.token_info.read(current_active);
            assert(!current_info.is_active, 'Already have active NFT');
        }
        
        // Spend points
        let points_contract = IZkCarelPointsDispatcher { contract_address: storage.points_contract.read() };
        points_contract.spend_points(user, tier_config.point_cost);
        
        // Mint NFT
        let token_id = storage.next_token_id.read();
        storage.next_token_id.write(token_id + 1);
        
        let nft_info = NFTInfo {
            owner: user,
            tier: tier,
            uses: tier_config.max_uses,
            max_uses: tier_config.max_uses,
            discount_percent: tier_config.discount_percent,
            minted_at: get_block_timestamp(),
            is_active: true,
        };
        
        storage.token_info.write(token_id, nft_info);
        storage.user_active_nft.write(user, token_id);
        
        // Transfer event (soulbound - from zero to user)
        let mut transfer_events = array![];
        transfer_events.append(Event::Transfer(Transfer {
            from: ContractAddress::default(),
            to: user,
            token_id: token_id,
        }));
        starknet::emit_event_syscall(transfer_events.span()).unwrap();
        
        let mut events = array![];
        events.append(Event::NFTMinted(NFTMinted {
            user: user,
            token_id: token_id,
            tier: tier,
            points_spent: tier_config.point_cost,
            uses: tier_config.max_uses,
        }));
        starknet::emit_event_syscall(events.span()).unwrap();
        
        token_id
    }

    #[external(v0)]
    fn use_discount(user: ContractAddress) -> bool {
        // Hanya router yang bisa panggil ini
        assert(get_caller_address() == storage.owner.read(), 'Unauthorized');
        
        let token_id = storage.user_active_nft.read(user);
        assert(token_id > 0, 'No active NFT');
        
        let mut nft_info = storage.token_info.read(token_id);
        assert(nft_info.is_active, 'NFT not active');
        assert(nft_info.uses > 0, 'No uses remaining');
        
        nft_info.uses -= 1;
        storage.token_info.write(token_id, nft_info);
        
        // Jika uses habis, deactivate
        if nft_info.uses == 0 {
            nft_info.is_active = false;
            storage.token_info.write(token_id, nft_info);
            storage.user_active_nft.write(user, 0);
            
            let mut events = array![];
            events.append(Event::NFTExpired(NFTExpired {
                user: user,
                token_id: token_id,
            }));
            starknet::emit_event_syscall(events.span()).unwrap();
        } else {
            let mut events = array![];
            events.append(Event::DiscountUsed(DiscountUsed {
                user: user,
                token_id: token_id,
                remaining_uses: nft_info.uses,
            }));
            starknet::emit_event_syscall(events.span()).unwrap();
        }
        
        true
    }

    #[external(v0)]
    fn has_active_discount(user: ContractAddress) -> (bool, u8) {
        let token_id = storage.user_active_nft.read(user);
        
        if token_id == 0 {
            return (false, 0);
        }
        
        let nft_info = storage.token_info.read(token_id);
        
        if nft_info.is_active && nft_info.uses > 0 {
            (true, nft_info.discount_percent)
        } else {
            (false, 0)
        }
    }

    #[external(v0)]
    fn get_active_nft(user: ContractAddress) -> NFTInfo {
        let token_id = storage.user_active_nft.read(user);
        
        if token_id == 0 {
            return NFTInfo {
                owner: ContractAddress::default(),
                tier: 0,
                uses: 0,
                max_uses: 0,
                discount_percent: 0,
                minted_at: 0,
                is_active: false,
            };
        }
        
        storage.token_info.read(token_id)
    }

    #[external(v0)]
    fn get_nft_info(token_id: u256) -> NFTInfo {
        storage.token_info.read(token_id)
    }

    #[external(v0)]
    fn configure_tier(
        tier: u8,
        point_cost: u256,
        discount_percent: u8,
        max_uses: u8,
        name: felt252
    ) {
        assert(get_caller_address() == storage.owner.read(), 'Ownable: caller is not owner');
        
        let tier_config = TierConfig {
            point_cost: point_cost,
            discount_percent: discount_percent,
            max_uses: max_uses,
            name: name,
        };
        
        storage.tier_config.write(tier, tier_config);
        
        let mut events = array![];
        events.append(Event::TierConfigured(TierConfigured {
            tier: tier,
            point_cost: point_cost,
            discount_percent: discount_percent,
            max_uses: max_uses,
        }));
        starknet::emit_event_syscall(events.span()).unwrap();
    }

    #[external(v0)]
    fn get_tier_config(tier: u8) -> TierConfig {
        storage.tier_config.read(tier)
    }

    #[external(v0)]
    fn token_uri(token_id: u256) -> felt252 {
        let info = storage.token_info.read(token_id);
        let tier_name = storage.tier_config.read(info.tier).name;
        
        // Format: base_uri + token_id + tier_name
        let mut uri = storage.base_uri.read();
        uri = uri + token_id.to_string();
        uri = uri + '/';
        uri = uri + tier_name;
        
        uri
    }

    // Override transfer functions untuk soulbound NFT
    #[external(v0)]
    fn transfer_from(_from: ContractAddress, _to: ContractAddress, _token_id: u256) {
        // Soulbound - tidak bisa transfer
        panic_with_felt252('NFT is soulbound and cannot be transferred');
    }

    #[external(v0)]
    fn safe_transfer_from(_from: ContractAddress, _to: ContractAddress, _token_id: u256) {
        // Soulbound - tidak bisa transfer
        panic_with_felt252('NFT is soulbound and cannot be transferred');
    }

    #[external(v0)]
    fn safe_transfer_from_with_data(
        _from: ContractAddress, 
        _to: ContractAddress, 
        _token_id: u256, 
        _data: Array<felt252>
    ) {
        // Soulbound - tidak bisa transfer
        panic_with_felt252('NFT is soulbound and cannot be transferred');
    }

    fn _setup_default_tiers() {
        // Tier 0: Dasar (free)
        storage.tier_config.write(0, TierConfig {
            point_cost: 0,
            discount_percent: 0,
            max_uses: 255, // unlimited
            name: 'Basic',
        });
        
        // Tier 1: Bronze
        storage.tier_config.write(1, TierConfig {
            point_cost: 5000 * 10**18,
            discount_percent: 5,
            max_uses: 5,
            name: 'Bronze',
        });
        
        // Tier 2: Silver
        storage.tier_config.write(2, TierConfig {
            point_cost: 15000 * 10**18,
            discount_percent: 10,
            max_uses: 7,
            name: 'Silver',
        });
        
        // Tier 3: Gold
        storage.tier_config.write(3, TierConfig {
            point_cost: 50000 * 10**18,
            discount_percent: 25,
            max_uses: 10,
            name: 'Gold',
        });
        
        // Tier 4: Platinum
        storage.tier_config.write(4, TierConfig {
            point_cost: 150000 * 10**18,
            discount_percent: 35,
            max_uses: 15,
            name: 'Platinum',
        });
        
        // Tier 5: Onyx
        storage.tier_config.write(5, TierConfig {
            point_cost: 500000 * 10**18,
            discount_percent: 50,
            max_uses: 20,
            name: 'Onyx',
        });
    }
}