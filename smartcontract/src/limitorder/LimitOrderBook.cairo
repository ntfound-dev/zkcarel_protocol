#[contract]
mod LimitOrderBook {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use array::ArrayTrait;
    use option::OptionTrait;
    use super::ICARELToken;
    use super::IZkCarelPoints;

    #[storage]
    struct Storage {
        owner: ContractAddress,
        points_contract: ContractAddress,
        next_order_id: u256,
        orders: LegacyMap<felt252, LimitOrder>,
        user_orders: LegacyMap<ContractAddress, Array<felt252>>,
        order_book: LegacyMap<(ContractAddress, ContractAddress), Array<felt252>>, // (from_token, to_token) -> order_ids
        price_ticks: LegacyMap<(ContractAddress, ContractAddress, u256), Array<felt252>>, // price level orders
        min_order_amount: u256,
        taker_fee_bps: u64,
        maker_fee_bps: u64,
        order_expiry_days: u64,
        max_open_orders: u64,
    }

    #[derive(Drop, Serde)]
    struct LimitOrder {
        order_id: felt252,
        owner: ContractAddress,
        from_token: ContractAddress,
        to_token: ContractAddress,
        order_type: u8, // 0=buy, 1=sell
        amount: u256,
        filled: u256,
        price: u256, // price of to_token in from_token (with 18 decimals)
        expiry: u64,
        recipient: ContractAddress,
        status: u8, // 0=active, 1=partially_filled, 2=filled, 3=cancelled, 4=expired
        created_at: u64,
        last_updated: u64,
        fee_paid: u256,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        OrderCreated: OrderCreated,
        OrderFilled: OrderFilled,
        OrderCancelled: OrderCancelled,
        OrderExpired: OrderExpired,
        OrderPartiallyFilled: OrderPartiallyFilled,
    }

    #[derive(Drop, starknet::Event)]
    struct OrderCreated {
        order_id: felt252,
        owner: ContractAddress,
        order_type: u8,
        from_token: ContractAddress,
        to_token: ContractAddress,
        amount: u256,
        price: u256,
        expiry: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct OrderFilled {
        order_id: felt252,
        filler: ContractAddress,
        amount_filled: u256,
        total_filled: u256,
        fee: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct OrderCancelled {
        order_id: felt252,
        owner: ContractAddress,
        amount_cancelled: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct OrderExpired {
        order_id: felt252,
        owner: ContractAddress,
        amount_expired: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct OrderPartiallyFilled {
        order_id: felt252,
        filler: ContractAddress,
        amount_filled: u256,
        remaining: u256,
    }

    #[constructor]
    fn constructor(points_contract_address: ContractAddress) {
        storage.owner.write(get_caller_address());
        storage.points_contract.write(points_contract_address);
        storage.next_order_id.write(1);
        storage.min_order_amount.write(100 * 10**18); // 100 tokens
        storage.taker_fee_bps.write(30); // 0.3%
        storage.maker_fee_bps.write(10); // 0.1%
        storage.order_expiry_days.write(30); // 30 days
        storage.max_open_orders.write(20);
    }

    #[external(v0)]
    fn create_order(
        order_type: u8,
        from_token: ContractAddress,
        to_token: ContractAddress,
        amount: u256,
        price: u256,
        expiry: u64,
        recipient: ContractAddress
    ) -> felt252 {
        let owner = get_caller_address();
        
        // Validations
        assert(order_type <= 1, 'Invalid order type'); // 0 or 1 only
        assert(amount >= storage.min_order_amount.read(), 'Amount below minimum');
        assert(price > 0, 'Price must be > 0');
        assert(expiry > get_block_timestamp(), 'Expiry must be in future');
        
        if recipient == ContractAddress::default() {
            recipient = owner;
        }
        
        // Check max open orders
        let user_orders = storage.user_orders.read(owner);
        let active_count = _count_active_orders(user_orders);
        assert(active_count < storage.max_open_orders.read(), 'Max open orders reached');
        
        // Transfer tokens from owner (for sell orders)
        if order_type == 1 { // sell order
            let from_token_contract = ICARELTokenDispatcher { contract_address: from_token };
            let allowance = from_token_contract.allowance(owner, get_contract_address());
            assert(allowance >= amount, 'Insufficient allowance');
            
            from_token_contract.transfer_from(owner, get_contract_address(), amount);
        }
        
        // Create order
        let order_id = _generate_order_id(owner, from_token, to_token, amount, price);
        let order = LimitOrder {
            order_id: order_id,
            owner: owner,
            from_token: from_token,
            to_token: to_token,
            order_type: order_type,
            amount: amount,
            filled: 0,
            price: price,
            expiry: expiry,
            recipient: recipient,
            status: 0, // active
            created_at: get_block_timestamp(),
            last_updated: get_block_timestamp(),
            fee_paid: 0,
        };
        
        storage.orders.write(order_id, order);
        
        // Add to user's orders
        let mut updated_user_orders = user_orders;
        updated_user_orders.append(order_id);
        storage.user_orders.write(owner, updated_user_orders);
        
        // Add to order book
        let key = (from_token, to_token);
        let mut orders = storage.order_book.read(key);
        orders.append(order_id);
        storage.order_book.write(key, orders);
        
        // Add to price ticks
        let price_key = (from_token, to_token, price);
        let mut price_orders = storage.price_ticks.read(price_key);
        price_orders.append(order_id);
        storage.price_ticks.write(price_key, price_orders);
        
        // Add points for creating order
        let points_contract = IZkCarelPointsDispatcher { contract_address: storage.points_contract.read() };
        let points_earned = (amount / 10**18) * 5; // $5 per token for creating order
        points_contract.add_points(owner, points_earned, 'limit_order_create');
        
        // Emit event
        let mut events = array![];
        events.append(Event::OrderCreated(OrderCreated {
            order_id: order_id,
            owner: owner,
            order_type: order_type,
            from_token: from_token,
            to_token: to_token,
            amount: amount,
            price: price,
            expiry: expiry,
        }));
        starknet::emit_event_syscall(events.span()).unwrap();
        
        order_id
    }

    #[external(v0)]
    fn fill_order(
        order_id: felt252,
        amount_to_fill: u256
    ) -> u256 {
        let filler = get_caller_address();
        let mut order = storage.orders.read(order_id);
        
        // Validations
        assert(order.status < 2, 'Order not active'); // 0=active, 1=partially_filled
        assert(get_block_timestamp() < order.expiry, 'Order expired');
        assert(amount_to_fill > 0, 'Amount must be > 0');
        assert(order.amount - order.filled >= amount_to_fill, 'Insufficient order amount');
        
        // Calculate amounts based on order type
        let (from_amount, to_amount) = if order.order_type == 0 {
            // Buy order: paying with from_token, receiving to_token
            let to_amount = amount_to_fill;
            let from_amount = (to_amount * order.price) / 10**18;
            (from_amount, to_amount)
        } else {
            // Sell order: selling from_token, receiving to_token
            let from_amount = amount_to_fill;
            let to_amount = (from_amount * 10**18) / order.price;
            (from_amount, to_amount)
        };
        
        // Check filler's balance and allowance
        let filler_token = if order.order_type == 0 { order.from_token } else { order.to_token };
        let filler_amount = if order.order_type == 0 { from_amount } else { to_amount };
        
        let filler_token_contract = ICARELTokenDispatcher { contract_address: filler_token };
        let allowance = filler_token_contract.allowance(filler, get_contract_address());
        assert(allowance >= filler_amount, 'Insufficient allowance');
        
        // Calculate fees
        let taker_fee = (filler_amount * storage.taker_fee_bps.read().into()) / 10000;
        let maker_fee = (filler_amount * storage.maker_fee_bps.read().into()) / 10000;
        
        // Transfer tokens
        if order.order_type == 0 {
            // Buy order: filler pays from_token, receives to_token
            // Transfer from filler to order owner
            filler_token_contract.transfer_from(filler, order.owner, from_amount - taker_fee);
            
            // Transfer to_token from contract to filler
            let to_token_contract = ICARELTokenDispatcher { contract_address: order.to_token };
            to_token_contract.transfer(filler, to_amount);
            
            // Transfer fee to treasury (from taker)
            if taker_fee > 0 {
                filler_token_contract.transfer_from(filler, get_contract_address(), taker_fee);
            }
        } else {
            // Sell order: filler pays to_token, receives from_token
            // Transfer to_token from filler to order owner
            let to_token_contract = ICARELTokenDispatcher { contract_address: order.to_token };
            to_token_contract.transfer_from(filler, order.owner, to_amount - taker_fee);
            
            // Transfer from_token from contract to filler
            let from_token_contract = ICARELTokenDispatcher { contract_address: order.from_token };
            from_token_contract.transfer(filler, from_amount);
            
            // Transfer fee to treasury (from taker)
            if taker_fee > 0 {
                to_token_contract.transfer_from(filler, get_contract_address(), taker_fee);
            }
        }
        
        // Update order
        order.filled = order.filled + amount_to_fill;
        order.last_updated = get_block_timestamp();
        order.fee_paid = order.fee_paid + maker_fee;
        
        if order.filled == order.amount {
            order.status = 2; // filled
            
            // Remove from price ticks
            let price_key = (order.from_token, order.to_token, order.price);
            let mut price_orders = storage.price_ticks.read(price_key);
            
            // Find and remove order_id
            let mut new_price_orders = array![];
            let price_orders_len = price_orders.len();
            let mut i = 0;
            loop {
                if i >= price_orders_len {
                    break;
                }
                if price_orders.at(i) != order_id {
                    new_price_orders.append(price_orders.at(i));
                }
                i += 1;
            }
            storage.price_ticks.write(price_key, new_price_orders);
            
            // Emit filled event
            let mut events = array![];
            events.append(Event::OrderFilled(OrderFilled {
                order_id: order_id,
                filler: filler,
                amount_filled: amount_to_fill,
                total_filled: order.filled,
                fee: taker_fee,
            }));
            starknet::emit_event_syscall(events.span()).unwrap();
        } else {
            order.status = 1; // partially filled
            
            // Emit partially filled event
            let mut events = array![];
            events.append(Event::OrderPartiallyFilled(OrderPartiallyFilled {
                order_id: order_id,
                filler: filler,
                amount_filled: amount_to_fill,
                remaining: order.amount - order.filled,
            }));
            starknet::emit_event_syscall(events.span()).unwrap();
        }
        
        storage.orders.write(order_id, order);
        
        // Add points for filling order
        let points_contract = IZkCarelPointsDispatcher { contract_address: storage.points_contract.read() };
        let points_earned = (amount_to_fill / 10**18) * 8; // $8 per token for filling order
        points_contract.add_points(filler, points_earned, 'limit_order_fill');
        
        amount_to_fill
    }

    #[external(v0)]
    fn cancel_order(order_id: felt252) -> u256 {
        let caller = get_caller_address();
        let mut order = storage.orders.read(order_id);
        
        assert(order.owner == caller, 'Not order owner');
        assert(order.status < 2, 'Order already filled');
        assert(get_block_timestamp() < order.expiry, 'Order expired');
        
        // Calculate amount to refund
        let refund_amount = order.amount - order.filled;
        
        // Refund tokens (for sell orders)
        if order.order_type == 1 && refund_amount > 0 {
            let from_token_contract = ICARELTokenDispatcher { contract_address: order.from_token };
            from_token_contract.transfer(order.owner, refund_amount);
        }
        
        // Update order
        order.status = 3; // cancelled
        order.last_updated = get_block_timestamp();
        storage.orders.write(order_id, order);
        
        // Remove from price ticks
        let price_key = (order.from_token, order.to_token, order.price);
        let mut price_orders = storage.price_ticks.read(price_key);
        
        let mut new_price_orders = array![];
        let price_orders_len = price_orders.len();
        let mut i = 0;
        loop {
            if i >= price_orders_len {
                break;
            }
            if price_orders.at(i) != order_id {
                new_price_orders.append(price_orders.at(i));
            }
            i += 1;
        }
        storage.price_ticks.write(price_key, new_price_orders);
        
        // Emit event
        let mut events = array![];
        events.append(Event::OrderCancelled(OrderCancelled {
            order_id: order_id,
            owner: caller,
            amount_cancelled: refund_amount,
        }));
        starknet::emit_event_syscall(events.span()).unwrap();
        
        refund_amount
    }

    #[external(v0)]
    fn expire_order(order_id: felt252) -> bool {
        // Can be called by anyone to clean up expired orders
        let mut order = storage.orders.read(order_id);
        
        if get_block_timestamp() >= order.expiry && order.status < 2 {
            // Refund remaining tokens (for sell orders)
            let refund_amount = order.amount - order.filled;
            
            if order.order_type == 1 && refund_amount > 0 {
                let from_token_contract = ICARELTokenDispatcher { contract_address: order.from_token };
                from_token_contract.transfer(order.owner, refund_amount);
            }
            
            // Update order
            order.status = 4; // expired
            order.last_updated = get_block_timestamp();
            storage.orders.write(order_id, order);
            
            // Remove from price ticks
            let price_key = (order.from_token, order.to_token, order.price);
            let mut price_orders = storage.price_ticks.read(price_key);
            
            let mut new_price_orders = array![];
            let price_orders_len = price_orders.len();
            let mut i = 0;
            loop {
                if i >= price_orders_len {
                    break;
                }
                if price_orders.at(i) != order_id {
                    new_price_orders.append(price_orders.at(i));
                }
                i += 1;
            }
            storage.price_ticks.write(price_key, new_price_orders);
            
            // Emit event
            let mut events = array![];
            events.append(Event::OrderExpired(OrderExpired {
                order_id: order_id,
                owner: order.owner,
                amount_expired: refund_amount,
            }));
            starknet::emit_event_syscall(events.span()).unwrap();
            
            true
        } else {
            false
        }
    }

    #[external(v0)]
    fn get_order(order_id: felt252) -> LimitOrder {
        storage.orders.read(order_id)
    }

    #[external(v0)]
    fn get_user_orders(user: ContractAddress) -> Array<felt252> {
        storage.user_orders.read(user)
    }

    #[external(v0)]
    fn get_order_book(
        from_token: ContractAddress,
        to_token: ContractAddress,
        order_type: u8
    ) -> Array<felt252> {
        let key = (from_token, to_token);
        let all_orders = storage.order_book.read(key);
        
        let mut filtered_orders = array![];
        let all_orders_len = all_orders.len();
        let mut i = 0;
        
        loop {
            if i >= all_orders_len {
                break;
            }
            
            let order_id = all_orders.at(i);
            let order = storage.orders.read(order_id);
            
            if order.order_type == order_type && order.status < 2 {
                filtered_orders.append(order_id);
            }
            
            i += 1;
        }
        
        filtered_orders
    }

    #[external(v0)]
    fn get_best_price(
        from_token: ContractAddress,
        to_token: ContractAddress,
        order_type: u8
    ) -> u256 {
        let key = (from_token, to_token);
        let all_orders = storage.order_book.read(key);
        
        let mut best_price = if order_type == 0 { 0 } else { u256::MAX };
        let all_orders_len = all_orders.len();
        let mut i = 0;
        
        loop {
            if i >= all_orders_len {
                break;
            }
            
            let order_id = all_orders.at(i);
            let order = storage.orders.read(order_id);
            
            if order.order_type == order_type && order.status < 2 {
                if order_type == 0 {
                    // Buy orders: highest price is best
                    if order.price > best_price {
                        best_price = order.price;
                    }
                } else {
                    // Sell orders: lowest price is best
                    if order.price < best_price {
                        best_price = order.price;
                    }
                }
            }
            
            i += 1;
        }
        
        best_price
    }

    #[external(v0)]
    fn set_min_order_amount(amount: u256) {
        assert(get_caller_address() == storage.owner.read(), 'Unauthorized');
        storage.min_order_amount.write(amount);
    }

    #[external(v0)]
    fn set_fees(taker_fee_bps: u64, maker_fee_bps: u64) {
        assert(get_caller_address() == storage.owner.read(), 'Unauthorized');
        storage.taker_fee_bps.write(taker_fee_bps);
        storage.maker_fee_bps.write(maker_fee_bps);
    }

    fn _generate_order_id(
        owner: ContractAddress,
        from_token: ContractAddress,
        to_token: ContractAddress,
        amount: u256,
        price: u256
    ) -> felt252 {
        let mut data = array![];
        data.append(owner.into());
        data.append(from_token.into());
        data.append(to_token.into());
        data.append(amount.low.into());
        data.append(amount.high.into());
        data.append(price.low.into());
        data.append(price.high.into());
        data.append(get_block_timestamp().into());
        
        starknet::pedersen(data.span())
    }

    fn _count_active_orders(order_ids: Array<felt252>) -> u64 {
        let mut count = 0;
        let order_ids_len = order_ids.len();
        let mut i = 0;
        
        loop {
            if i >= order_ids_len {
                break;
            }
            
            let order_id = order_ids.at(i);
            let order = storage.orders.read(order_id);
            
            if order.status < 2 { // active or partially filled
                count += 1;
            }
            
            i += 1;
        }
        
        count
    }
}