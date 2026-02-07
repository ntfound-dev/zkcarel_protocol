#[contract]
mod ZkCarelRouter {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use array::ArrayTrait;
    use option::OptionTrait;
    use super::ICARELToken;
    use super::ITreasury;
    use super::IZkCarelPoints;
    use super::IZkCarelNFT;

    #[storage]
    struct Storage {
        owner: ContractAddress,
        weth: ContractAddress,
        treasury: ContractAddress,
        points_contract: ContractAddress,
        nft_contract: ContractAddress,
        fee_recipient: ContractAddress,
        swap_fee_bps: u64, // 30 = 0.3%
        bridge_fee_bps: u64, // 40 = 0.4%
        mev_protection_fee_bps: u64, // 15 = 0.15%
        private_mode_fee_bps: u64, // 10 = 0.1%
        approved_dexes: LegacyMap<ContractAddress, bool>,
        approved_bridges: LegacyMap<ContractAddress, bool>,
        route_cache: LegacyMap<felt252, Route>,
    }

    #[derive(Drop, Serde)]
    struct SwapParams {
        from_token: ContractAddress,
        to_token: ContractAddress,
        amount_in: u256,
        min_amount_out: u256,
        recipient: ContractAddress,
        deadline: u64,
        use_private_mode: bool,
        use_mev_protection: bool,
    }

    #[derive(Drop, Serde)]
    struct BridgeParams {
        target_chain_id: u64,
        token: ContractAddress,
        amount: u256,
        recipient: ContractAddress,
        bridge_provider: felt252,
    }

    #[derive(Drop, Serde)]
    struct Route {
        path: Array<ContractAddress>,
        dexes: Array<ContractAddress>,
        expected_amount_out: u256,
        fee_amount: u256,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        SwapExecuted: SwapExecuted,
        BridgeInitiated: BridgeInitiated,
        RouteUpdated: RouteUpdated,
        FeeCollected: FeeCollected,
    }

    #[derive(Drop, starknet::Event)]
    struct SwapExecuted {
        user: ContractAddress,
        from_token: ContractAddress,
        to_token: ContractAddress,
        amount_in: u256,
        amount_out: u256,
        fee: u256,
        route_hash: felt252,
        private_mode: bool,
    }

    #[derive(Drop, starknet::Event)]
    struct BridgeInitiated {
        bridge_id: felt252,
        user: ContractAddress,
        target_chain_id: u64,
        token: ContractAddress,
        amount: u256,
        recipient: ContractAddress,
        bridge_provider: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct RouteUpdated {
        route_hash: felt252,
        path: Array<ContractAddress>,
        dexes: Array<ContractAddress>,
    }

    #[derive(Drop, starknet::Event)]
    struct FeeCollected {
        amount: u256,
        fee_type: felt252,
    }

    #[constructor]
    fn constructor(
        weth_address: ContractAddress,
        treasury_address: ContractAddress,
        points_contract_address: ContractAddress,
        nft_contract_address: ContractAddress
    ) {
        storage.owner.write(get_caller_address());
        storage.weth.write(weth_address);
        storage.treasury.write(treasury_address);
        storage.points_contract.write(points_contract_address);
        storage.nft_contract.write(nft_contract_address);
        storage.fee_recipient.write(treasury_address);
        storage.swap_fee_bps.write(30); // 0.3%
        storage.bridge_fee_bps.write(40); // 0.4%
        storage.mev_protection_fee_bps.write(15); // 0.15%
        storage.private_mode_fee_bps.write(10); // 0.1%
    }

    #[external(v0)]
    fn swap(params: SwapParams) -> u256 {
        // Cek deadline
        assert(params.deadline > get_block_timestamp(), 'Deadline expired');
        
        let user = get_caller_address();
        
        // Cek approval
        let from_token = ICARELTokenDispatcher { contract_address: params.from_token };
        let allowance = from_token.allowance(user, get_contract_address());
        assert(allowance >= params.amount_in, 'Insufficient allowance');
        
        // Hitung fee
        let (fee_amount, fee_type) = _calculate_fee(params.amount_in, params.use_private_mode, params.use_mev_protection, false);
        let amount_after_fee = params.amount_in - fee_amount;
        
        // Transfer token dari user ke router
        from_token.transfer_from(user, get_contract_address(), params.amount_in);
        
        // Cari route terbaik
        let route = _find_best_route(params.from_token, params.to_token, amount_after_fee);
        
        // Execute swap melalui DEX
        let amount_out = _execute_swap(route, amount_after_fee, params.recipient);
        
        // Cek minimum amount out
        assert(amount_out >= params.min_amount_out, 'Insufficient output amount');
        
        // Transfer fee ke treasury
        if fee_amount > 0 {
            from_token.transfer(storage.fee_recipient.read(), fee_amount);
            
            // Notify treasury
            let treasury = ITreasuryDispatcher { contract_address: storage.treasury.read() };
            treasury.collect_fee(fee_amount, fee_type);
        }
        
        // Tambah points untuk user
        let points_contract = IZkCarelPointsDispatcher { contract_address: storage.points_contract.read() };
        let points_earned = (amount_out / 10**18) * 10; // $1 = 10 points
        points_contract.add_points(user, points_earned, 'swap');
        
        // Apply NFT discount jika ada
        let nft_contract = IZkCarelNFTDispatcher { contract_address: storage.nft_contract.read() };
        let (has_active_nft, discount_percent) = nft_contract.has_active_discount(user);
        
        let mut final_amount_out = amount_out;
        if has_active_nft {
            // Apply discount (extra tokens untuk user)
            let discount_amount = (amount_out * discount_percent.into()) / 100;
            final_amount_out = amount_out + discount_amount;
            
            // Use NFT discount
            nft_contract.use_discount(user);
            
            // Mint extra tokens dari treasury
            let to_token = ICARELTokenDispatcher { contract_address: params.to_token };
            let treasury_token = ICARELTokenDispatcher { contract_address: storage.treasury.read() };
            treasury_token.mint(params.recipient, discount_amount);
        }
        
        // Log event
        let route_hash = _hash_route(route.path, route.dexes);
        
        let mut events = array![];
        events.append(Event::SwapExecuted(SwapExecuted {
            user: user,
            from_token: params.from_token,
            to_token: params.to_token,
            amount_in: params.amount_in,
            amount_out: final_amount_out,
            fee: fee_amount,
            route_hash: route_hash,
            private_mode: params.use_private_mode,
        }));
        
        if fee_amount > 0 {
            events.append(Event::FeeCollected(FeeCollected {
                amount: fee_amount,
                fee_type: fee_type,
            }));
        }
        
        starknet::emit_event_syscall(events.span()).unwrap();
        
        final_amount_out
    }

    #[external(v0)]
    fn bridge(params: BridgeParams) -> felt252 {
        let user = get_caller_address();
        
        // Cek approval
        let token = ICARELTokenDispatcher { contract_address: params.token };
        let allowance = token.allowance(user, get_contract_address());
        assert(allowance >= params.amount, 'Insufficient allowance');
        
        // Hitung fee
        let (fee_amount, fee_type) = _calculate_fee(params.amount, false, false, true);
        let amount_after_fee = params.amount - fee_amount;
        
        // Transfer token dari user ke router
        token.transfer_from(user, get_contract_address(), params.amount);
        
        // Transfer fee ke treasury
        if fee_amount > 0 {
            token.transfer(storage.fee_recipient.read(), fee_amount);
            
            let treasury = ITreasuryDispatcher { contract_address: storage.treasury.read() };
            treasury.collect_fee(fee_amount, fee_type);
        }
        
        // Execute bridge melalui provider
        let bridge_id = _execute_bridge(params.bridge_provider, params.token, amount_after_fee, params.target_chain_id, params.recipient);
        
        // Tambah points untuk user
        let points_contract = IZkCarelPointsDispatcher { contract_address: storage.points_contract.read() };
        let points_earned = (amount_after_fee / 10**18) * 15; // $1 = 15 points
        points_contract.add_points(user, points_earned, 'bridge');
        
        let mut events = array![];
        events.append(Event::BridgeInitiated(BridgeInitiated {
            bridge_id: bridge_id,
            user: user,
            target_chain_id: params.target_chain_id,
            token: params.token,
            amount: amount_after_fee,
            recipient: params.recipient,
            bridge_provider: params.bridge_provider,
        }));
        
        if fee_amount > 0 {
            events.append(Event::FeeCollected(FeeCollected {
                amount: fee_amount,
                fee_type: fee_type,
            }));
        }
        
        starknet::emit_event_syscall(events.span()).unwrap();
        
        bridge_id
    }

    #[external(v0)]
    fn get_quote(
        from_token: ContractAddress,
        to_token: ContractAddress,
        amount_in: u256,
        use_private_mode: bool,
        use_mev_protection: bool
    ) -> (u256, u256, Array<ContractAddress>, Array<ContractAddress>) {
        // Hitung fee
        let (fee_amount, _) = _calculate_fee(amount_in, use_private_mode, use_mev_protection, false);
        let amount_after_fee = amount_in - fee_amount;
        
        // Cari route terbaik
        let route = _find_best_route(from_token, to_token, amount_after_fee);
        
        (route.expected_amount_out, fee_amount, route.path, route.dexes)
    }

    #[external(v0)]
    fn add_dex(dex_address: ContractAddress) {
        assert(get_caller_address() == storage.owner.read(), 'Ownable: caller is not owner');
        storage.approved_dexes.write(dex_address, true);
    }

    #[external(v0)]
    fn add_bridge(bridge_address: ContractAddress) {
        assert(get_caller_address() == storage.owner.read(), 'Ownable: caller is not owner');
        storage.approved_bridges.write(bridge_address, true);
    }

    #[external(v0)]
    fn set_fees(
        swap_fee: u64,
        bridge_fee: u64,
        mev_fee: u64,
        private_fee: u64
    ) {
        assert(get_caller_address() == storage.owner.read(), 'Ownable: caller is not owner');
        storage.swap_fee_bps.write(swap_fee);
        storage.bridge_fee_bps.write(bridge_fee);
        storage.mev_protection_fee_bps.write(mev_fee);
        storage.private_mode_fee_bps.write(private_fee);
    }

    fn _calculate_fee(
        amount: u256,
        private_mode: bool,
        mev_protection: bool,
        is_bridge: bool
    ) -> (u256, felt252) {
        let mut fee_bps = 0;
        let mut fee_type = 'swap';
        
        if is_bridge {
            fee_bps = storage.bridge_fee_bps.read();
            fee_type = 'bridge';
        } else {
            fee_bps = storage.swap_fee_bps.read();
            
            if private_mode {
                fee_bps += storage.private_mode_fee_bps.read();
                fee_type = 'private_swap';
            }
            
            if mev_protection {
                fee_bps += storage.mev_protection_fee_bps.read();
                fee_type = 'mev_protected_swap';
            }
        }
        
        let fee_amount = (amount * fee_bps.into()) / 10000;
        (fee_amount, fee_type)
    }

    fn _find_best_route(
        from_token: ContractAddress,
        to_token: ContractAddress,
        amount: u256
    ) -> Route {
        // Implementasi sederhana route finding
        // Di production, gunakan algoritma yang lebih kompleks
        
        let path = array![from_token, storage.weth.read(), to_token];
        let dexes = array![ContractAddress::default()]; // Default DEX
        
        // Simulasi price (1:1 untuk simplicity)
        let expected_amount_out = amount;
        let fee_amount = (amount * 30.into()) / 10000; // 0.3%
        
        Route {
            path: path,
            dexes: dexes,
            expected_amount_out: expected_amount_out,
            fee_amount: fee_amount,
        }
    }

    fn _execute_swap(route: Route, amount: u256, recipient: ContractAddress) -> u256 {
        // Implementasi swap execution
        // Untuk sekarang, return amount as-is (simulasi)
        
        // Di production, panggil DEX contract
        amount
    }

    fn _execute_bridge(
        provider: felt252,
        token: ContractAddress,
        amount: u256,
        target_chain_id: u64,
        recipient: ContractAddress
    ) -> felt252 {
        // Generate unique bridge ID
        let bridge_id = starknet::pedersen(array![
            get_caller_address().into(),
            token.into(),
            amount.low.into(),
            amount.high.into(),
            target_chain_id.into()
        ].span());
        
        bridge_id
    }

    fn _hash_route(path: Array<ContractAddress>, dexes: Array<ContractAddress>) -> felt252 {
        let mut data = array![];
        
        // Hash path
        let path_len = path.len();
        data.append(path_len.into());
        let mut i = 0;
        loop {
            if i >= path_len {
                break;
            }
            data.append(path.at(i).into());
            i += 1;
        }
        
        // Hash dexes
        let dexes_len = dexes.len();
        data.append(dexes_len.into());
        let mut j = 0;
        loop {
            if j >= dexes_len {
                break;
            }
            data.append(dexes.at(j).into());
            j += 1;
        }
        
        starknet::pedersen(data.span())
    }
}