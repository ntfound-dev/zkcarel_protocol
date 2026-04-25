use crate::error::{AppError, Result};
use crate::services::onchain::felt_to_u128;
use starknet_core::types::Felt;

#[derive(Debug, Clone)]
pub struct ParsedExecuteCall {
    pub to: Felt,
    pub selector: Felt,
    pub calldata: Vec<Felt>,
}

// Internal helper that supports `felt_to_usize` operations.
fn felt_to_usize(value: &Felt, field_name: &str) -> Result<usize> {
    let raw = felt_to_u128(value).map_err(|_| {
        AppError::BadRequest(format!(
            "Invalid invoke calldata: {field_name} is not a valid number"
        ))
    })?;
    usize::try_from(raw).map_err(|_| {
        AppError::BadRequest(format!(
            "Invalid invoke calldata: {field_name} exceeds supported size"
        ))
    })
}

// Internal helper that parses or transforms values for `parse_execute_calls_offset`.
fn parse_execute_calls_offset(calldata: &[Felt]) -> Result<Vec<ParsedExecuteCall>> {
    if calldata.is_empty() {
        return Err(AppError::BadRequest(
            "Invalid invoke calldata: empty calldata".to_string(),
        ));
    }
    let calls_len = felt_to_usize(&calldata[0], "calls_len")?;
    let header_start = 1usize;
    let header_width = 4usize;
    let headers_end = header_start
        .checked_add(calls_len.checked_mul(header_width).ok_or_else(|| {
            AppError::BadRequest("Invalid invoke calldata: calls_len overflow".to_string())
        })?)
        .ok_or_else(|| {
            AppError::BadRequest("Invalid invoke calldata: malformed headers".to_string())
        })?;

    if calldata.len() <= headers_end {
        return Err(AppError::BadRequest(
            "Invalid invoke calldata: missing calldata length".to_string(),
        ));
    }

    let flattened_len = felt_to_usize(&calldata[headers_end], "flattened_len")?;
    let flattened_start = headers_end + 1;
    let flattened_end = flattened_start.checked_add(flattened_len).ok_or_else(|| {
        AppError::BadRequest("Invalid invoke calldata: flattened overflow".to_string())
    })?;

    if flattened_end > calldata.len() {
        return Err(AppError::BadRequest(
            "Invalid invoke calldata: flattened data out of bounds".to_string(),
        ));
    }

    let mut calls = Vec::with_capacity(calls_len);
    for idx in 0..calls_len {
        let offset = header_start + idx * header_width;
        if offset + 3 >= headers_end {
            return Err(AppError::BadRequest(
                "Invalid invoke calldata: header index out of bounds".to_string(),
            ));
        }
        let to = calldata[offset];
        let selector = calldata[offset + 1];
        let data_offset = felt_to_usize(&calldata[offset + 2], "data_offset")?;
        let data_len = felt_to_usize(&calldata[offset + 3], "data_len")?;
        let data_start = flattened_start.checked_add(data_offset).ok_or_else(|| {
            AppError::BadRequest("Invalid invoke calldata: data offset overflow".to_string())
        })?;
        let data_end = data_start.checked_add(data_len).ok_or_else(|| {
            AppError::BadRequest("Invalid invoke calldata: data length overflow".to_string())
        })?;
        if data_end > flattened_end {
            return Err(AppError::BadRequest(
                "Invalid invoke calldata: data out of bounds".to_string(),
            ));
        }

        calls.push(ParsedExecuteCall {
            to,
            selector,
            calldata: calldata[data_start..data_end].to_vec(),
        });
    }

    Ok(calls)
}

// Internal helper that parses or transforms values for `parse_execute_calls_inline`.
fn parse_execute_calls_inline(calldata: &[Felt]) -> Result<Vec<ParsedExecuteCall>> {
    if calldata.is_empty() {
        return Err(AppError::BadRequest(
            "Invalid invoke calldata: empty calldata".to_string(),
        ));
    }

    let calls_len = felt_to_usize(&calldata[0], "calls_len")?;
    let mut calls = Vec::with_capacity(calls_len);
    let mut cursor = 1usize;
    for _ in 0..calls_len {
        let header_end = cursor.checked_add(3).ok_or_else(|| {
            AppError::BadRequest("Invalid invoke calldata: inline header overflow".to_string())
        })?;
        if calldata.len() < header_end {
            return Err(AppError::BadRequest(
                "Invalid invoke calldata: missing inline call header".to_string(),
            ));
        }

        let to = calldata[cursor];
        let selector = calldata[cursor + 1];
        let data_len = felt_to_usize(&calldata[cursor + 2], "data_len")?;
        let data_start = cursor + 3;
        let data_end = data_start.checked_add(data_len).ok_or_else(|| {
            AppError::BadRequest("Invalid invoke calldata: inline data overflow".to_string())
        })?;
        if data_end > calldata.len() {
            return Err(AppError::BadRequest(
                "Invalid invoke calldata: inline data out of bounds".to_string(),
            ));
        }

        calls.push(ParsedExecuteCall {
            to,
            selector,
            calldata: calldata[data_start..data_end].to_vec(),
        });
        cursor = data_end;
    }

    Ok(calls)
}

// Internal helper that parses or transforms values for `parse_execute_calls`.
pub fn parse_execute_calls(calldata: &[Felt]) -> Result<Vec<ParsedExecuteCall>> {
    if let Ok(calls) = parse_execute_calls_offset(calldata) {
        return Ok(calls);
    }
    parse_execute_calls_inline(calldata)
}
