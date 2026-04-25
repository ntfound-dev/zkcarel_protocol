CREATE TABLE IF NOT EXISTS indexed_blocks (
    block_number BIGINT PRIMARY KEY,
    block_hash VARCHAR(66) NOT NULL,
    parent_hash VARCHAR(66),
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_indexed_blocks_hash ON indexed_blocks (block_hash);
