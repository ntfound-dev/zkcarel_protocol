// Utility modules

use crate::error::{AppError, Result};

/// Basic guard for list/query limits to avoid expensive queries.
pub fn ensure_page_limit(limit: i32, configured_max: u32) -> Result<()> {
    if limit <= 0 {
        return Err(AppError::BadRequest(
            "Page limit must be greater than 0".to_string(),
        ));
    }
    if (limit as u32) > configured_max {
        return Err(AppError::BadRequest(
            "Page limit is invalid or too large".to_string(),
        ));
    }

    Ok(())
}
