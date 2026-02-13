ALTER TABLE users
    ADD COLUMN IF NOT EXISTS sumo_subject VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_sumo_subject_unique
    ON users(sumo_subject)
    WHERE sumo_subject IS NOT NULL;
