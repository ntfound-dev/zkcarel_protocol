// Utility modules

use crate::{
    constants::{RATE_LIMIT_REQUESTS_PER_HOUR, RATE_LIMIT_REQUESTS_PER_MINUTE},
    error::{AppError, Result},
};

/// Basic guard for list/query limits to avoid expensive queries.
pub fn ensure_page_limit(limit: i32, configured_max: u32) -> Result<()> {
    let hard_cap = RATE_LIMIT_REQUESTS_PER_MINUTE.min(RATE_LIMIT_REQUESTS_PER_HOUR);
    let max = configured_max.min(hard_cap).max(1);

    if limit as u32 > max {
        return Err(AppError::RateLimitExceeded);
    }

    Ok(())
}
