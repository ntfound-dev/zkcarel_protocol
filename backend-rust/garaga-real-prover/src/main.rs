use std::{
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};

use anyhow::{bail, Context, Result};
use ark_bls12_381::{Bls12_381, Fr, G1Affine, G2Affine};
use ark_ff::{BigInteger, Field, PrimeField, Zero};
use ark_groth16::{prepare_verifying_key, Groth16, Proof, ProvingKey, VerifyingKey};
use ark_r1cs_std::{alloc::AllocVar, eq::EqGadget, fields::{fp::FpVar, FieldVar}};
use ark_relations::r1cs::{ConstraintSynthesizer, ConstraintSystemRef, SynthesisError};
use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};
use clap::{Parser, Subcommand};
use num_bigint::BigUint;
use rand::{rngs::OsRng, RngCore};
use serde::Serialize;
use sha2::{Digest, Sha256};

const CIRCUIT_TAG: &[u8] = b"zkcare-garaga-bms-v1";
const CIRCUIT_OFFSET: u64 = 7;

#[derive(Debug, Clone)]
struct BindingCircuit {
    pub_input: Option<Fr>,
    witness: Option<Fr>,
}

impl ConstraintSynthesizer<Fr> for BindingCircuit {
    fn generate_constraints(self, cs: ConstraintSystemRef<Fr>) -> Result<(), SynthesisError> {
        let public = FpVar::<Fr>::new_input(cs.clone(), || {
            self.pub_input.ok_or(SynthesisError::AssignmentMissing)
        })?;
        let witness = FpVar::<Fr>::new_witness(cs.clone(), || {
            self.witness.ok_or(SynthesisError::AssignmentMissing)
        })?;
        let offset = FpVar::<Fr>::new_constant(cs, Fr::from(CIRCUIT_OFFSET))?;
        let derived = witness.square()? + offset;
        derived.enforce_equal(&public)?;
        Ok(())
    }
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
        } => run_setup(&pk_out, &vk_out, sample_proof_out.as_deref(), sample_public_inputs_out.as_deref()),
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

    let empty_circuit = BindingCircuit {
        pub_input: None,
        witness: None,
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
    let witness = derive_witness(&context_bytes);
    let public_input = witness.square() + Fr::from(CIRCUIT_OFFSET);

    let circuit = BindingCircuit {
        pub_input: Some(public_input),
        witness: Some(witness),
    };

    let mut rng = OsRng;
    let proof = Groth16::<Bls12_381>::create_random_proof_with_reduction(
        circuit,
        proving_key,
        &mut rng,
    )
    .context("failed to generate Groth16 proof")?;

    // Safety guard: ensure proof validates against the proving key's verification key.
    let pvk = prepare_verifying_key(&proving_key.vk);
    let verified = Groth16::<Bls12_381>::verify_proof(&pvk, &proof, &[public_input])
        .context("failed to verify generated proof")?;
    if !verified {
        bail!("generated proof did not verify");
    }

    let proof_json = proof_to_snarkjs(&proof);
    write_json(proof_out, &proof_json)
        .with_context(|| format!("failed to write proof JSON to {}", proof_out.display()))?;

    let public_inputs = vec![field_to_dec(public_input)];
    write_json(public_inputs_out, &public_inputs).with_context(|| {
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

fn derive_witness(context_bytes: &[u8]) -> Fr {
    let mut nonce = [0_u8; 32];
    OsRng.fill_bytes(&mut nonce);
    let mut hasher = Sha256::new();
    hasher.update(CIRCUIT_TAG);
    hasher.update(context_bytes);
    hasher.update(nonce);
    let digest = hasher.finalize();
    let mut witness = Fr::from_be_bytes_mod_order(&digest);
    if witness.is_zero() {
        witness = Fr::from(1_u64);
    }
    witness
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
    [
        field_to_dec(point.x),
        field_to_dec(point.y),
        "1".to_string(),
    ]
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
