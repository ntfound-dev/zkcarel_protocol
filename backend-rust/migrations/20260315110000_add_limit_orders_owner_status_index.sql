CREATE INDEX IF NOT EXISTS idx_limit_orders_owner_status ON limit_orders(owner, status);
