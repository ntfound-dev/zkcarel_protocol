use carel_backend::garaga::honk_calldata;

fn main() {
    if let Err(err) = honk_calldata::run_cli() {
        eprintln!("{err}");
        std::process::exit(1);
    }
}
