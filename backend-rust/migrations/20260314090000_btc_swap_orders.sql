-- Shadow BTC swap orders
CREATE TABLE IF NOT EXISTS btc_swap_orders (
    id BIGSERIAL PRIMARY KEY,
    user_address VARCHAR(66) NOT NULL REFERENCES users(address),
    deposit_address VARCHAR(128) NOT NULL,
    refund_address VARCHAR(128),
    btc_txid VARCHAR(100),
    btc_amount_sats BIGINT,
    note_commitment VARCHAR(66),
    proof_cid VARCHAR(128),
    proof_hash VARCHAR(66),
    starknet_tx_hash VARCHAR(66),
    status VARCHAR(32) NOT NULL,
    confirmations INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    source_seen_at TIMESTAMPTZ,
    source_finalized_at TIMESTAMPTZ,
    destination_initiated_at TIMESTAMPTZ,
    destination_redeemed_at TIMESTAMPTZ,
    refunded_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_btc_swap_user ON btc_swap_orders(user_address);
CREATE INDEX IF NOT EXISTS idx_btc_swap_status ON btc_swap_orders(status);
CREATE INDEX IF NOT EXISTS idx_btc_swap_deposit_address ON btc_swap_orders(deposit_address);
CREATE INDEX IF NOT EXISTS idx_btc_swap_btc_txid ON btc_swap_orders(btc_txid);
CREATE INDEX IF NOT EXISTS idx_btc_swap_expires_at ON btc_swap_orders(expires_at);
