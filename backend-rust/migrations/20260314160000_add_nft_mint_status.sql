ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'confirmed';

ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS nft_tier SMALLINT;

CREATE INDEX IF NOT EXISTS idx_transactions_status
    ON transactions(status);
