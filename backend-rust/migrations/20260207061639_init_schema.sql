-- Users
CREATE TABLE IF NOT EXISTS users (
    address VARCHAR(66) PRIMARY KEY,
    referrer VARCHAR(66) REFERENCES users(address),
    display_name VARCHAR(50) UNIQUE,
    twitter_username VARCHAR(50),
    telegram_username VARCHAR(50),
    discord_id VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_active TIMESTAMPTZ,
    total_volume_usd DECIMAL(30, 2) DEFAULT 0
);

CREATE INDEX idx_users_referrer ON users(referrer);

-- Points
CREATE TABLE IF NOT EXISTS points (
    id BIGSERIAL PRIMARY KEY,
    user_address VARCHAR(66) NOT NULL REFERENCES users(address),
    epoch BIGINT NOT NULL,
    swap_points DECIMAL(30, 2) DEFAULT 0,
    bridge_points DECIMAL(30, 2) DEFAULT 0,
    stake_points DECIMAL(30, 2) DEFAULT 0,
    referral_points DECIMAL(30, 2) DEFAULT 0,
    social_points DECIMAL(30, 2) DEFAULT 0,
    total_points DECIMAL(30, 2),
    staking_multiplier DECIMAL(5, 2) DEFAULT 1.0,
    nft_boost BOOLEAN DEFAULT FALSE,
    wash_trading_flagged BOOLEAN DEFAULT FALSE,
    finalized BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_address, epoch)
);

CREATE INDEX idx_points_epoch ON points(epoch);
CREATE INDEX idx_points_user_epoch ON points(user_address, epoch);

-- Transactions
CREATE TABLE IF NOT EXISTS transactions (
    id BIGSERIAL PRIMARY KEY,
    tx_hash VARCHAR(66) UNIQUE NOT NULL,
    block_number BIGINT NOT NULL,
    user_address VARCHAR(66) NOT NULL REFERENCES users(address),
    tx_type VARCHAR(20) NOT NULL,
    token_in VARCHAR(66),
    token_out VARCHAR(66),
    amount_in DECIMAL(30, 18),
    amount_out DECIMAL(30, 18),
    usd_value DECIMAL(30, 2),
    fee_paid DECIMAL(30, 18),
    points_earned DECIMAL(30, 2),
    timestamp TIMESTAMPTZ NOT NULL,
    processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tx_user ON transactions(user_address);
CREATE INDEX idx_tx_type ON transactions(tx_type);
CREATE INDEX idx_tx_timestamp ON transactions(timestamp);
CREATE INDEX idx_tx_processed ON transactions(processed);

-- Faucet Claims
CREATE TABLE IF NOT EXISTS faucet_claims (
    id BIGSERIAL PRIMARY KEY,
    user_address VARCHAR(66) NOT NULL,
    token VARCHAR(10) NOT NULL,
    amount DECIMAL(30, 18) NOT NULL,
    tx_hash VARCHAR(66),
    claimed_at TIMESTAMPTZ DEFAULT NOW(),
    next_claim_at TIMESTAMPTZ
);

-- 
CREATE UNIQUE INDEX idx_faucet_daily_claim ON faucet_claims (user_address, token, (CAST(claimed_at AT TIME ZONE 'UTC' AS DATE)));
CREATE INDEX idx_faucet_user_token ON faucet_claims(user_address, token);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    user_address VARCHAR(66) NOT NULL,
    type VARCHAR(30) NOT NULL,
    title VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    data JSONB,
    read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_preferences (
    user_address VARCHAR(66) PRIMARY KEY,
    email_enabled BOOLEAN DEFAULT TRUE,
    push_enabled BOOLEAN DEFAULT TRUE,
    telegram_enabled BOOLEAN DEFAULT FALSE,
    discord_enabled BOOLEAN DEFAULT FALSE,
    notification_types JSONB
);

CREATE INDEX idx_notif_user ON notifications(user_address);
CREATE INDEX idx_notif_unread ON notifications(user_address, read) WHERE NOT read;

-- Price History
CREATE TABLE IF NOT EXISTS price_history (
    id BIGSERIAL PRIMARY KEY,
    token VARCHAR(10) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    open DECIMAL(30, 18) NOT NULL,
    high DECIMAL(30, 18) NOT NULL,
    low DECIMAL(30, 18) NOT NULL,
    close DECIMAL(30, 18) NOT NULL,
    volume DECIMAL(30, 18),
    interval VARCHAR(5) NOT NULL,
    UNIQUE(token, timestamp, interval)
);

CREATE INDEX idx_price_history_token_time ON price_history(token, timestamp, interval);

-- Limit Orders
CREATE TABLE IF NOT EXISTS limit_orders (
    id BIGSERIAL PRIMARY KEY,
    order_id VARCHAR(66) UNIQUE NOT NULL,
    owner VARCHAR(66) NOT NULL,
    from_token VARCHAR(66) NOT NULL,
    to_token VARCHAR(66) NOT NULL,
    amount DECIMAL(30, 18) NOT NULL,
    filled DECIMAL(30, 18) DEFAULT 0,
    price DECIMAL(30, 18) NOT NULL,
    expiry TIMESTAMPTZ NOT NULL,
    recipient VARCHAR(66),
    status SMALLINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_owner ON limit_orders(owner);
CREATE INDEX idx_orders_status ON limit_orders(status);
CREATE INDEX idx_orders_expiry ON limit_orders(expiry) WHERE status = 0;

-- Order Executions
CREATE TABLE IF NOT EXISTS order_executions (
    id BIGSERIAL PRIMARY KEY,
    order_id VARCHAR(66) NOT NULL,
    executor VARCHAR(66) NOT NULL,
    amount_filled DECIMAL(30, 18) NOT NULL,
    price_executed DECIMAL(30, 18) NOT NULL,
    gas_used DECIMAL(30, 18),
    tx_hash VARCHAR(66) NOT NULL,
    executed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_executions_order ON order_executions(order_id);

-- Merkle Roots
CREATE TABLE IF NOT EXISTS merkle_roots (
    epoch BIGINT PRIMARY KEY,
    root VARCHAR(66) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Epoch Snapshots
CREATE TABLE IF NOT EXISTS epoch_snapshots (
    epoch BIGINT PRIMARY KEY,
    total_points DECIMAL(30, 2),
    total_users BIGINT,
    finalized_at TIMESTAMPTZ
);

-- Epoch Metadata
CREATE TABLE IF NOT EXISTS epoch_metadata (
    epoch BIGINT PRIMARY KEY,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ
);

-- Deposits (Fiat On-Ramp)
CREATE TABLE IF NOT EXISTS deposits (
    id BIGSERIAL PRIMARY KEY,
    deposit_id VARCHAR(100) UNIQUE NOT NULL,
    user_address VARCHAR(66) NOT NULL,
    amount DECIMAL(30, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_deposits_user ON deposits(user_address);
CREATE INDEX idx_deposits_status ON deposits(status);

-- Webhooks
CREATE TABLE IF NOT EXISTS webhooks (
    id BIGSERIAL PRIMARY KEY,
    user_address VARCHAR(66) NOT NULL,
    url VARCHAR(500) NOT NULL,
    events TEXT[] NOT NULL,
    secret VARCHAR(100) NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_webhooks_user ON webhooks(user_address);

-- Webhook Logs
CREATE TABLE IF NOT EXISTS webhook_logs (
    id BIGSERIAL PRIMARY KEY,
    webhook_id BIGINT REFERENCES webhooks(id),
    event VARCHAR(50) NOT NULL,
    payload JSONB,
    status VARCHAR(20),
    delivered_at TIMESTAMPTZ,
    error_message TEXT
);

CREATE INDEX idx_webhook_logs_webhook ON webhook_logs(webhook_id);
CREATE INDEX idx_webhook_logs_delivered ON webhook_logs(delivered_at);
