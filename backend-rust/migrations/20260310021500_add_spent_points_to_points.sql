ALTER TABLE points
ADD COLUMN IF NOT EXISTS spent_points DECIMAL(30, 2) DEFAULT 0;

UPDATE points
SET spent_points = 0
WHERE spent_points IS NULL;
