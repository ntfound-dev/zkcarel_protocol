use carel_backend::garaga::auto_prover;

#[tokio::main]
async fn main() {
    if let Err(err) = auto_prover::run_cli().await {
        eprintln!("{err}");
        std::process::exit(1);
    }
}
