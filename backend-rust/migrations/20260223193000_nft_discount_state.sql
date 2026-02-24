CREATE TABLE IF NOT EXISTS nft_discount_state (
    contract_address VARCHAR(66) NOT NULL,
    user_address VARCHAR(66) NOT NULL,
    period_epoch BIGINT NOT NULL,
    tier INTEGER NOT NULL DEFAULT 0,
    discount_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    max_usage BIGINT NOT NULL DEFAULT 0,
    chain_used_in_period BIGINT NOT NULL DEFAULT 0,
    local_used_in_period BIGINT NOT NULL DEFAULT 0,
    last_chain_sync_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (contract_address, user_address, period_epoch)
);

CREATE INDEX IF NOT EXISTS idx_nft_discount_state_user_updated
    ON nft_discount_state (user_address, updated_at DESC);
