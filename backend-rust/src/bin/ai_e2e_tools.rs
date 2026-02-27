use serde_json::json;
use starknet_core::types::typed_data::TypedData;
use starknet_core::types::Felt as CoreFelt;
use starknet_crypto::{poseidon_hash_many, Felt as CryptoFelt};
use starknet_signers::SigningKey;
use std::time::{SystemTime, UNIX_EPOCH};

fn encode_bytes_as_felt(chunk: &[u8]) -> Result<CryptoFelt, String> {
    if chunk.is_empty() {
        return Ok(CryptoFelt::from(0_u8));
    }
    let hex = hex::encode(chunk);
    CryptoFelt::from_hex(&format!("0x{hex}")).map_err(|e| format!("invalid byte chunk: {e}"))
}

fn serialize_byte_array(value: &str) -> Result<Vec<CryptoFelt>, String> {
    let bytes = value.as_bytes();
    let mut data = Vec::new();
    let full_words = bytes.len() / 31;
    let pending_len = bytes.len() % 31;

    data.push(CryptoFelt::from(full_words as u64));
    for idx in 0..full_words {
        let start = idx * 31;
        let end = start + 31;
        data.push(encode_bytes_as_felt(&bytes[start..end])?);
    }

    if pending_len > 0 {
        let start = full_words * 31;
        data.push(encode_bytes_as_felt(&bytes[start..])?);
    } else {
        data.push(CryptoFelt::from(0_u8));
    }
    data.push(CryptoFelt::from(pending_len as u64));
    Ok(data)
}

fn parse_crypto_felt(value: &str) -> Result<CryptoFelt, String> {
    let trimmed = value.trim();
    let normalized = if trimmed.starts_with("0x") {
        trimmed.to_string()
    } else {
        format!("0x{trimmed}")
    };
    CryptoFelt::from_hex(&normalized).map_err(|e| format!("invalid felt value: {e}"))
}

fn parse_core_felt(value: &str) -> Result<CoreFelt, String> {
    let trimmed = value.trim();
    let normalized = if trimmed.starts_with("0x") {
        trimmed.to_string()
    } else {
        format!("0x{trimmed}")
    };
    CoreFelt::from_hex(&normalized).map_err(|e| format!("invalid core felt value: {e}"))
}

fn compute_action_hash(
    user_address: &str,
    action_type: u64,
    params: &str,
    nonce: u64,
) -> Result<CryptoFelt, String> {
    let user = parse_crypto_felt(user_address)?;
    let mut data = vec![user, CryptoFelt::from(action_type)];
    data.extend(serialize_byte_array(params)?);
    data.push(CryptoFelt::from(nonce));
    Ok(poseidon_hash_many(&data))
}

fn build_ai_setup_typed_data(
    chain_id: &str,
    user_address: &str,
    level: u8,
    action_type: u64,
    params: &str,
    nonce: u64,
) -> Result<(serde_json::Value, CryptoFelt), String> {
    let action_hash = compute_action_hash(user_address, action_type, params, nonce)?;
    let typed_data = json!({
        "types": {
            "StarkNetDomain": [
                { "name": "name", "type": "felt" },
                { "name": "version", "type": "felt" },
                { "name": "chainId", "type": "felt" }
            ],
            "CarelAISetup": [
                { "name": "purpose", "type": "felt" },
                { "name": "level", "type": "felt" },
                { "name": "actionType", "type": "felt" },
                { "name": "nonce", "type": "felt" },
                { "name": "actionHash", "type": "felt" }
            ]
        },
        "primaryType": "CarelAISetup",
        "domain": {
            "name": "CAREL Protocol",
            "version": "1",
            "chainId": chain_id
        },
        "message": {
            "purpose": "AI_SETUP",
            "level": level,
            "actionType": action_type,
            "nonce": nonce,
            "actionHash": format!("{:#x}", action_hash)
        }
    });
    Ok((typed_data, action_hash))
}

fn typed_data_message_hash(
    typed_data: &serde_json::Value,
    user_address: &str,
) -> Result<CoreFelt, String> {
    let data: TypedData = serde_json::from_value(typed_data.clone())
        .map_err(|e| format!("typed-data parse error: {e}"))?;
    let account = parse_core_felt(user_address)?;
    data.message_hash(account)
        .map_err(|e| format!("typed-data message hash error: {e}"))
}

fn action_type_for_level(level: u8) -> Result<u64, String> {
    match level {
        2 => Ok(0), // Swap
        3 => Ok(5), // MultiStep
        _ => Err("only level 2/3 supported for on-chain setup".to_string()),
    }
}

fn now_millis_u64() -> u64 {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    u64::try_from(ms).unwrap_or(u64::MAX)
}

fn sign_hash(private_key: &str, hash: &str) -> Result<serde_json::Value, String> {
    let sk = parse_core_felt(private_key)?;
    let felt_hash = parse_core_felt(hash)?;
    let signing_key = SigningKey::from_secret_scalar(sk);
    let sig = signing_key
        .sign(&felt_hash)
        .map_err(|e| format!("sign failed: {e}"))?;
    Ok(json!({
        "hash": format!("{:#x}", felt_hash),
        "signature": {
            "r": format!("{:#x}", sig.r),
            "s": format!("{:#x}", sig.s)
        }
    }))
}

fn to_hex_vec(values: &[CryptoFelt]) -> Vec<String> {
    values.iter().map(|v| format!("{:#x}", v)).collect()
}

fn run_prepare_sign(args: &[String]) -> Result<(), String> {
    if args.len() < 7 {
        return Err(
            "usage: ai_e2e_tools prepare-sign <user_address> <private_key> <level> <context> <chain_id> [nonce]"
                .to_string(),
        );
    }
    let user_address = &args[2];
    let private_key = &args[3];
    let level: u8 = args[4].parse().map_err(|e| format!("invalid level: {e}"))?;
    let context = &args[5];
    let chain_id = &args[6];
    let nonce = if args.len() >= 8 {
        args[7]
            .parse::<u64>()
            .map_err(|e| format!("invalid nonce: {e}"))?
    } else {
        now_millis_u64()
    };

    let action_type = action_type_for_level(level)?;
    let (typed_data, action_hash) =
        build_ai_setup_typed_data(chain_id, user_address, level, action_type, context, nonce)?;
    let message_hash = typed_data_message_hash(&typed_data, user_address)?;

    let sig = sign_hash(private_key, &format!("{:#x}", message_hash))?;
    let sig_r = sig["signature"]["r"]
        .as_str()
        .ok_or_else(|| "signature.r missing".to_string())?;
    let sig_s = sig["signature"]["s"]
        .as_str()
        .ok_or_else(|| "signature.s missing".to_string())?;

    let byte_array = serialize_byte_array(context)?;
    let out = json!({
        "user_address": user_address,
        "level": level,
        "action_type": action_type,
        "params": context,
        "params_bytearray_calldata": to_hex_vec(&byte_array),
        "nonce": nonce,
        "chain_id": chain_id,
        "action_hash": format!("{:#x}", action_hash),
        "message_hash": format!("{:#x}", message_hash),
        "typed_data": typed_data,
        "user_signature": {
            "r": sig_r,
            "s": sig_s
        }
    });
    println!(
        "{}",
        serde_json::to_string_pretty(&out).map_err(|e| format!("json encode error: {e}"))?
    );
    Ok(())
}

fn run_sign_hash(args: &[String]) -> Result<(), String> {
    if args.len() < 4 {
        return Err("usage: ai_e2e_tools sign-hash <private_key> <hash>".to_string());
    }
    let out = sign_hash(&args[2], &args[3])?;
    println!(
        "{}",
        serde_json::to_string_pretty(&out).map_err(|e| format!("json encode error: {e}"))?
    );
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: ai_e2e_tools <prepare-sign|sign-hash> ...");
        std::process::exit(1);
    }

    let result = match args[1].as_str() {
        "prepare-sign" => run_prepare_sign(&args),
        "sign-hash" => run_sign_hash(&args),
        other => Err(format!("unknown subcommand: {other}")),
    };

    if let Err(err) = result {
        eprintln!("{err}");
        std::process::exit(1);
    }
}
