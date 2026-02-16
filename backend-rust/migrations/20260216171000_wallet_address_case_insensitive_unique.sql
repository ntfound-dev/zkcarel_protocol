-- Enforce wallet uniqueness case-insensitively so the same wallet address
-- cannot be linked to multiple users via casing variations.

UPDATE user_wallet_addresses
SET
    chain = LOWER(chain),
    wallet_address = CASE
        WHEN LOWER(chain) IN ('bitcoin', 'btc') THEN LOWER(wallet_address)
        WHEN wallet_address ~* '^0x' THEN '0x' || LOWER(SUBSTRING(wallet_address FROM 3))
        ELSE LOWER(wallet_address)
    END,
    updated_at = NOW()
WHERE
    chain <> LOWER(chain)
    OR wallet_address <> CASE
        WHEN LOWER(chain) IN ('bitcoin', 'btc') THEN LOWER(wallet_address)
        WHEN wallet_address ~* '^0x' THEN '0x' || LOWER(SUBSTRING(wallet_address FROM 3))
        ELSE LOWER(wallet_address)
    END;

WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY LOWER(chain), LOWER(wallet_address)
            ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
        ) AS rn
    FROM user_wallet_addresses
)
DELETE FROM user_wallet_addresses uwa
USING ranked
WHERE uwa.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_wallet_addresses_chain_wallet_ci
    ON user_wallet_addresses (LOWER(chain), LOWER(wallet_address));
