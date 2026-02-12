-- Support multiple linked wallets per logical user (starknet + evm + bitcoin)
CREATE TABLE IF NOT EXISTS user_wallet_addresses (
    id BIGSERIAL PRIMARY KEY,
    user_address VARCHAR(66) NOT NULL REFERENCES users(address) ON DELETE CASCADE,
    chain VARCHAR(16) NOT NULL,
    wallet_address VARCHAR(128) NOT NULL,
    provider VARCHAR(32),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_address, chain),
    UNIQUE(chain, wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_user_wallet_addresses_user
    ON user_wallet_addresses(user_address);
CREATE INDEX IF NOT EXISTS idx_user_wallet_addresses_chain
    ON user_wallet_addresses(chain);

-- Hide private mode trades from default trading history/feed.
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS is_private BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_transactions_private
    ON transactions(is_private);
