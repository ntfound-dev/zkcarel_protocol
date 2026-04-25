use anyhow::{anyhow, Context, Result};
use garaga_rs::calldata::full_proof_with_hints::zk_honk::{
    get_zk_honk_calldata, HonkVerificationKey, ZKHonkProof,
};
use num_bigint::BigUint;
use serde_json::json;
use std::env;
use std::fs;

pub fn normalize_zk_honk_proof_calldata(calldata: Vec<BigUint>) -> Vec<BigUint> {
    if calldata.len() > 1 {
        let declared_size = &calldata[0];
        let expected_size = BigUint::from((calldata.len() - 1) as u64);
        if declared_size == &expected_size {
            return calldata.into_iter().skip(1).collect();
        }
    }
    calldata
}

fn biguint_to_hex(value: &BigUint) -> String {
    format!("0x{}", value.to_str_radix(16))
}

fn bytes_to_hex_words(bytes: &[u8]) -> Result<Vec<String>> {
    if bytes.len() % 32 != 0 {
        return Err(anyhow!(
            "public inputs length {} is not a multiple of 32",
            bytes.len()
        ));
    }
    Ok(bytes
        .chunks(32)
        .map(|chunk| biguint_to_hex(&BigUint::from_bytes_be(chunk)))
        .collect())
}

pub fn run_cli() -> Result<()> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 4 {
        eprintln!("Usage: garaga_honk_calldata <vk_path> <proof_path> <public_inputs_path>");
        std::process::exit(1);
    }

    let vk_bytes = fs::read(&args[1]).with_context(|| format!("read vk {}", args[1]))?;
    let proof_bytes = fs::read(&args[2]).with_context(|| format!("read proof {}", args[2]))?;
    let public_inputs_bytes =
        fs::read(&args[3]).with_context(|| format!("read public_inputs {}", args[3]))?;

    let vk = HonkVerificationKey::from_bytes(&vk_bytes).map_err(|err| anyhow!(err))?;
    let proof = ZKHonkProof::from_bytes(&proof_bytes, &public_inputs_bytes, vk.log_circuit_size)
        .map_err(|err| anyhow!(err))?;
    let calldata = normalize_zk_honk_proof_calldata(
        get_zk_honk_calldata(&proof, &vk).map_err(|err| anyhow!(err))?,
    );

    let proof_hex: Vec<String> = calldata
        .into_iter()
        .map(|item| biguint_to_hex(&item))
        .collect();
    let public_inputs_hex = bytes_to_hex_words(&public_inputs_bytes)?;

    let output = json!({
        "proof": proof_hex,
        "public_inputs": public_inputs_hex,
    });
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::normalize_zk_honk_proof_calldata;
    use num_bigint::BigUint;

    #[test]
    fn strips_leading_honk_size_prefix() {
        let input = vec![
            BigUint::from(3_u64),
            BigUint::from(0x11_u64),
            BigUint::from(0x22_u64),
            BigUint::from(0x33_u64),
        ];
        let normalized = normalize_zk_honk_proof_calldata(input);
        assert_eq!(
            normalized,
            vec![
                BigUint::from(0x11_u64),
                BigUint::from(0x22_u64),
                BigUint::from(0x33_u64),
            ]
        );
    }

    #[test]
    fn preserves_calldata_without_size_prefix() {
        let input = vec![
            BigUint::from(0x11_u64),
            BigUint::from(0x22_u64),
            BigUint::from(0x33_u64),
        ];
        let normalized = normalize_zk_honk_proof_calldata(input.clone());
        assert_eq!(normalized, input);
    }
}
