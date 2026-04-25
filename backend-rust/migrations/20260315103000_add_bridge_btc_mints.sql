CREATE TABLE IF NOT EXISTS bridge_btc_mints (
    id BIGSERIAL PRIMARY KEY,
    btc_txid VARCHAR(100) NOT NULL UNIQUE,
    vault_address VARCHAR(128) NOT NULL,
    btc_sats BIGINT NOT NULL,
    usd_value DECIMAL(30, 18) NOT NULL,
    points_amount DECIMAL(30, 18) NOT NULL,
    starknet_recipient VARCHAR(66),
    mint_tx_hash VARCHAR(66),
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bridge_btc_mints_status ON bridge_btc_mints(status);
