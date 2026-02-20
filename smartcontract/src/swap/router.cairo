// Aggregation router for swaps and bridge actions.
// Applies fee model, optional privacy/MEV flags, and route hashing.
#[contract]
mod ZkCarelRouter {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use array::ArrayTrait;
    use option::OptionTrait;
    use super::ICARELToken;
    use super::ITreasury;
    use super::IZkCarelNFT;
    use crate::utils::price_oracle::{IPriceOracleDispatcher, IPriceOracleDispatcherTrait};
    use core::num::traits::Zero;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_SWAP;

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
        price_oracle: ContractAddress,
        oracle_asset_ids: LegacyMap<ContractAddress, felt252>,
        oracle_decimals: LegacyMap<ContractAddress, u32>,
        approved_dexes: LegacyMap<ContractAddress, bool>,
        approved_bridges: LegacyMap<ContractAddress, bool>,
        route_cache: LegacyMap<felt252, Route>,
        privacy_router: ContractAddress,
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

    // Initializes router dependencies and default fee configuration.
    // weth_address/treasury_address/points_contract_address/nft_contract_address: core dependencies.
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
        let zero: ContractAddress = 0.try_into().unwrap();
        storage.price_oracle.write(zero);
        storage.privacy_router.write(zero);
    }

    // Sets privacy router used for Hide Mode swap actions.
    #[external(v0)]
    fn set_privacy_router(router: ContractAddress) {
        assert(get_caller_address() == storage.owner.read(), 'Unauthorized owner');
        assert(!router.is_zero(), 'Privacy router required');
        storage.privacy_router.write(router);
    }

    // Relays private swap payload to privacy router.
    // `nullifiers` prevent replay and `commitments` bind intended state transition.
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
            ACTION_SWAP,
            old_root,
            new_root,
            nullifiers,
            commitments,
            public_inputs,
            proof
        );
    }

    // Executes a swap using router fee model and selected route.
    // `params` bundles tokens, amount limits, recipient, and private/MEV mode flags.
    #[external(v0)]
    fn swap(params: SwapParams) -> u256 {
        // Ensure request is still valid.
        assert(params.deadline > get_block_timestamp(), 'Deadline expired');
        
        let user = get_caller_address();
        
        // Validate token allowance.
        let from_token = ICARELTokenDispatcher { contract_address: params.from_token };
        let allowance = from_token.allowance(user, get_contract_address());
        assert(allowance >= params.amount_in, 'Insufficient allowance');
        
        // Calculate mode-dependent fee.
        let (fee_amount, fee_type) = _calculate_fee(params.amount_in, params.use_private_mode, params.use_mev_protection, false);
        let amount_after_fee = params.amount_in - fee_amount;
        
        // Pull input tokens into router custody.
        from_token.transfer_from(user, get_contract_address(), params.amount_in);
        
        // Select route and expected output.
        let route = _find_best_route(params.from_token, params.to_token, amount_after_fee);
        
        // Execute swap on route target(s).
        let amount_out = _execute_swap(route, amount_after_fee, params.recipient);
        
        // Enforce slippage bound.
        assert(amount_out >= params.min_amount_out, 'Insufficient output amount');
        
        // Transfer fee to treasury sink.
        if fee_amount > 0 {
            from_token.transfer(storage.fee_recipient.read(), fee_amount);
            
            // Notify treasury
            let treasury = ITreasuryDispatcher { contract_address: storage.treasury.read() };
            treasury.collect_fee(fee_amount, fee_type);
        }
        
        // Points are calculated off-chain from events.
        
        // Apply NFT discount when user has active discount entitlement.
        let nft_contract = IZkCarelNFTDispatcher { contract_address: storage.nft_contract.read() };
        let (has_active_nft, discount_percent) = nft_contract.has_active_discount(user);
        
        let mut final_amount_out = amount_out;
        if has_active_nft {
            // Mint bonus output based on discount percentage.
            let discount_amount = (amount_out * discount_percent.into()) / 100;
            final_amount_out = amount_out + discount_amount;
            
            // Use NFT discount
            nft_contract.use_discount(user);
            
            // Materialize discount as additional output tokens.
            let to_token = ICARELTokenDispatcher { contract_address: params.to_token };
            let treasury_token = ICARELTokenDispatcher { contract_address: storage.treasury.read() };
            treasury_token.mint(params.recipient, discount_amount);
        }
        
        // Emit swap and fee events for indexers.
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

    // Initiates a bridge transfer and emits bridge tracking metadata.
    // `params` includes provider choice, token/amount, destination chain, and recipient details.
    #[external(v0)]
    fn bridge(params: BridgeParams) -> felt252 {
        let user = get_caller_address();
        
        // Validate token allowance.
        let token = ICARELTokenDispatcher { contract_address: params.token };
        let allowance = token.allowance(user, get_contract_address());
        assert(allowance >= params.amount, 'Insufficient allowance');
        
        // Calculate bridge fee.
        let (fee_amount, fee_type) = _calculate_fee(params.amount, false, false, true);
        let amount_after_fee = params.amount - fee_amount;
        
        // Pull bridge amount to router.
        token.transfer_from(user, get_contract_address(), params.amount);
        
        // Transfer fee to treasury sink.
        if fee_amount > 0 {
            token.transfer(storage.fee_recipient.read(), fee_amount);
            
            let treasury = ITreasuryDispatcher { contract_address: storage.treasury.read() };
            treasury.collect_fee(fee_amount, fee_type);
        }
        
        // Execute bridge call via configured provider.
        let bridge_id = _execute_bridge(params.bridge_provider, params.token, amount_after_fee, params.target_chain_id, params.recipient);
        
        // Points are calculated off-chain from events.
        
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

    // Returns quote tuple: expected output, fee amount, path, and dex list.
    // Includes selected fee mode and route estimation.
    #[external(v0)]
    fn get_quote(
        from_token: ContractAddress,
        to_token: ContractAddress,
        amount_in: u256,
        use_private_mode: bool,
        use_mev_protection: bool
    ) -> (u256, u256, Array<ContractAddress>, Array<ContractAddress>) {
        // Calculate fee for requested mode.
        let (fee_amount, _) = _calculate_fee(amount_in, use_private_mode, use_mev_protection, false);
        let amount_after_fee = amount_in - fee_amount;
        
        // Build route estimate after fee deduction.
        let route = _find_best_route(from_token, to_token, amount_after_fee);
        
        (route.expected_amount_out, fee_amount, route.path, route.dexes)
    }

    // Adds a DEX contract to routing allowlist.
    // `dex_address` is approved as a swap route target.
    #[external(v0)]
    fn add_dex(dex_address: ContractAddress) {
        assert(get_caller_address() == storage.owner.read(), 'Ownable: caller is not owner');
        storage.approved_dexes.write(dex_address, true);
    }

    // Adds bridge provider contract to allowlist.
    // `bridge_address` is approved as an outbound bridge target.
    #[external(v0)]
    fn add_bridge(bridge_address: ContractAddress) {
        assert(get_caller_address() == storage.owner.read(), 'Ownable: caller is not owner');
        storage.approved_bridges.write(bridge_address, true);
    }

    // Updates fee configuration used by swap and bridge paths.
    // swap_fee/bridge_fee/mev_fee/private_fee: values in basis points.
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

    // Sets price oracle contract used for quote estimation.
    // `oracle` is used by quote helpers that depend on external pricing.
    #[external(v0)]
    fn set_price_oracle(oracle: ContractAddress) {
        assert(get_caller_address() == storage.owner.read(), 'Ownable: caller is not owner');
        storage.price_oracle.write(oracle);
    }

    // Maps token to oracle asset id and token decimals.
    // token/asset_id/decimals: metadata used by `_oracle_quote`.
    #[external(v0)]
    fn set_token_oracle_config(token: ContractAddress, asset_id: felt252, decimals: u32) {
        assert(get_caller_address() == storage.owner.read(), 'Ownable: caller is not owner');
        storage.oracle_asset_ids.write(token, asset_id);
        storage.oracle_decimals.write(token, decimals);
    }

    // Computes fee amount and fee label from selected mode flags.
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

    // Builds route candidate and estimates output using oracle quote.
    fn _find_best_route(
        from_token: ContractAddress,
        to_token: ContractAddress,
        amount: u256
    ) -> Route {
        let path = array![from_token, storage.weth.read(), to_token];
        let zero: ContractAddress = 0.try_into().unwrap();
        let dexes = array![zero]; // Default DEX

        let expected_amount_out = _oracle_quote(from_token, to_token, amount);
        assert(expected_amount_out > 0, 'Oracle quote unavailable');
        let fee_amount = (amount * 30.into()) / 10000; // 0.3%
        
        Route {
            path: path,
            dexes: dexes,
            expected_amount_out: expected_amount_out,
            fee_amount: fee_amount,
        }
    }

    // Converts input token amount to output token amount using oracle prices.
    fn _oracle_quote(
        from_token: ContractAddress,
        to_token: ContractAddress,
        amount: u256
    ) -> u256 {
        let oracle_address = storage.price_oracle.read();
        let zero: ContractAddress = 0.try_into().unwrap();
        if oracle_address == zero {
            return 0;
        }

        let from_asset_id = storage.oracle_asset_ids.read(from_token);
        let to_asset_id = storage.oracle_asset_ids.read(to_token);
        if from_asset_id == 0 || to_asset_id == 0 {
            return 0;
        }

        let from_decimals = storage.oracle_decimals.read(from_token);
        let to_decimals = storage.oracle_decimals.read(to_token);

        let oracle = IPriceOracleDispatcher { contract_address: oracle_address };
        let value_usd = oracle.get_price_usd(from_token, from_asset_id, amount, from_decimals);
        if value_usd == 0 {
            return 0;
        }

        let to_price = oracle.get_price(to_token, to_asset_id);
        if to_price == 0 {
            return 0;
        }

        let scale = _pow10(to_decimals);
        (value_usd * scale) / to_price
    }

    // Returns 10^decimals as u256 scaling factor.
    fn _pow10(decimals: u32) -> u256 {
        let mut value: u256 = 1;
        let mut i: u32 = 0;
        while i < decimals {
            value *= 10;
            i += 1;
        };
        value
    }

    // Internal swap execution hook.
    // Currently returns input amount as placeholder simulation.
    fn _execute_swap(route: Route, amount: u256, recipient: ContractAddress) -> u256 {
        // In production this should call the selected DEX contracts.
        amount
    }

    // Internal bridge execution hook that returns deterministic bridge id.
    fn _execute_bridge(
        provider: felt252,
        token: ContractAddress,
        amount: u256,
        target_chain_id: u64,
        recipient: ContractAddress
    ) -> felt252 {
        // Generate deterministic bridge id for tracking.
        let bridge_id = starknet::pedersen(array![
            get_caller_address().into(),
            token.into(),
            amount.low.into(),
            amount.high.into(),
            target_chain_id.into()
        ].span());
        
        bridge_id
    }

    // Hashes route path and DEX list for event indexing and cache keys.
    fn _hash_route(path: Array<ContractAddress>, dexes: Array<ContractAddress>) -> felt252 {
        let mut data = array![];
        
        // Hash path segment.
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
        
        // Hash DEX segment.
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
