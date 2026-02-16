-- Performance indexes for high-volume workloads (point worker + leaderboard + history).

-- Point worker: fast scan for oldest unprocessed transactions.
CREATE INDEX IF NOT EXISTS idx_transactions_pending_timestamp
    ON transactions (timestamp, id)
    WHERE processed = false;

-- Case-insensitive filters for user-scoped transaction queries on public activity.
CREATE INDEX IF NOT EXISTS idx_transactions_public_user_ci_time
    ON transactions (LOWER(user_address), timestamp DESC)
    WHERE COALESCE(is_private, false) = false;

-- Case-insensitive filters for point lookup by wallet identity.
CREATE INDEX IF NOT EXISTS idx_points_user_ci_epoch
    ON points (LOWER(user_address), epoch);

-- Speed up joins that map wallet address -> canonical user identity.
CREATE INDEX IF NOT EXISTS idx_user_wallet_addresses_wallet_ci
    ON user_wallet_addresses (LOWER(wallet_address));

-- Speed up case-insensitive joins to users table.
CREATE INDEX IF NOT EXISTS idx_users_address_ci
    ON users (LOWER(address));

-- Speed up referral leaderboard grouping/lookup using referrer case-insensitively.
CREATE INDEX IF NOT EXISTS idx_users_referrer_ci
    ON users (LOWER(referrer))
    WHERE referrer IS NOT NULL;
