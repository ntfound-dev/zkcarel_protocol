use std::{
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, bail};
use ark_bls12_381::{Bls12_381, Fr, G1Affine, G2Affine};
use ark_ff::{BigInteger, PrimeField, Zero};
use ark_groth16::{Groth16, Proof, ProvingKey, VerifyingKey, prepare_verifying_key};
use ark_r1cs_std::{
    alloc::AllocVar,
    eq::EqGadget,
    fields::fp::FpVar,
};
use ark_relations::r1cs::{ConstraintSynthesizer, ConstraintSystemRef, SynthesisError};
use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};
use clap::{Parser, Subcommand};
use num_bigint::BigUint;
use rand::{RngCore, rngs::OsRng};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

const CIRCUIT_TAG: &[u8] = b"zkcare-garaga-note-spend-v3";
const DOMAIN_ROOT: u64 = 101;
const DOMAIN_NULLIFIER: u64 = 202;
const DOMAIN_ACTION: u64 = 303;

#[derive(Debug, Clone)]
struct NoteSpendCircuit {
    root: Option<Fr>,
    nullifier: Option<Fr>,
    action_hash: Option<Fr>,
    recipient: Option<Fr>,

    secret: Option<Fr>,
    nullifier_key: Option<Fr>,
    leaf_index: Option<Fr>,
    action_seed: Option<Fr>,
    recipient_witness: Option<Fr>,
}

impl ConstraintSynthesizer<Fr> for NoteSpendCircuit {
    fn generate_constraints(self, cs: ConstraintSystemRef<Fr>) -> Result<(), SynthesisError> {
        let root_pub = FpVar::<Fr>::new_input(cs.clone(), || {
            self.root.ok_or(SynthesisError::AssignmentMissing)
        })?;
        let nullifier_pub = FpVar::<Fr>::new_input(cs.clone(), || {
            self.nullifier.ok_or(SynthesisError::AssignmentMissing)
        })?;
        let action_hash_pub = FpVar::<Fr>::new_input(cs.clone(), || {
            self.action_hash.ok_or(SynthesisError::AssignmentMissing)
        })?;
        let recipient_pub = FpVar::<Fr>::new_input(cs.clone(), || {
            self.recipient.ok_or(SynthesisError::AssignmentMissing)
        })?;

        let secret_wit = FpVar::<Fr>::new_witness(cs.clone(), || {
            self.secret.ok_or(SynthesisError::AssignmentMissing)
        })?;
        let nullifier_key_wit = FpVar::<Fr>::new_witness(cs.clone(), || {
            self.nullifier_key.ok_or(SynthesisError::AssignmentMissing)
        })?;
        let leaf_index_wit = FpVar::<Fr>::new_witness(cs.clone(), || {
            self.leaf_index.ok_or(SynthesisError::AssignmentMissing)
        })?;
        let action_seed_wit = FpVar::<Fr>::new_witness(cs.clone(), || {
            self.action_seed.ok_or(SynthesisError::AssignmentMissing)
        })?;
        let recipient_wit = FpVar::<Fr>::new_witness(cs, || {
            self.recipient_witness.ok_or(SynthesisError::AssignmentMissing)
        })?;

        let domain_root = FpVar::<Fr>::new_constant(ConstraintSystemRef::None, Fr::from(DOMAIN_ROOT))?;
        let domain_nullifier =
            FpVar::<Fr>::new_constant(ConstraintSystemRef::None, Fr::from(DOMAIN_NULLIFIER))?;
        let domain_action =
            FpVar::<Fr>::new_constant(ConstraintSystemRef::None, Fr::from(DOMAIN_ACTION))?;

        recipient_wit.enforce_equal(&recipient_pub)?;

        let computed_root =
            secret_wit + nullifier_key_wit.clone() + recipient_wit.clone() + leaf_index_wit.clone() + domain_root;
        computed_root.enforce_equal(&root_pub)?;

        let computed_nullifier = nullifier_key_wit + leaf_index_wit.clone() + domain_nullifier;
        computed_nullifier.enforce_equal(&nullifier_pub)?;

        let computed_action = action_seed_wit + leaf_index_wit + recipient_wit + domain_action;
        computed_action.enforce_equal(&action_hash_pub)?;

        Ok(())
    }
}

#[derive(Debug)]
struct DerivedStatement {
    root: Fr,
    nullifier: Fr,
    action_hash: Fr,
    recipient: Fr,
    secret: Fr,
    nullifier_key: Fr,
    leaf_index: Fr,
    action_seed: Fr,
}

#[derive(Debug, Parser)]
#[command(name = "garaga-real-prover")]
#[command(about = "Local real prover for zkcare Garaga pipeline (Groth16 BLS12-381)")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Generate proving key + verification key JSON.
    Setup {
        /// Output path for proving key binary.
        #[arg(long)]
        pk_out: PathBuf,
        /// Output path for Garaga-compatible verification key JSON.
        #[arg(long)]
        vk_out: PathBuf,
        /// Optional sample proof output path.
        #[arg(long)]
        sample_proof_out: Option<PathBuf>,
        /// Optional sample public inputs output path.
        #[arg(long)]
        sample_public_inputs_out: Option<PathBuf>,
    },
    /// Generate fresh proof/public-input files for one request context.
    Prove {
        /// Input proving key binary path.
        #[arg(long)]
        pk: PathBuf,
        /// Output proof JSON path.
        #[arg(long)]
        proof_out: PathBuf,
        /// Output public inputs JSON path.
        #[arg(long)]
        public_inputs_out: PathBuf,
        /// Optional request context file path (JSON).
        #[arg(long)]
        context: Option<PathBuf>,
    },
}

#[derive(Debug, Serialize)]
struct SnarkJsVk {
    protocol: &'static str,
    curve: &'static str,
    #[serde(rename = "nPublic")]
    n_public: usize,
    #[serde(rename = "vk_alpha_1")]
    vk_alpha_1: [String; 3],
    #[serde(rename = "vk_beta_2")]
    vk_beta_2: [[String; 2]; 3],
    #[serde(rename = "vk_gamma_2")]
    vk_gamma_2: [[String; 2]; 3],
    #[serde(rename = "vk_delta_2")]
    vk_delta_2: [[String; 2]; 3],
    #[serde(rename = "IC")]
    ic: Vec<[String; 3]>,
}

#[derive(Debug, Serialize)]
struct SnarkJsProofBody {
    #[serde(rename = "pi_a")]
    pi_a: [String; 3],
    #[serde(rename = "pi_b")]
    pi_b: [[String; 2]; 3],
    #[serde(rename = "pi_c")]
    pi_c: [String; 3],
}

#[derive(Debug, Serialize)]
struct SnarkJsProofEnvelope {
    curve: &'static str,
    proof: SnarkJsProofBody,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Setup {
            pk_out,
            vk_out,
            sample_proof_out,
            sample_public_inputs_out,
        } => run_setup(
            &pk_out,
            &vk_out,
            sample_proof_out.as_deref(),
            sample_public_inputs_out.as_deref(),
        ),
        Command::Prove {
            pk,
            proof_out,
            public_inputs_out,
            context,
        } => run_prove(&pk, &proof_out, &public_inputs_out, context.as_deref()),
    }
}

fn run_setup(
    pk_out: &Path,
    vk_out: &Path,
    sample_proof_out: Option<&Path>,
    sample_public_inputs_out: Option<&Path>,
) -> Result<()> {
    ensure_parent(pk_out)?;
    ensure_parent(vk_out)?;

    let empty_circuit = NoteSpendCircuit {
        root: None,
        nullifier: None,
        action_hash: None,
        recipient: None,
        secret: None,
        nullifier_key: None,
        leaf_index: None,
        action_seed: None,
        recipient_witness: None,
    };
    let mut rng = OsRng;
    let proving_key = Groth16::<Bls12_381>::generate_random_parameters_with_reduction(
        empty_circuit,
        &mut rng,
    )
    .context("failed to generate Groth16 parameters")?;

    let mut pk_file = File::create(pk_out)
        .with_context(|| format!("failed to create proving key file {}", pk_out.display()))?;
    proving_key
        .serialize_uncompressed(&mut pk_file)
        .context("failed to serialize proving key")?;

    let vk_json = vk_to_snarkjs(&proving_key.vk);
    write_json(vk_out, &vk_json).with_context(|| {
        format!(
            "failed to write Garaga-compatible VK JSON to {}",
            vk_out.display()
        )
    })?;

    if let (Some(proof_out), Some(public_out)) = (sample_proof_out, sample_public_inputs_out) {
        run_prove_with_key(&proving_key, proof_out, public_out, None)?;
    }

    println!("setup complete");
    println!("pk: {}", pk_out.display());
    println!("vk: {}", vk_out.display());
    Ok(())
}

fn run_prove(
    pk_path: &Path,
    proof_out: &Path,
    public_inputs_out: &Path,
    context_path: Option<&Path>,
) -> Result<()> {
    let mut pk_file = File::open(pk_path)
        .with_context(|| format!("failed to open proving key file {}", pk_path.display()))?;
    let proving_key = ProvingKey::<Bls12_381>::deserialize_uncompressed(&mut pk_file)
        .with_context(|| format!("failed to deserialize proving key {}", pk_path.display()))?;

    run_prove_with_key(&proving_key, proof_out, public_inputs_out, context_path)
}

fn run_prove_with_key(
    proving_key: &ProvingKey<Bls12_381>,
    proof_out: &Path,
    public_inputs_out: &Path,
    context_path: Option<&Path>,
) -> Result<()> {
    ensure_parent(proof_out)?;
    ensure_parent(public_inputs_out)?;

    let context_bytes = read_context_bytes(context_path)?;
    let statement = derive_statement(&context_bytes);

    let circuit = NoteSpendCircuit {
        root: Some(statement.root),
        nullifier: Some(statement.nullifier),
        action_hash: Some(statement.action_hash),
        recipient: Some(statement.recipient),
        secret: Some(statement.secret),
        nullifier_key: Some(statement.nullifier_key),
        leaf_index: Some(statement.leaf_index),
        action_seed: Some(statement.action_seed),
        recipient_witness: Some(statement.recipient),
    };

    let mut rng = OsRng;
    let proof = Groth16::<Bls12_381>::create_random_proof_with_reduction(circuit, proving_key, &mut rng)
        .context("failed to generate Groth16 proof")?;

    // Safety guard: ensure proof validates against the proving key's verification key.
    let pvk = prepare_verifying_key(&proving_key.vk);
    let public_inputs = vec![
        statement.root,
        statement.nullifier,
        statement.action_hash,
        statement.recipient,
    ];
    let verified = Groth16::<Bls12_381>::verify_proof(&pvk, &proof, &public_inputs)
        .context("failed to verify generated proof")?;
    if !verified {
        bail!("generated proof did not verify");
    }

    let proof_json = proof_to_snarkjs(&proof);
    write_json(proof_out, &proof_json)
        .with_context(|| format!("failed to write proof JSON to {}", proof_out.display()))?;

    let public_inputs_json = vec![
        field_to_dec(statement.root),
        field_to_dec(statement.nullifier),
        field_to_dec(statement.action_hash),
        field_to_dec(statement.recipient),
    ];
    write_json(public_inputs_out, &public_inputs_json).with_context(|| {
        format!(
            "failed to write public inputs JSON to {}",
            public_inputs_out.display()
        )
    })?;

    Ok(())
}

fn read_context_bytes(context_path: Option<&Path>) -> Result<Vec<u8>> {
    if let Some(path) = context_path {
        if path.exists() {
            let mut file = File::open(path)
                .with_context(|| format!("failed to open context file {}", path.display()))?;
            let mut data = Vec::new();
            file.read_to_end(&mut data)
                .with_context(|| format!("failed to read context file {}", path.display()))?;
            return Ok(data);
        }
    }
    Ok(Vec::new())
}

fn derive_statement(context_bytes: &[u8]) -> DerivedStatement {
    let parsed = parse_context_json(context_bytes);
    let tx_context = parsed.get("tx_context").unwrap_or(&Value::Null);

    let user_address = text_field(&parsed, &["user_address"]).unwrap_or_default();
    let recipient_raw = text_field(tx_context, &["recipient", "receive_address"])
        .filter(|value| !value.is_empty())
        .unwrap_or(user_address.clone());

    let recipient = non_zero(
        parse_felt_like(&recipient_raw)
            .unwrap_or_else(|| hash_to_fr(&[b"recipient", recipient_raw.as_bytes(), context_bytes])),
        17,
    );
    let leaf_index = non_zero(
        text_field(tx_context, &["leaf_index", "index"])
            .and_then(|raw| parse_felt_like(&raw))
            .unwrap_or_else(|| hash_to_fr(&[b"leaf_index", context_bytes])),
        19,
    );

    let mut nonce = [0_u8; 32];
    OsRng.fill_bytes(&mut nonce);
    let mut secret = non_zero(hash_to_fr(&[CIRCUIT_TAG, b"secret", context_bytes, &nonce]), 23);
    let mut nullifier_key =
        non_zero(hash_to_fr(&[CIRCUIT_TAG, b"nullifier_key", context_bytes, &nonce]), 29);

    let action_material = format!(
        "{}|{}|{}|{}|{}|{}",
        text_field(tx_context, &["target", "action_target"]).unwrap_or_default(),
        text_field(tx_context, &["selector", "action_selector"]).unwrap_or_default(),
        text_field(tx_context, &["calldata_hash"]).unwrap_or_default(),
        text_field(tx_context, &["approval_token"]).unwrap_or_default(),
        text_field(tx_context, &["payout_token"]).unwrap_or_default(),
        text_field(tx_context, &["min_payout"]).unwrap_or_default(),
    );
    let mut action_seed =
        non_zero(hash_to_fr(&[CIRCUIT_TAG, b"action_seed", action_material.as_bytes(), context_bytes]), 31);
    // Allow deterministic public-input overrides from backend tx_context:
    // - root: keeps spend proof anchored to an on-chain known root
    // - intent_hash/action_hash: binds proof output to relayer preview hash
    // - nullifier: keeps compatibility with precomputed note nullifier flows
    let root_override = text_field(tx_context, &["root"]).and_then(|raw| parse_felt_like(&raw));
    let action_hash_override = text_field(tx_context, &["intent_hash", "action_hash"])
        .and_then(|raw| parse_felt_like(&raw));
    let nullifier_override =
        text_field(tx_context, &["nullifier"]).and_then(|raw| parse_felt_like(&raw));

    if let Some(override_nullifier) = nullifier_override {
        nullifier_key = override_nullifier - leaf_index - Fr::from(DOMAIN_NULLIFIER);
    }
    let nullifier = nullifier_key + leaf_index + Fr::from(DOMAIN_NULLIFIER);

    if let Some(override_action_hash) = action_hash_override {
        action_seed = override_action_hash - leaf_index - recipient - Fr::from(DOMAIN_ACTION);
    }
    let action_hash = action_seed + leaf_index + recipient + Fr::from(DOMAIN_ACTION);

    if let Some(override_root) = root_override {
        secret = override_root - nullifier_key - recipient - leaf_index - Fr::from(DOMAIN_ROOT);
    }
    let root = secret + nullifier_key + recipient + leaf_index + Fr::from(DOMAIN_ROOT);

    DerivedStatement {
        root,
        nullifier,
        action_hash,
        recipient,
        secret,
        nullifier_key,
        leaf_index,
        action_seed,
    }
}

fn parse_context_json(context_bytes: &[u8]) -> Value {
    if context_bytes.is_empty() {
        return Value::Null;
    }
    serde_json::from_slice(context_bytes).unwrap_or(Value::Null)
}

fn text_field(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(raw) = value.get(*key) {
            match raw {
                Value::String(text) => {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
                Value::Number(num) => {
                    return Some(num.to_string());
                }
                _ => {}
            }
        }
    }
    None
}

fn parse_felt_like(raw: &str) -> Option<Fr> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let parsed = if let Some(hex) = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
    {
        BigUint::parse_bytes(hex.as_bytes(), 16)
    } else {
        BigUint::parse_bytes(trimmed.as_bytes(), 10)
    }?;
    Some(Fr::from_be_bytes_mod_order(&parsed.to_bytes_be()))
}

fn hash_to_fr(parts: &[&[u8]]) -> Fr {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part);
    }
    let digest = hasher.finalize();
    Fr::from_be_bytes_mod_order(&digest)
}

fn non_zero(value: Fr, fallback: u64) -> Fr {
    if value.is_zero() {
        Fr::from(fallback)
    } else {
        value
    }
}

fn vk_to_snarkjs(vk: &VerifyingKey<Bls12_381>) -> SnarkJsVk {
    SnarkJsVk {
        protocol: "groth16",
        curve: "bls12381",
        n_public: vk.gamma_abc_g1.len().saturating_sub(1),
        vk_alpha_1: g1_affine_to_snarkjs(&vk.alpha_g1),
        vk_beta_2: g2_affine_to_snarkjs(&vk.beta_g2),
        vk_gamma_2: g2_affine_to_snarkjs(&vk.gamma_g2),
        vk_delta_2: g2_affine_to_snarkjs(&vk.delta_g2),
        ic: vk.gamma_abc_g1.iter().map(g1_affine_to_snarkjs).collect(),
    }
}

fn proof_to_snarkjs(proof: &Proof<Bls12_381>) -> SnarkJsProofEnvelope {
    SnarkJsProofEnvelope {
        curve: "bls12381",
        proof: SnarkJsProofBody {
            pi_a: g1_affine_to_snarkjs(&proof.a),
            pi_b: g2_affine_to_snarkjs(&proof.b),
            pi_c: g1_affine_to_snarkjs(&proof.c),
        },
    }
}

fn g1_affine_to_snarkjs(point: &G1Affine) -> [String; 3] {
    [field_to_dec(point.x), field_to_dec(point.y), "1".to_string()]
}

fn g2_affine_to_snarkjs(point: &G2Affine) -> [[String; 2]; 3] {
    [
        [field_to_dec(point.x.c0), field_to_dec(point.x.c1)],
        [field_to_dec(point.y.c0), field_to_dec(point.y.c1)],
        ["1".to_string(), "0".to_string()],
    ]
}

fn field_to_dec<F: PrimeField>(value: F) -> String {
    let bytes = value.into_bigint().to_bytes_be();
    let big = BigUint::from_bytes_be(&bytes);
    big.to_str_radix(10)
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let file = File::create(path)
        .with_context(|| format!("failed to create JSON file {}", path.display()))?;
    serde_json::to_writer_pretty(file, value)
        .with_context(|| format!("failed to serialize JSON to {}", path.display()))?;
    Ok(())
}

fn ensure_parent(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create parent directory {}", parent.display()))?;
    }
    Ok(())
}
