use crate::error::{AppError, Result};
use rust_decimal::prelude::{FromPrimitive, ToPrimitive};
use rust_decimal::Decimal;

// Shared helpers for bridge amount parsing/formatting without floating-point math.

const UI_DECIMAL_CAP: u32 = 8;

pub fn bridge_token_decimals(token: &str) -> u32 {
    match token.trim().to_ascii_uppercase().as_str() {
        "BTC" | "WBTC" => 8,
        "USDT" | "USDC" => 6,
        _ => 18,
    }
}

fn scale_for_decimals(decimals: u32) -> Result<u128> {
    10u128
        .checked_pow(decimals)
        .ok_or_else(|| AppError::BadRequest("Amount precision overflow".to_string()))
}

pub fn parse_amount_to_units(amount: &str, token: &str) -> Result<u128> {
    let raw = amount.trim();
    if raw.is_empty() {
        return Err(AppError::BadRequest("Invalid amount".to_string()));
    }

    let (whole_raw, frac_raw) = match raw.split_once('.') {
        Some((whole, frac)) => (whole, frac),
        None => (raw, ""),
    };

    let whole_raw = if whole_raw.is_empty() { "0" } else { whole_raw };

    if !whole_raw.chars().all(|ch| ch.is_ascii_digit()) {
        return Err(AppError::BadRequest("Invalid amount".to_string()));
    }
    if !frac_raw.chars().all(|ch| ch.is_ascii_digit()) {
        return Err(AppError::BadRequest("Invalid amount".to_string()));
    }

    let decimals = bridge_token_decimals(token);
    if frac_raw.len() > decimals as usize {
        return Err(AppError::BadRequest(
            "Amount has too many decimal places".to_string(),
        ));
    }

    let scale = scale_for_decimals(decimals)?;
    let whole = whole_raw
        .parse::<u128>()
        .map_err(|_| AppError::BadRequest("Invalid amount".to_string()))?;
    let mut units = whole
        .checked_mul(scale)
        .ok_or_else(|| AppError::BadRequest("Amount is too large".to_string()))?;

    if !frac_raw.is_empty() {
        let mut frac = frac_raw.to_string();
        while frac.len() < decimals as usize {
            frac.push('0');
        }
        let frac_value = frac
            .parse::<u128>()
            .map_err(|_| AppError::BadRequest("Invalid amount".to_string()))?;
        units = units
            .checked_add(frac_value)
            .ok_or_else(|| AppError::BadRequest("Amount is too large".to_string()))?;
    }

    if units == 0 {
        return Err(AppError::BadRequest(
            "Amount must be greater than 0".to_string(),
        ));
    }

    Ok(units)
}

pub fn format_units_as_token_amount(units: u128, token: &str) -> String {
    let decimals = bridge_token_decimals(token);
    if decimals == 0 {
        return units.to_string();
    }
    let scale = 10u128.pow(decimals);
    let whole = units / scale;
    let frac = units % scale;
    if frac == 0 {
        return whole.to_string();
    }
    let mut frac_text = format!("{:0width$}", frac, width = decimals as usize);
    while frac_text.ends_with('0') {
        frac_text.pop();
    }
    format!("{}.{}", whole, frac_text)
}

pub fn format_units_for_ui(units: u128, token: &str) -> String {
    format_units_with_cap(units, token, UI_DECIMAL_CAP)
}

fn format_units_with_cap(units: u128, token: &str, max_decimals: u32) -> String {
    let decimals = bridge_token_decimals(token);
    if decimals == 0 {
        return units.to_string();
    }
    let scale = 10u128.pow(decimals);
    let whole = units / scale;
    let frac = units % scale;

    let capped = max_decimals.min(decimals);
    if capped == 0 || frac == 0 {
        return whole.to_string();
    }

    let mut frac_text = format!("{:0width$}", frac, width = decimals as usize);
    if capped < decimals {
        frac_text.truncate(capped as usize);
    }
    while frac_text.ends_with('0') {
        frac_text.pop();
    }
    if frac_text.is_empty() {
        whole.to_string()
    } else {
        format!("{}.{}", whole, frac_text)
    }
}

pub fn decimal_from_units(units: u128, token: &str) -> Decimal {
    let decimals = bridge_token_decimals(token);
    let scale = scale_for_decimals(decimals).unwrap_or(1);
    let scale_dec = Decimal::from_u128(scale).unwrap_or(Decimal::ONE);
    let raw = Decimal::from_u128(units).unwrap_or(Decimal::ZERO);
    raw / scale_dec
}

pub fn float_from_units_lossy(units: u128, token: &str) -> f64 {
    decimal_from_units(units, token).to_f64().unwrap_or(0.0)
}

pub fn units_from_float_lossy(amount: f64, token: &str) -> Option<u128> {
    if !amount.is_finite() || amount <= 0.0 {
        return None;
    }
    let decimals = bridge_token_decimals(token);
    let formatted = format!("{:.*}", decimals as usize, amount);
    parse_amount_to_units(&formatted, token).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_units_for_ui_caps_decimals() {
        let units = 123_456_789u128; // 123.456789 USDC (6 decimals)
        assert_eq!(format_units_for_ui(units, "USDC"), "123.456789");

        let units_eth = 1_234_567_890_123_456_789u128; // 1.234567890123456789
        assert_eq!(format_units_for_ui(units_eth, "CAREL"), "1.23456789");
    }

    #[test]
    fn format_units_for_ui_trims_trailing_zeros() {
        let units = 1_500_000_000_000_000_000u128; // 1.5 CAREL
        assert_eq!(format_units_for_ui(units, "CAREL"), "1.5");
    }
}
