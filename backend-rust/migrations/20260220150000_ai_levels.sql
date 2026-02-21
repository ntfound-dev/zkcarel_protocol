-- AI Access Levels (L1/L2/L3) + upgrade audit trail

CREATE TABLE IF NOT EXISTS user_ai_levels (
    user_address VARCHAR(66) PRIMARY KEY REFERENCES users(address) ON DELETE CASCADE,
    level SMALLINT NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 3),
    upgraded_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_ai_levels_level
    ON user_ai_levels(level);

CREATE TABLE IF NOT EXISTS ai_level_upgrades (
    id BIGSERIAL PRIMARY KEY,
    user_address VARCHAR(66) NOT NULL REFERENCES users(address) ON DELETE CASCADE,
    previous_level SMALLINT NOT NULL CHECK (previous_level BETWEEN 1 AND 3),
    target_level SMALLINT NOT NULL CHECK (target_level BETWEEN 2 AND 3),
    payment_carel DECIMAL(30, 18) NOT NULL,
    onchain_tx_hash VARCHAR(66) NOT NULL UNIQUE,
    block_number BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_level_upgrades_user_created
    ON ai_level_upgrades(user_address, created_at DESC);
