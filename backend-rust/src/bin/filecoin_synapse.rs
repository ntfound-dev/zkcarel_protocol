use std::{
    env,
    io::{self, Read, Write},
    path::PathBuf,
    process::{Command, Stdio},
};

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let mode = args.next().unwrap_or_default();
    if mode != "upload" && mode != "download" {
        return Err("Usage: filecoin_synapse upload|download [cid]".to_string());
    }
    let cid = args.next();
    if mode == "download" && cid.as_deref().unwrap_or("").trim().is_empty() {
        return Err("Missing CID argument for download".to_string());
    }

    let script = resolve_script_path()?;
    let node_bin = env::var("SYNAPSE_NODE_BIN").unwrap_or_else(|_| "node".to_string());

    let mut command = Command::new(node_bin);
    command.arg(script).arg(&mode);
    if let Some(cid) = cid {
        command.arg(cid);
    }

    forward_env(&mut command, "SYNAPSE_PRIVATE_KEY");
    forward_env(&mut command, "SYNAPSE_RPC_URL");
    forward_env(&mut command, "SYNAPSE_WITH_CDN");
    forward_env(&mut command, "SYNAPSE_SOURCE");
    forward_env(&mut command, "SYNAPSE_MAX_STDIN_BYTES");

    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|err| format!("Failed to start node: {err}"))?;

    if mode == "upload" {
        let mut input = Vec::new();
        io::stdin()
            .read_to_end(&mut input)
            .map_err(|err| format!("Failed to read stdin: {err}"))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(&input)
                .map_err(|err| format!("Failed to write payload to stdin: {err}"))?;
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|err| format!("filecoin_synapse failed: {err}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(stderr.trim().to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    print!("{stdout}");
    Ok(())
}

fn resolve_script_path() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok(value) = env::var("SYNAPSE_NODE_SCRIPT") {
        if !value.trim().is_empty() {
            candidates.push(PathBuf::from(value.trim()));
        }
    }
    if let Ok(value) = env::var("FILECOIN_SYNAPSE_SCRIPT") {
        if !value.trim().is_empty() {
            candidates.push(PathBuf::from(value.trim()));
        }
    }
    candidates.push(PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/scripts/filecoin_synapse.mjs"
    )));
    candidates.push(PathBuf::from("backend-rust/scripts/filecoin_synapse.mjs"));
    candidates.push(PathBuf::from("scripts/filecoin_synapse.mjs"));
    candidates.push(PathBuf::from("/app/scripts/filecoin_synapse.mjs"));

    let script = candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| "filecoin_synapse.mjs not found (set SYNAPSE_NODE_SCRIPT)".to_string())?;
    Ok(script)
}

fn forward_env(command: &mut Command, key: &str) {
    if let Ok(value) = env::var(key) {
        if !value.trim().is_empty() {
            command.env(key, value);
        }
    }
}
