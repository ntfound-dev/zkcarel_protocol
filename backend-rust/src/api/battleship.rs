use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use chrono::Utc;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use starknet_core::types::{
    ContractClass, ExecutionResult, Felt, FunctionCall, InvokeTransaction,
    Transaction as StarknetTransaction, TransactionReceiptWithBlockInfo,
};
use starknet_core::utils::get_selector_from_name;
use starknet_crypto::poseidon_hash_many;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::OnceLock;
use tokio::sync::RwLock;
use tokio::time::{sleep, Duration};

use crate::{
    constants::{
        POINTS_BATTLE_HIT, POINTS_BATTLE_LOSS, POINTS_BATTLE_MISS, POINTS_BATTLE_TIMEOUT_WIN,
        POINTS_BATTLE_WIN,
    },
    crypto::hash,
    error::{AppError, Result},
    models::{ApiResponse, StarknetWalletCall, Transaction},
    services::{
        onchain::{felt_to_u128, parse_felt, OnchainReader},
        privacy_verifier::parse_privacy_verifier_kind,
    },
};

use super::{
    onchain_privacy::normalize_onchain_tx_hash,
    privacy::{generate_auto_garaga_payload, AutoPrivacyPayloadResponse, AutoPrivacyTxContext},
    require_starknet_user, AppState,
};

const BOARD_SIZE: usize = 5;
const TOTAL_SHIP_CELLS: usize = 9;
const TURN_TIMEOUT_SECS: i64 = 600; // UX fallback timer (on-chain timeout is block-based)
const EXPECTED_FLEET: [usize; 5] = [1, 1, 2, 2, 3];

const TX_BATTLE_HIT: &str = "battle_hit";
const TX_BATTLE_MISS: &str = "battle_miss";
const TX_BATTLE_WIN: &str = "battle_win";
const TX_BATTLE_LOSS: &str = "battle_loss";
const TX_BATTLE_TIMEOUT_WIN: &str = "battle_tmo_win";

const STATUS_PLAYING: u64 = 1;
const STATUS_FINISHED: u64 = 2;
const BATTLESHIP_ABI_CACHE_TTL_SECS: i64 = 300;
const REQUIRED_BATTLESHIP_ENTRYPOINTS: [&str; 7] = [
    "create_game",
    "join_game",
    "fire_shot",
    "respond_shot",
    "claim_timeout",
    "get_game_state",
    "get_pending_shot",
];

#[derive(Debug, Deserialize, Clone)]
pub struct GaragaPayloadInput {
    pub verifier: Option<String>,
    pub nullifier: Option<String>,
    pub commitment: Option<String>,
    pub proof: Option<Vec<String>>,
    pub public_inputs: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub struct Cell {
    pub x: u8,
    pub y: u8,
}

#[derive(Debug, Deserialize)]
pub struct CreateGameRequest {
    pub opponent: String,
    pub cells: Vec<Cell>,
    pub privacy: Option<GaragaPayloadInput>,
    pub onchain_tx_hash: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct JoinGameRequest {
    pub game_id: String,
    pub cells: Vec<Cell>,
    pub privacy: Option<GaragaPayloadInput>,
    pub onchain_tx_hash: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PlaceShipsRequest {
    pub game_id: String,
    pub cells: Vec<Cell>,
    pub privacy: Option<GaragaPayloadInput>,
    pub onchain_tx_hash: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct FireShotRequest {
    pub game_id: String,
    pub x: u8,
    pub y: u8,
    pub privacy: Option<GaragaPayloadInput>,
    pub onchain_tx_hash: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RespondShotRequest {
    pub game_id: String,
    pub defend_x: u8,
    pub defend_y: u8,
    pub privacy: Option<GaragaPayloadInput>,
    pub onchain_tx_hash: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ClaimTimeoutRequest {
    pub game_id: String,
    pub onchain_tx_hash: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ShotRecord {
    pub shooter: String,
    pub x: u8,
    pub y: u8,
    pub is_hit: bool,
    pub timestamp: i64,
    pub tx_hash: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct PendingShotView {
    pub shooter: String,
    pub x: u8,
    pub y: u8,
}

#[derive(Debug, Serialize)]
pub struct BattleshipGameStateResponse {
    pub game_id: String,
    pub status: String,
    pub creator: String,
    pub player_a: String,
    pub player_b: Option<String>,
    pub current_turn: Option<String>,
    pub winner: Option<String>,
    pub your_address: String,
    pub your_ready: bool,
    pub opponent_ready: bool,
    pub your_hits_taken: u8,
    pub opponent_hits_taken: u8,
    pub your_board: Vec<Cell>,
    pub your_shots: Vec<Cell>,
    pub opponent_shots: Vec<Cell>,
    pub shot_history: Vec<ShotRecord>,
    pub timeout_in_seconds: Option<i64>,
    pub pending_shot: Option<PendingShotView>,
    pub can_respond: bool,
}

#[derive(Debug, Serialize)]
pub struct GameActionResponse {
    pub game_id: String,
    pub status: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub onchain_calls: Option<Vec<StarknetWalletCall>>,
    #[serde(default)]
    pub requires_wallet_signature: bool,
}

#[derive(Debug, Serialize)]
pub struct FireShotResponse {
    pub game_id: String,
    pub status: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_hit: Option<bool>,
    pub pending_response: bool,
    pub next_turn: Option<String>,
    pub winner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub onchain_calls: Option<Vec<StarknetWalletCall>>,
    #[serde(default)]
    pub requires_wallet_signature: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GameStatus {
    Waiting,
    Playing,
    Finished,
}

impl GameStatus {
    // Internal helper that supports `as_str` operations.
    fn as_str(self) -> &'static str {
        match self {
            Self::Waiting => "WAITING",
            Self::Playing => "PLAYING",
            Self::Finished => "FINISHED",
        }
    }

    // Internal helper that supports `from_u64` operations.
    fn from_u64(value: u64) -> Self {
        match value {
            STATUS_PLAYING => Self::Playing,
            STATUS_FINISHED => Self::Finished,
            _ => Self::Waiting,
        }
    }
}

#[derive(Debug, Clone)]
struct PlayerBoard {
    cells: HashSet<(u8, u8)>,
}

#[derive(Debug, Clone)]
struct PendingShot {
    shooter: String,
    x: u8,
    y: u8,
}

#[derive(Debug, Clone)]
struct BattleshipGame {
    game_id: u64,
    creator: String,
    player_a: String,
    player_b: String,
    status: GameStatus,
    current_turn: Option<String>,
    winner: Option<String>,
    board_a: Option<PlayerBoard>,
    board_b: Option<PlayerBoard>,
    shots_a: HashSet<(u8, u8)>,
    shots_b: HashSet<(u8, u8)>,
    hits_on_a: u8,
    hits_on_b: u8,
    pending_shot: Option<PendingShot>,
    shot_history: Vec<ShotRecord>,
    last_action_at: i64,
}

#[derive(Default)]
struct BattleshipStore {
    games: HashMap<u64, BattleshipGame>,
}

#[derive(Debug, Clone)]
struct ParsedExecuteCall {
    to: Felt,
    selector: Felt,
    calldata: Vec<Felt>,
}

#[derive(Debug, Clone)]
struct OnchainGameState {
    status: GameStatus,
    player_a: String,
    player_b: String,
    turn: Option<String>,
    winner: Option<String>,
    hits_on_a: u8,
    hits_on_b: u8,
    pending: Option<PendingShot>,
}

static BATTLESHIP_STORE: OnceLock<RwLock<BattleshipStore>> = OnceLock::new();
static BATTLESHIP_ABI_CACHE: OnceLock<RwLock<HashMap<String, i64>>> = OnceLock::new();

// Internal helper that supports `battleship_store` operations.
fn battleship_store() -> &'static RwLock<BattleshipStore> {
    BATTLESHIP_STORE.get_or_init(|| RwLock::new(BattleshipStore::default()))
}

// Internal helper that supports `battleship_abi_cache` operations.
fn battleship_abi_cache() -> &'static RwLock<HashMap<String, i64>> {
    BATTLESHIP_ABI_CACHE.get_or_init(|| RwLock::new(HashMap::new()))
}

// Internal helper that supports `now_unix` operations.
fn now_unix() -> i64 {
    chrono::Utc::now().timestamp()
}

// Internal helper that parses or transforms values for `normalize_hex_items`.
fn normalize_hex_items(items: &[String]) -> Vec<String> {
    items
        .iter()
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

// Internal helper that checks conditions for `is_dummy_payload`.
fn is_dummy_payload(payload: &AutoPrivacyPayloadResponse) -> bool {
    payload.proof.len() == 1
        && payload.public_inputs.len() == 1
        && payload.proof[0].eq_ignore_ascii_case("0x1")
        && payload.public_inputs[0].eq_ignore_ascii_case("0x1")
}

// Internal helper that parses or transforms values for `parse_game_id`.
fn parse_game_id(raw: &str) -> Result<u64> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest("game_id is required".to_string()));
    }
    if let Some(hex) = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
    {
        return u64::from_str_radix(hex, 16)
            .map_err(|_| AppError::BadRequest("Invalid game_id".to_string()));
    }
    trimmed
        .parse::<u64>()
        .map_err(|_| AppError::BadRequest("Invalid game_id".to_string()))
}

// Internal helper that supports `game_id_string` operations.
fn game_id_string(game_id: u64) -> String {
    game_id.to_string()
}

// Internal helper that supports `to_cells` operations.
fn to_cells(points: &HashSet<(u8, u8)>) -> Vec<Cell> {
    let mut out = points
        .iter()
        .map(|(x, y)| Cell { x: *x, y: *y })
        .collect::<Vec<_>>();
    out.sort_by_key(|c| (c.y, c.x));
    out
}

// Internal helper that supports `cell_key` operations.
fn cell_key(x: u8, y: u8) -> (u8, u8) {
    (x, y)
}

// Internal helper that supports `felt_to_u64` operations.
fn felt_to_u64(value: &Felt, field: &str) -> Result<u64> {
    let raw = felt_to_u128(value).map_err(|_| {
        AppError::BadRequest(format!(
            "Invalid felt numeric value for {} in on-chain response",
            field
        ))
    })?;
    u64::try_from(raw).map_err(|_| {
        AppError::BadRequest(format!(
            "On-chain value out of range for {} (expected u64)",
            field
        ))
    })
}

// Internal helper that supports `felt_to_u8` operations.
fn felt_to_u8(value: &Felt, field: &str) -> Result<u8> {
    let raw = felt_to_u128(value).map_err(|_| {
        AppError::BadRequest(format!(
            "Invalid felt numeric value for {} in on-chain response",
            field
        ))
    })?;
    u8::try_from(raw).map_err(|_| {
        AppError::BadRequest(format!(
            "On-chain value out of range for {} (expected u8)",
            field
        ))
    })
}

// Internal helper that supports `addr_eq` operations.
fn addr_eq(a: &str, b: &str) -> bool {
    let a_trimmed = a.trim();
    let b_trimmed = b.trim();
    if a_trimmed.eq_ignore_ascii_case(b_trimmed) {
        return true;
    }

    match (parse_felt(a_trimmed), parse_felt(b_trimmed)) {
        (Ok(a_felt), Ok(b_felt)) => a_felt == b_felt,
        _ => false,
    }
}

// Internal helper that supports `map_status_label` operations.
fn map_status_label(status: GameStatus) -> String {
    status.as_str().to_string()
}

// Internal helper that supports `external_selectors_from_class` operations.
fn external_selectors_from_class(class: &ContractClass) -> HashSet<Felt> {
    match class {
        ContractClass::Sierra(sierra) => sierra
            .entry_points_by_type
            .external
            .iter()
            .map(|entry| entry.selector)
            .collect(),
        ContractClass::Legacy(legacy) => legacy
            .entry_points_by_type
            .external
            .iter()
            .map(|entry| entry.selector)
            .collect(),
    }
}

// Internal helper that supports `ensure_battleship_contract_abi` operations.
async fn ensure_battleship_contract_abi(state: &AppState, contract: Felt) -> Result<()> {
    let cache_key = contract.to_string();
    let now = now_unix();
    {
        let cache = battleship_abi_cache().read().await;
        if let Some(last_checked) = cache.get(&cache_key) {
            if now - *last_checked <= BATTLESHIP_ABI_CACHE_TTL_SECS {
                return Ok(());
            }
        }
    }

    let reader = OnchainReader::from_config(&state.config)?;
    let class = reader.get_class_at(contract).await?;
    let class_hash = reader
        .get_class_hash_at(contract)
        .await
        .map(|value| value.to_string())
        .unwrap_or_else(|_| "unknown".to_string());

    let available = external_selectors_from_class(&class);
    let mut missing: Vec<&str> = Vec::new();
    for name in REQUIRED_BATTLESHIP_ENTRYPOINTS {
        let selector = parse_selector(name)?;
        if !available.contains(&selector) {
            missing.push(name);
        }
    }

    if !missing.is_empty() {
        return Err(AppError::BadRequest(format!(
            "Configured BATTLESHIP_GARAGA_ADDRESS ({}) class {} is missing entrypoints: {}. Update contract address/class and restart backend.",
            cache_key,
            class_hash,
            missing.join(", ")
        )));
    }

    let mut cache = battleship_abi_cache().write().await;
    cache.insert(cache_key, now);
    Ok(())
}

// Internal helper that supports `timeout_remaining` operations.
fn timeout_remaining(last_action_at: i64) -> i64 {
    let elapsed = now_unix() - last_action_at;
    (TURN_TIMEOUT_SECS - elapsed).max(0)
}

// Internal helper that supports `prepared_action_response` operations.
fn prepared_action_response(
    game_id: String,
    message: &str,
    calls: Vec<StarknetWalletCall>,
) -> GameActionResponse {
    GameActionResponse {
        game_id,
        status: "PREPARED".to_string(),
        message: message.to_string(),
        tx_hash: None,
        onchain_calls: Some(calls),
        requires_wallet_signature: true,
    }
}

// Internal helper that supports `prepared_fire_response` operations.
fn prepared_fire_response(
    game_id: String,
    message: &str,
    calls: Vec<StarknetWalletCall>,
) -> FireShotResponse {
    FireShotResponse {
        game_id,
        status: "PREPARED".to_string(),
        message: message.to_string(),
        is_hit: None,
        pending_response: true,
        next_turn: None,
        winner: None,
        tx_hash: None,
        onchain_calls: Some(calls),
        requires_wallet_signature: true,
    }
}

// Internal helper that supports `verify_bounds` operations.
fn verify_bounds(x: u8, y: u8) -> Result<()> {
    if (x as usize) >= BOARD_SIZE || (y as usize) >= BOARD_SIZE {
        return Err(AppError::BadRequest(format!(
            "Cell out of bounds: ({}, {})",
            x, y
        )));
    }
    Ok(())
}

// Internal helper that supports `validate_cells_in_bounds` operations.
fn validate_cells_in_bounds(cells: &[Cell]) -> Result<()> {
    for cell in cells {
        verify_bounds(cell.x, cell.y)?;
    }
    Ok(())
}

// Internal helper that supports `neighbors` operations.
fn neighbors(x: u8, y: u8) -> [(u8, u8); 4] {
    [
        (x.saturating_sub(1), y),
        (x.saturating_add(1), y),
        (x, y.saturating_sub(1)),
        (x, y.saturating_add(1)),
    ]
}

// Internal helper that supports `validate_fleet` operations.
fn validate_fleet(cells: &[Cell]) -> Result<HashSet<(u8, u8)>> {
    if cells.len() != TOTAL_SHIP_CELLS {
        return Err(AppError::BadRequest(format!(
            "Fleet must contain exactly {} cells",
            TOTAL_SHIP_CELLS
        )));
    }
    validate_cells_in_bounds(cells)?;

    let mut set = HashSet::new();
    for cell in cells {
        if !set.insert((cell.x, cell.y)) {
            return Err(AppError::BadRequest(
                "Duplicate ship cell is not allowed".to_string(),
            ));
        }
    }

    let mut visited = HashSet::new();
    let mut groups: Vec<Vec<(u8, u8)>> = Vec::new();

    for &(x, y) in &set {
        if visited.contains(&(x, y)) {
            continue;
        }
        let mut queue = VecDeque::new();
        let mut group = Vec::new();
        queue.push_back((x, y));
        visited.insert((x, y));
        while let Some((cx, cy)) = queue.pop_front() {
            group.push((cx, cy));
            for (nx, ny) in neighbors(cx, cy) {
                if (nx as usize) >= BOARD_SIZE || (ny as usize) >= BOARD_SIZE {
                    continue;
                }
                if set.contains(&(nx, ny)) && !visited.contains(&(nx, ny)) {
                    visited.insert((nx, ny));
                    queue.push_back((nx, ny));
                }
            }
        }
        groups.push(group);
    }

    let mut lengths = groups.iter().map(|g| g.len()).collect::<Vec<_>>();
    lengths.sort_unstable();
    if lengths != EXPECTED_FLEET {
        return Err(AppError::BadRequest(
            "Invalid fleet composition. Expected ship sizes [3,2,2,1,1].".to_string(),
        ));
    }

    for group in groups {
        if group.len() <= 1 {
            continue;
        }
        let all_same_x = group.iter().all(|(x, _)| *x == group[0].0);
        let all_same_y = group.iter().all(|(_, y)| *y == group[0].1);
        if !all_same_x && !all_same_y {
            return Err(AppError::BadRequest(
                "Ships must be straight (horizontal or vertical)".to_string(),
            ));
        }
        if all_same_x {
            let mut ys = group.iter().map(|(_, y)| *y).collect::<Vec<_>>();
            ys.sort_unstable();
            if ys.windows(2).any(|w| w[1] != w[0] + 1) {
                return Err(AppError::BadRequest(
                    "Ship cells must be contiguous".to_string(),
                ));
            }
        } else {
            let mut xs = group.iter().map(|(x, _)| *x).collect::<Vec<_>>();
            xs.sort_unstable();
            if xs.windows(2).any(|w| w[1] != w[0] + 1) {
                return Err(AppError::BadRequest(
                    "Ship cells must be contiguous".to_string(),
                ));
            }
        }
    }

    Ok(set)
}

// Internal helper that supports `short_string_to_felt` operations.
fn short_string_to_felt(value: &str) -> Result<Felt> {
    let hex = hex::encode(value.as_bytes());
    parse_felt(&format!("0x{}", hex))
}

// Internal helper that supports `board_commitment_for_cells` operations.
fn board_commitment_for_cells(user_address: &str, cells: &HashSet<(u8, u8)>) -> Result<Felt> {
    let mut encoded: Vec<Felt> = Vec::with_capacity(2 + BOARD_SIZE * BOARD_SIZE);
    encoded.push(short_string_to_felt("BOARD")?);
    encoded.push(parse_felt(user_address)?);

    for y in 0..BOARD_SIZE as u8 {
        for x in 0..BOARD_SIZE as u8 {
            encoded.push(if cells.contains(&cell_key(x, y)) {
                Felt::ONE
            } else {
                Felt::ZERO
            });
        }
    }

    Ok(poseidon_hash_many(&encoded))
}

// Internal helper that supports `response_binding` operations.
struct ResponseBindingInput<'a> {
    game_id: u64,
    shooter: &'a str,
    responder: &'a str,
    shot_x: u8,
    shot_y: u8,
    defend_x: u8,
    defend_y: u8,
    is_hit: bool,
}

fn response_binding(input: ResponseBindingInput<'_>) -> Result<Felt> {
    let values = vec![
        short_string_to_felt("RESPONSE")?,
        Felt::from(input.game_id),
        parse_felt(input.shooter)?,
        parse_felt(input.responder)?,
        Felt::from(input.shot_x),
        Felt::from(input.shot_y),
        Felt::from(input.defend_x),
        Felt::from(input.defend_y),
        if input.is_hit { Felt::ONE } else { Felt::ZERO },
    ];
    Ok(poseidon_hash_many(&values))
}

// Internal helper that supports `fire_binding` operations.
fn fire_binding(game_id: u64, shooter: &str, x: u8, y: u8) -> Result<Felt> {
    let values = vec![
        short_string_to_felt("FIRE")?,
        Felt::from(game_id),
        parse_felt(shooter)?,
        Felt::from(x),
        Felt::from(y),
    ];
    Ok(poseidon_hash_many(&values))
}

// Internal helper that parses or transforms values for `parse_or_generate_payload_from_request`.
fn parse_or_generate_payload_from_request(
    payload: Option<&GaragaPayloadInput>,
    verifier: &str,
) -> Option<AutoPrivacyPayloadResponse> {
    let input = payload?;
    let nullifier = input.nullifier.as_deref()?.trim();
    if nullifier.is_empty() {
        return None;
    }
    let proof = normalize_hex_items(input.proof.as_ref().unwrap_or(&Vec::new()));
    let public_inputs = normalize_hex_items(input.public_inputs.as_ref().unwrap_or(&Vec::new()));
    if proof.is_empty() || public_inputs.is_empty() {
        return None;
    }
    Some(AutoPrivacyPayloadResponse {
        verifier: input
            .verifier
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(verifier)
            .to_string(),
        nullifier: nullifier.to_string(),
        commitment: input
            .commitment
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("0x0")
            .to_string(),
        executor_address: None,
        root: None,
        note_version: None,
        note_commitment: None,
        denom_id: None,
        spendable_at_unix: None,
        proof,
        public_inputs,
    })
}

// Internal helper that fetches data for `resolve_battleship_payload`.
async fn resolve_battleship_payload(
    state: &AppState,
    user_address: &str,
    privacy: Option<&GaragaPayloadInput>,
    flow: &str,
    binding: Felt,
) -> Result<AutoPrivacyPayloadResponse> {
    let verifier = parse_privacy_verifier_kind(
        privacy
            .and_then(|payload| payload.verifier.as_deref())
            .or(Some("garaga")),
    )?
    .as_str()
    .to_string();

    let mut payload =
        if let Some(request_payload) = parse_or_generate_payload_from_request(privacy, &verifier) {
            request_payload
        } else {
            generate_auto_garaga_payload(
                &state.config,
                user_address,
                &verifier,
                Some(&AutoPrivacyTxContext {
                    flow: Some(format!("battleship_{}", flow)),
                    from_token: Some("BATTLESHIP".to_string()),
                    to_token: Some("BATTLESHIP".to_string()),
                    amount: Some("1".to_string()),
                    recipient: None,
                    from_network: Some("starknet".to_string()),
                    to_network: Some("starknet".to_string()),
                    ..Default::default()
                }),
            )
            .await?
        };

    if is_dummy_payload(&payload) {
        return Err(AppError::BadRequest(
            "Garaga payload is dummy (0x1). Provide real proof/public_inputs.".to_string(),
        ));
    }

    let nullifier = parse_felt(payload.nullifier.trim())
        .map_err(|_| AppError::BadRequest("privacy.nullifier is invalid felt".to_string()))?;

    if payload.proof.is_empty() || payload.public_inputs.is_empty() {
        return Err(AppError::BadRequest(
            "privacy.proof/public_inputs are required".to_string(),
        ));
    }

    while payload.public_inputs.len() < 2 {
        payload.public_inputs.push("0x0".to_string());
    }
    payload.public_inputs[0] = nullifier.to_string();
    payload.public_inputs[1] = binding.to_string();
    payload.commitment = binding.to_string();
    payload.verifier = verifier;

    Ok(payload)
}

// Internal helper that parses or transforms values for `parse_proof_and_public_inputs`.
fn parse_proof_and_public_inputs(
    calldata: &[Felt],
    start_index: usize,
) -> Result<(Vec<Felt>, Vec<Felt>)> {
    if calldata.len() <= start_index {
        return Err(AppError::BadRequest(
            "Invalid calldata: missing proof length".to_string(),
        ));
    }
    let proof_len = felt_to_usize(&calldata[start_index], "proof_len")?;
    let proof_start = start_index + 1;
    let proof_end = proof_start.checked_add(proof_len).ok_or_else(|| {
        AppError::BadRequest("Invalid calldata: proof length overflow".to_string())
    })?;
    if proof_end >= calldata.len() {
        return Err(AppError::BadRequest(
            "Invalid calldata: proof/public_inputs segment out of bounds".to_string(),
        ));
    }

    let public_len = felt_to_usize(&calldata[proof_end], "public_inputs_len")?;
    let public_start = proof_end + 1;
    let public_end = public_start.checked_add(public_len).ok_or_else(|| {
        AppError::BadRequest("Invalid calldata: public_inputs overflow".to_string())
    })?;
    if public_end > calldata.len() {
        return Err(AppError::BadRequest(
            "Invalid calldata: public_inputs out of bounds".to_string(),
        ));
    }

    Ok((
        calldata[proof_start..proof_end].to_vec(),
        calldata[public_start..public_end].to_vec(),
    ))
}

// Internal helper that builds inputs for `build_create_game_wallet_call`.
fn build_create_game_wallet_call(
    contract: Felt,
    opponent: Felt,
    board_commitment: Felt,
    payload: &AutoPrivacyPayloadResponse,
) -> Result<StarknetWalletCall> {
    let proof: Vec<Felt> = payload
        .proof
        .iter()
        .map(|value| parse_felt(value))
        .collect::<Result<Vec<_>>>()?;
    let public_inputs: Vec<Felt> = payload
        .public_inputs
        .iter()
        .map(|value| parse_felt(value))
        .collect::<Result<Vec<_>>>()?;

    let mut calldata = Vec::with_capacity(4 + proof.len() + public_inputs.len());
    calldata.push(opponent);
    calldata.push(board_commitment);
    calldata.push(Felt::from(proof.len() as u64));
    calldata.extend(proof);
    calldata.push(Felt::from(public_inputs.len() as u64));
    calldata.extend(public_inputs);

    Ok(StarknetWalletCall {
        contract_address: contract.to_string(),
        entrypoint: "create_game".to_string(),
        calldata: calldata.iter().map(ToString::to_string).collect(),
    })
}

// Internal helper that builds inputs for `build_join_game_wallet_call`.
fn build_join_game_wallet_call(
    contract: Felt,
    game_id: u64,
    board_commitment: Felt,
    payload: &AutoPrivacyPayloadResponse,
) -> Result<StarknetWalletCall> {
    let proof: Vec<Felt> = payload
        .proof
        .iter()
        .map(|value| parse_felt(value))
        .collect::<Result<Vec<_>>>()?;
    let public_inputs: Vec<Felt> = payload
        .public_inputs
        .iter()
        .map(|value| parse_felt(value))
        .collect::<Result<Vec<_>>>()?;

    let mut calldata = Vec::with_capacity(5 + proof.len() + public_inputs.len());
    calldata.push(Felt::from(game_id));
    calldata.push(board_commitment);
    calldata.push(Felt::from(proof.len() as u64));
    calldata.extend(proof);
    calldata.push(Felt::from(public_inputs.len() as u64));
    calldata.extend(public_inputs);

    Ok(StarknetWalletCall {
        contract_address: contract.to_string(),
        entrypoint: "join_game".to_string(),
        calldata: calldata.iter().map(ToString::to_string).collect(),
    })
}

// Internal helper that builds inputs for `build_fire_wallet_call`.
fn build_fire_wallet_call(
    contract: Felt,
    game_id: u64,
    x: u8,
    y: u8,
    payload: &AutoPrivacyPayloadResponse,
) -> Result<StarknetWalletCall> {
    let proof: Vec<Felt> = payload
        .proof
        .iter()
        .map(|value| parse_felt(value))
        .collect::<Result<Vec<_>>>()?;
    let public_inputs: Vec<Felt> = payload
        .public_inputs
        .iter()
        .map(|value| parse_felt(value))
        .collect::<Result<Vec<_>>>()?;

    let mut calldata = Vec::with_capacity(6 + proof.len() + public_inputs.len());
    calldata.push(Felt::from(game_id));
    calldata.push(Felt::from(x));
    calldata.push(Felt::from(y));
    calldata.push(Felt::from(proof.len() as u64));
    calldata.extend(proof);
    calldata.push(Felt::from(public_inputs.len() as u64));
    calldata.extend(public_inputs);

    Ok(StarknetWalletCall {
        contract_address: contract.to_string(),
        entrypoint: "fire_shot".to_string(),
        calldata: calldata.iter().map(ToString::to_string).collect(),
    })
}

// Internal helper that builds inputs for `build_respond_wallet_call`.
fn build_respond_wallet_call(
    contract: Felt,
    game_id: u64,
    defend_x: u8,
    defend_y: u8,
    is_hit: bool,
    payload: &AutoPrivacyPayloadResponse,
) -> Result<StarknetWalletCall> {
    let proof: Vec<Felt> = payload
        .proof
        .iter()
        .map(|value| parse_felt(value))
        .collect::<Result<Vec<_>>>()?;
    let public_inputs: Vec<Felt> = payload
        .public_inputs
        .iter()
        .map(|value| parse_felt(value))
        .collect::<Result<Vec<_>>>()?;

    let mut calldata = Vec::with_capacity(7 + proof.len() + public_inputs.len());
    calldata.push(Felt::from(game_id));
    calldata.push(Felt::from(defend_x));
    calldata.push(Felt::from(defend_y));
    calldata.push(if is_hit { Felt::ONE } else { Felt::ZERO });
    calldata.push(Felt::from(proof.len() as u64));
    calldata.extend(proof);
    calldata.push(Felt::from(public_inputs.len() as u64));
    calldata.extend(public_inputs);

    Ok(StarknetWalletCall {
        contract_address: contract.to_string(),
        entrypoint: "respond_shot".to_string(),
        calldata: calldata.iter().map(ToString::to_string).collect(),
    })
}

// Internal helper that builds inputs for `build_timeout_wallet_call`.
fn build_timeout_wallet_call(contract: Felt, game_id: u64) -> StarknetWalletCall {
    StarknetWalletCall {
        contract_address: contract.to_string(),
        entrypoint: "claim_timeout".to_string(),
        calldata: vec![Felt::from(game_id).to_string()],
    }
}

// Internal helper that supports `battleship_contract_address` operations.
fn battleship_contract_address(state: &AppState) -> Result<Felt> {
    let Some(raw) = state
        .config
        .battleship_garaga_address
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Err(AppError::BadRequest(
            "BATTLESHIP_GARAGA_ADDRESS is not configured".to_string(),
        ));
    };

    parse_felt(raw)
        .map_err(|_| AppError::BadRequest("BATTLESHIP_GARAGA_ADDRESS is invalid felt".to_string()))
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

    if calldata.len() < flattened_end {
        return Err(AppError::BadRequest(
            "Invalid invoke calldata: flattened segment out of bounds".to_string(),
        ));
    }

    let flattened = &calldata[flattened_start..flattened_end];
    let mut calls = Vec::with_capacity(calls_len);

    for idx in 0..calls_len {
        let offset = header_start + idx * header_width;
        let to = calldata[offset];
        let selector = calldata[offset + 1];
        let data_offset = felt_to_usize(&calldata[offset + 2], "data_offset")?;
        let data_len = felt_to_usize(&calldata[offset + 3], "data_len")?;
        let data_end = data_offset.checked_add(data_len).ok_or_else(|| {
            AppError::BadRequest("Invalid invoke calldata: data segment overflow".to_string())
        })?;
        if data_end > flattened.len() {
            return Err(AppError::BadRequest(
                "Invalid invoke calldata: call segment out of bounds".to_string(),
            ));
        }

        calls.push(ParsedExecuteCall {
            to,
            selector,
            calldata: flattened[data_offset..data_end].to_vec(),
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
    let mut cursor = 1usize;
    let mut calls = Vec::with_capacity(calls_len);

    for _ in 0..calls_len {
        let header_end = cursor.checked_add(3).ok_or_else(|| {
            AppError::BadRequest("Invalid invoke calldata: malformed call header".to_string())
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
fn parse_execute_calls(calldata: &[Felt]) -> Result<Vec<ParsedExecuteCall>> {
    if let Ok(calls) = parse_execute_calls_offset(calldata) {
        return Ok(calls);
    }
    parse_execute_calls_inline(calldata)
}

// Internal helper that supports `extract_invoke_sender_and_calldata` operations.
fn extract_invoke_sender_and_calldata(tx: &StarknetTransaction) -> Result<(Felt, &[Felt])> {
    let invoke = match tx {
        StarknetTransaction::Invoke(invoke) => invoke,
        _ => {
            return Err(AppError::BadRequest(
                "onchain_tx_hash must be an INVOKE transaction".to_string(),
            ));
        }
    };

    match invoke {
        InvokeTransaction::V1(tx) => Ok((tx.sender_address, tx.calldata.as_slice())),
        InvokeTransaction::V3(tx) => Ok((tx.sender_address, tx.calldata.as_slice())),
        InvokeTransaction::V0(_) => Err(AppError::BadRequest(
            "onchain_tx_hash uses unsupported INVOKE v0".to_string(),
        )),
    }
}

// Internal helper that parses or transforms values for `parse_selector`.
fn parse_selector(name: &str) -> Result<Felt> {
    get_selector_from_name(name).map_err(|e| AppError::Internal(format!("Selector error: {}", e)))
}

// Internal helper that fetches data for `find_battleship_call`.
fn find_battleship_call(
    calls: &[ParsedExecuteCall],
    contract: Felt,
    selector: Felt,
) -> Result<&ParsedExecuteCall> {
    calls
        .iter()
        .find(|call| call.to == contract && call.selector == selector)
        .ok_or_else(|| {
            AppError::BadRequest(
                "onchain_tx_hash does not contain expected Battleship contract call".to_string(),
            )
        })
}

// Internal helper that supports `verify_battleship_tx_call` operations.
async fn verify_battleship_tx_call<F>(
    state: &AppState,
    tx_hash: &str,
    expected_sender: &str,
    expected_selector_name: &str,
    validate_call: F,
) -> Result<(i64, ParsedExecuteCall, TransactionReceiptWithBlockInfo)>
where
    F: Fn(&ParsedExecuteCall) -> Result<()>,
{
    let reader = OnchainReader::from_config(&state.config)?;
    let tx_hash_felt = parse_felt(tx_hash)?;
    let expected_sender_felt = parse_felt(expected_sender)?;
    let contract = battleship_contract_address(state)?;
    let selector = parse_selector(expected_selector_name)?;

    let mut last_error = String::new();
    for attempt in 0..6 {
        let tx = match reader.get_transaction(&tx_hash_felt).await {
            Ok(tx) => tx,
            Err(err) => {
                last_error = err.to_string();
                if attempt < 5 {
                    sleep(Duration::from_millis(700)).await;
                    continue;
                }
                break;
            }
        };

        let (sender, calldata) = extract_invoke_sender_and_calldata(&tx)?;
        if sender != expected_sender_felt {
            return Err(AppError::BadRequest(format!(
                "onchain_tx_hash sender mismatch (expected {}, got {})",
                expected_sender_felt, sender
            )));
        }

        let calls = parse_execute_calls(calldata)?;
        let call = find_battleship_call(&calls, contract, selector)?.clone();
        validate_call(&call)?;

        match reader.get_transaction_receipt(&tx_hash_felt).await {
            Ok(receipt) => {
                if let ExecutionResult::Reverted { reason } = receipt.receipt.execution_result() {
                    return Err(AppError::BadRequest(format!(
                        "onchain_tx_hash reverted on Starknet: {}",
                        reason
                    )));
                }
                let block_number = receipt.block.block_number() as i64;
                return Ok((block_number, call, receipt));
            }
            Err(err) => {
                last_error = err.to_string();
                if attempt < 5 {
                    sleep(Duration::from_millis(700)).await;
                }
            }
        }
    }

    Err(AppError::BadRequest(format!(
        "onchain_tx_hash not found/confirmed on Starknet RPC: {}",
        last_error
    )))
}

// Internal helper that supports `extract_game_created_event` operations.
fn extract_game_created_event(
    receipt: &TransactionReceiptWithBlockInfo,
    battleship_contract: Felt,
) -> Result<u64> {
    let event_selector = parse_selector("GameCreated")?;

    for event in receipt.receipt.events() {
        if event.from_address != battleship_contract {
            continue;
        }
        if event.keys.first().copied() != Some(event_selector) {
            continue;
        }
        let Some(game_id_felt) = event.data.first() else {
            continue;
        };
        return felt_to_u64(game_id_felt, "game_id");
    }

    Err(AppError::BadRequest(
        "Unable to parse game_id from GameCreated event in onchain_tx_hash".to_string(),
    ))
}

// Internal helper that supports `extract_shot_fired_event` operations.
fn extract_shot_fired_event(
    receipt: &TransactionReceiptWithBlockInfo,
    battleship_contract: Felt,
) -> Result<Option<(String, u8, u8)>> {
    let event_selector = parse_selector("ShotFired")?;

    for event in receipt.receipt.events() {
        if event.from_address != battleship_contract {
            continue;
        }
        if event.keys.first().copied() != Some(event_selector) {
            continue;
        }
        if event.data.len() < 4 {
            continue;
        }
        let shooter = event.data[1].to_string();
        let x = felt_to_u8(&event.data[2], "x")?;
        let y = felt_to_u8(&event.data[3], "y")?;
        return Ok(Some((shooter, x, y)));
    }

    Ok(None)
}

// Internal helper that supports `extract_shot_result_event` operations.
fn extract_shot_result_event(
    receipt: &TransactionReceiptWithBlockInfo,
    battleship_contract: Felt,
) -> Result<Option<(u8, u8, bool)>> {
    let event_selector = parse_selector("ShotResult")?;

    for event in receipt.receipt.events() {
        if event.from_address != battleship_contract {
            continue;
        }
        if event.keys.first().copied() != Some(event_selector) {
            continue;
        }
        if event.data.len() < 4 {
            continue;
        }
        let x = felt_to_u8(&event.data[1], "x")?;
        let y = felt_to_u8(&event.data[2], "y")?;
        let hit_flag = felt_to_u64(&event.data[3], "is_hit")?;
        return Ok(Some((x, y, hit_flag != 0)));
    }

    Ok(None)
}

// Internal helper that fetches data for `read_onchain_game_state`.
async fn read_onchain_game_state(state: &AppState, game_id: u64) -> Result<OnchainGameState> {
    let reader = OnchainReader::from_config(&state.config)?;
    let contract = battleship_contract_address(state)?;
    ensure_battleship_contract_abi(state, contract).await?;

    let state_selector = parse_selector("get_game_state")?;
    let output = reader
        .call(FunctionCall {
            contract_address: contract,
            entry_point_selector: state_selector,
            calldata: vec![Felt::from(game_id)],
        })
        .await?;

    if output.len() < 8 {
        return Err(AppError::BadRequest(
            "Battleship get_game_state returned invalid response".to_string(),
        ));
    }

    let status = GameStatus::from_u64(felt_to_u64(&output[0], "status")?);
    let player_a = output[1].to_string();
    let player_b = output[2].to_string();
    let turn_raw = output[3];
    let winner_raw = output[4];
    let hits_on_a = u8::try_from(felt_to_u64(&output[5], "hits_on_a")?).unwrap_or(u8::MAX);
    let hits_on_b = u8::try_from(felt_to_u64(&output[6], "hits_on_b")?).unwrap_or(u8::MAX);
    let pending_flag = felt_to_u64(&output[7], "pending")? != 0;

    let pending = if pending_flag {
        let pending_selector = parse_selector("get_pending_shot")?;
        let pending_out = reader
            .call(FunctionCall {
                contract_address: contract,
                entry_point_selector: pending_selector,
                calldata: vec![Felt::from(game_id)],
            })
            .await?;
        if pending_out.len() >= 3 && pending_out[0] != Felt::ZERO {
            Some(PendingShot {
                shooter: pending_out[0].to_string(),
                x: felt_to_u8(&pending_out[1], "pending_shot_x")?,
                y: felt_to_u8(&pending_out[2], "pending_shot_y")?,
            })
        } else {
            None
        }
    } else {
        None
    };

    Ok(OnchainGameState {
        status,
        player_a,
        player_b,
        turn: if turn_raw == Felt::ZERO {
            None
        } else {
            Some(turn_raw.to_string())
        },
        winner: if winner_raw == Felt::ZERO {
            None
        } else {
            Some(winner_raw.to_string())
        },
        hits_on_a,
        hits_on_b,
        pending,
    })
}

// Internal helper that runs side-effecting logic for `ensure_game_access`.
fn ensure_game_access<'a>(game: &'a BattleshipGame, user: &str) -> Result<&'a str> {
    if addr_eq(&game.player_a, user) {
        return Ok("A");
    }
    if addr_eq(&game.player_b, user) {
        return Ok("B");
    }
    Err(AppError::AuthError(
        "You are not a participant of this game".to_string(),
    ))
}

// Internal helper that supports `upsert_game_from_chain` operations.
fn upsert_game_from_chain(store: &mut BattleshipStore, game_id: u64, chain: &OnchainGameState) {
    let entry = store
        .games
        .entry(game_id)
        .or_insert_with(|| BattleshipGame {
            game_id,
            creator: chain.player_a.clone(),
            player_a: chain.player_a.clone(),
            player_b: chain.player_b.clone(),
            status: chain.status,
            current_turn: chain.turn.clone(),
            winner: chain.winner.clone(),
            board_a: None,
            board_b: None,
            shots_a: HashSet::new(),
            shots_b: HashSet::new(),
            hits_on_a: chain.hits_on_a,
            hits_on_b: chain.hits_on_b,
            pending_shot: chain.pending.clone(),
            shot_history: Vec::new(),
            last_action_at: now_unix(),
        });

    entry.player_a = chain.player_a.clone();
    entry.player_b = chain.player_b.clone();
    entry.status = chain.status;
    entry.current_turn = chain.turn.clone();
    entry.winner = chain.winner.clone();
    entry.hits_on_a = chain.hits_on_a;
    entry.hits_on_b = chain.hits_on_b;
    entry.pending_shot = chain.pending.clone();
}

// Internal helper that builds inputs for `build_state_response`.
fn build_state_response(game: &BattleshipGame, user: &str) -> Result<BattleshipGameStateResponse> {
    let side = ensure_game_access(game, user)?;
    let (
        your_board,
        your_shots,
        opponent_shots,
        your_hits_taken,
        opponent_hits_taken,
        your_ready,
        opponent_ready,
    ) = if side == "A" {
        (
            game.board_a
                .as_ref()
                .map(|board| to_cells(&board.cells))
                .unwrap_or_default(),
            to_cells(&game.shots_a),
            to_cells(&game.shots_b),
            game.hits_on_a,
            game.hits_on_b,
            game.board_a.is_some() || game.status != GameStatus::Waiting,
            game.board_b.is_some() || game.status != GameStatus::Waiting,
        )
    } else {
        (
            game.board_b
                .as_ref()
                .map(|board| to_cells(&board.cells))
                .unwrap_or_default(),
            to_cells(&game.shots_b),
            to_cells(&game.shots_a),
            game.hits_on_b,
            game.hits_on_a,
            game.board_b.is_some() || game.status != GameStatus::Waiting,
            game.board_a.is_some() || game.status != GameStatus::Waiting,
        )
    };

    let pending_view = game.pending_shot.as_ref().map(|shot| PendingShotView {
        shooter: shot.shooter.clone(),
        x: shot.x,
        y: shot.y,
    });

    let can_respond = game
        .pending_shot
        .as_ref()
        .map(|shot| !addr_eq(&shot.shooter, user))
        .unwrap_or(false)
        && game.status == GameStatus::Playing;

    Ok(BattleshipGameStateResponse {
        game_id: game_id_string(game.game_id),
        status: map_status_label(game.status),
        creator: game.creator.clone(),
        player_a: game.player_a.clone(),
        player_b: if addr_eq(&game.player_b, "0x0") {
            None
        } else {
            Some(game.player_b.clone())
        },
        current_turn: game.current_turn.clone(),
        winner: game.winner.clone(),
        your_address: user.to_string(),
        your_ready,
        opponent_ready,
        your_hits_taken,
        opponent_hits_taken,
        your_board,
        your_shots,
        opponent_shots,
        shot_history: game.shot_history.clone(),
        timeout_in_seconds: (game.status == GameStatus::Playing)
            .then(|| timeout_remaining(game.last_action_at)),
        pending_shot: pending_view,
        can_respond,
    })
}

// Internal helper that supports `points_tx_hash` operations.
fn points_tx_hash(onchain_tx_hash: &str, user_address: &str, tx_type: &str) -> String {
    hash::hash_string(&format!(
        "battle:{}:{}:{}",
        onchain_tx_hash, user_address, tx_type
    ))
}

// Internal helper that updates state for `save_battle_transaction`.
async fn save_battle_transaction(
    state: &AppState,
    user_address: &str,
    tx_type: &str,
    usd_value: f64,
    onchain_tx_hash: &str,
) -> Result<()> {
    let tx = Transaction {
        tx_hash: points_tx_hash(onchain_tx_hash, user_address, tx_type),
        block_number: 0,
        user_address: user_address.to_string(),
        tx_type: tx_type.to_string(),
        token_in: Some("BATTLE".to_string()),
        token_out: Some("BATTLE".to_string()),
        amount_in: Some(Decimal::ONE),
        amount_out: Some(Decimal::ONE),
        usd_value: Decimal::from_f64_retain(usd_value),
        fee_paid: None,
        points_earned: None,
        timestamp: Utc::now(),
        processed: false,
    };
    state.db.save_transaction(&tx).await
}

// Internal helper that supports `game_from_store_mut` operations.
fn game_from_store_mut(store: &mut BattleshipStore, game_id: u64) -> Result<&mut BattleshipGame> {
    store.games.get_mut(&game_id).ok_or_else(|| {
        AppError::BadRequest(
            "Game not found in local cache. Open game state first and retry.".to_string(),
        )
    })
}

// Internal helper that fetches data for `resolve_pending_shot_for_user`.
fn resolve_pending_shot_for_user(game: &BattleshipGame, user: &str) -> Result<PendingShot> {
    let Some(shot) = game.pending_shot.as_ref() else {
        return Err(AppError::BadRequest(
            "No pending shot to respond".to_string(),
        ));
    };
    if addr_eq(&shot.shooter, user) {
        return Err(AppError::BadRequest(
            "Shooter cannot respond to own shot".to_string(),
        ));
    }
    Ok(shot.clone())
}

// Internal helper that fetches data for `resolve_defense_outcome`.
fn resolve_defense_outcome(
    game: &BattleshipGame,
    responder: &str,
    pending_shot: &PendingShot,
    defend_x: u8,
    defend_y: u8,
) -> Result<(bool, bool, bool)> {
    let board = if addr_eq(&game.player_a, responder) {
        game.board_a.as_ref()
    } else if addr_eq(&game.player_b, responder) {
        game.board_b.as_ref()
    } else {
        None
    };

    let Some(board) = board else {
        return Err(AppError::BadRequest(
            "Your committed board is not cached on backend. Re-open game state first and retry."
                .to_string(),
        ));
    };

    let shot_has_ship = board.cells.contains(&(pending_shot.x, pending_shot.y));
    let defended_exact = defend_x == pending_shot.x && defend_y == pending_shot.y;
    let defense_success = shot_has_ship && defended_exact;
    let is_hit = shot_has_ship && !defended_exact;
    Ok((is_hit, shot_has_ship, defense_success))
}

/// POST /api/v1/battleship/create
pub async fn create_game(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateGameRequest>,
) -> Result<Json<ApiResponse<GameActionResponse>>> {
    let user = require_starknet_user(&headers, &state).await?;
    let opponent_raw = req.opponent.trim();
    let opponent = if opponent_raw.is_empty() {
        Felt::ZERO
    } else {
        parse_felt(opponent_raw)?
    };
    let user_felt = parse_felt(&user)?;
    if opponent != Felt::ZERO && opponent == user_felt {
        return Err(AppError::BadRequest(
            "Cannot create game with your own address".to_string(),
        ));
    }

    let fleet = validate_fleet(&req.cells)?;
    let board_commitment = board_commitment_for_cells(&user, &fleet)?;
    let contract = battleship_contract_address(&state)?;
    ensure_battleship_contract_abi(&state, contract).await?;

    if req
        .onchain_tx_hash
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        let payload = resolve_battleship_payload(
            &state,
            &user,
            req.privacy.as_ref(),
            "create",
            board_commitment,
        )
        .await?;
        let call = build_create_game_wallet_call(contract, opponent, board_commitment, &payload)?;
        let response = prepared_action_response(
            "-".to_string(),
            "Sign create_game transaction in wallet.",
            vec![call],
        );
        return Ok(Json(ApiResponse::success(response)));
    }

    let tx_hash = normalize_onchain_tx_hash(req.onchain_tx_hash.as_deref())?
        .ok_or_else(|| AppError::BadRequest("onchain_tx_hash is required".to_string()))?;

    let (_block_number, call, receipt) =
        verify_battleship_tx_call(&state, &tx_hash, &user, "create_game", |call| {
            if call.calldata.len() < 2 {
                return Err(AppError::BadRequest(
                    "create_game calldata is too short".to_string(),
                ));
            }
            if call.calldata[0] != opponent {
                return Err(AppError::BadRequest(
                    "create_game opponent does not match request".to_string(),
                ));
            }
            if call.calldata[1] != board_commitment {
                return Err(AppError::BadRequest(
                    "create_game board commitment mismatch".to_string(),
                ));
            }
            let (_proof, public_inputs) = parse_proof_and_public_inputs(&call.calldata, 2)?;
            if public_inputs.len() < 2 {
                return Err(AppError::BadRequest(
                    "create_game public_inputs too short".to_string(),
                ));
            }
            if public_inputs[1] != board_commitment {
                return Err(AppError::BadRequest(
                    "create_game binding does not match board commitment".to_string(),
                ));
            }
            Ok(())
        })
        .await?;

    let game_id = extract_game_created_event(&receipt, call.to)?;
    let onchain = read_onchain_game_state(&state, game_id).await?;

    let mut store = battleship_store().write().await;
    upsert_game_from_chain(&mut store, game_id, &onchain);
    let game = game_from_store_mut(&mut store, game_id)?;
    if addr_eq(&game.player_a, &user) {
        game.board_a = Some(PlayerBoard { cells: fleet });
    } else if addr_eq(&game.player_b, &user) {
        game.board_b = Some(PlayerBoard { cells: fleet });
    }
    game.last_action_at = now_unix();

    let response = GameActionResponse {
        game_id: game_id_string(game_id),
        status: game.status.as_str().to_string(),
        message: "Game created on-chain.".to_string(),
        tx_hash: Some(tx_hash),
        onchain_calls: None,
        requires_wallet_signature: false,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// POST /api/v1/battleship/join
pub async fn join_game(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<JoinGameRequest>,
) -> Result<Json<ApiResponse<GameActionResponse>>> {
    let user = require_starknet_user(&headers, &state).await?;
    let game_id = parse_game_id(&req.game_id)?;
    let fleet = validate_fleet(&req.cells)?;
    let board_commitment = board_commitment_for_cells(&user, &fleet)?;
    let contract = battleship_contract_address(&state)?;
    ensure_battleship_contract_abi(&state, contract).await?;

    if req
        .onchain_tx_hash
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        let onchain = read_onchain_game_state(&state, game_id).await?;
        if onchain.status != GameStatus::Waiting {
            return Err(AppError::BadRequest(
                "Game is not joinable (status must be WAITING).".to_string(),
            ));
        }
        if addr_eq(&onchain.player_a, &user) {
            return Err(AppError::BadRequest(
                "Creator wallet cannot join the same game.".to_string(),
            ));
        }
        let is_open_challenge = addr_eq(&onchain.player_b, "0x0");
        if !is_open_challenge && !addr_eq(&onchain.player_b, &user) {
            return Err(AppError::BadRequest(
                "Connected wallet is not the invited opponent for this game.".to_string(),
            ));
        }

        let payload = resolve_battleship_payload(
            &state,
            &user,
            req.privacy.as_ref(),
            "join",
            board_commitment,
        )
        .await?;
        let call = build_join_game_wallet_call(contract, game_id, board_commitment, &payload)?;
        let response = prepared_action_response(
            game_id_string(game_id),
            "Sign join_game transaction in wallet.",
            vec![call],
        );
        return Ok(Json(ApiResponse::success(response)));
    }

    let tx_hash = normalize_onchain_tx_hash(req.onchain_tx_hash.as_deref())?
        .ok_or_else(|| AppError::BadRequest("onchain_tx_hash is required".to_string()))?;

    let (_block_number, _call, _receipt) =
        verify_battleship_tx_call(&state, &tx_hash, &user, "join_game", |call| {
            if call.calldata.len() < 2 {
                return Err(AppError::BadRequest(
                    "join_game calldata is too short".to_string(),
                ));
            }
            if felt_to_u64(&call.calldata[0], "game_id")? != game_id {
                return Err(AppError::BadRequest(
                    "join_game game_id does not match request".to_string(),
                ));
            }
            if call.calldata[1] != board_commitment {
                return Err(AppError::BadRequest(
                    "join_game board commitment mismatch".to_string(),
                ));
            }
            let (_proof, public_inputs) = parse_proof_and_public_inputs(&call.calldata, 2)?;
            if public_inputs.len() < 2 {
                return Err(AppError::BadRequest(
                    "join_game public_inputs too short".to_string(),
                ));
            }
            if public_inputs[1] != board_commitment {
                return Err(AppError::BadRequest(
                    "join_game binding does not match board commitment".to_string(),
                ));
            }
            Ok(())
        })
        .await?;

    let onchain = read_onchain_game_state(&state, game_id).await?;

    let mut store = battleship_store().write().await;
    upsert_game_from_chain(&mut store, game_id, &onchain);
    let game = game_from_store_mut(&mut store, game_id)?;
    if addr_eq(&game.player_a, &user) {
        game.board_a = Some(PlayerBoard { cells: fleet });
    } else if addr_eq(&game.player_b, &user) {
        game.board_b = Some(PlayerBoard { cells: fleet });
    }
    game.last_action_at = now_unix();

    let response = GameActionResponse {
        game_id: game_id_string(game_id),
        status: game.status.as_str().to_string(),
        message: "Joined game on-chain.".to_string(),
        tx_hash: Some(tx_hash),
        onchain_calls: None,
        requires_wallet_signature: false,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// POST /api/v1/battleship/place-ships
/// Compatibility endpoint: in full on-chain mode ship commitment is part of create/join.
pub async fn place_ships(
    State(_state): State<AppState>,
    _headers: HeaderMap,
    Json(req): Json<PlaceShipsRequest>,
) -> Result<Json<ApiResponse<GameActionResponse>>> {
    let _ = (
        req.game_id.trim(),
        req.cells.len(),
        req.privacy.as_ref().and_then(|p| p.verifier.as_deref()),
        req.onchain_tx_hash.as_deref(),
    );
    Err(AppError::BadRequest(
        "Full on-chain mode: use /api/v1/battleship/create (player A) or /api/v1/battleship/join (player B)."
            .to_string(),
    ))
}

/// POST /api/v1/battleship/fire
pub async fn fire_shot(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<FireShotRequest>,
) -> Result<Json<ApiResponse<FireShotResponse>>> {
    let user = require_starknet_user(&headers, &state).await?;
    let game_id = parse_game_id(&req.game_id)?;
    verify_bounds(req.x, req.y)?;
    let fire_bind = fire_binding(game_id, &user, req.x, req.y)?;
    let contract = battleship_contract_address(&state)?;
    ensure_battleship_contract_abi(&state, contract).await?;

    if req
        .onchain_tx_hash
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        let payload =
            resolve_battleship_payload(&state, &user, req.privacy.as_ref(), "fire", fire_bind)
                .await?;
        let call = build_fire_wallet_call(contract, game_id, req.x, req.y, &payload)?;
        let response = prepared_fire_response(
            game_id_string(game_id),
            "Sign fire_shot transaction in wallet.",
            vec![call],
        );
        return Ok(Json(ApiResponse::success(response)));
    }

    let tx_hash = normalize_onchain_tx_hash(req.onchain_tx_hash.as_deref())?
        .ok_or_else(|| AppError::BadRequest("onchain_tx_hash is required".to_string()))?;

    let (_block_number, call, receipt) =
        verify_battleship_tx_call(&state, &tx_hash, &user, "fire_shot", |call| {
            if call.calldata.len() < 4 {
                return Err(AppError::BadRequest(
                    "fire_shot calldata is too short".to_string(),
                ));
            }
            if felt_to_u64(&call.calldata[0], "game_id")? != game_id {
                return Err(AppError::BadRequest(
                    "fire_shot game_id does not match request".to_string(),
                ));
            }
            if felt_to_u8(&call.calldata[1], "x")? != req.x
                || felt_to_u8(&call.calldata[2], "y")? != req.y
            {
                return Err(AppError::BadRequest(
                    "fire_shot coordinates do not match request".to_string(),
                ));
            }
            let (_proof, public_inputs) = parse_proof_and_public_inputs(&call.calldata, 3)?;
            if public_inputs.len() < 2 {
                return Err(AppError::BadRequest(
                    "fire_shot public_inputs too short".to_string(),
                ));
            }
            if public_inputs[1] != fire_bind {
                return Err(AppError::BadRequest(
                    "fire_shot binding mismatch with expected shot binding".to_string(),
                ));
            }
            Ok(())
        })
        .await?;

    let fired_from_event = extract_shot_fired_event(&receipt, call.to)?;
    let onchain = read_onchain_game_state(&state, game_id).await?;

    let mut store = battleship_store().write().await;
    upsert_game_from_chain(&mut store, game_id, &onchain);
    let game = game_from_store_mut(&mut store, game_id)?;

    let (shooter, x, y) = if let Some((event_shooter, event_x, event_y)) = fired_from_event {
        (event_shooter, event_x, event_y)
    } else {
        (user.clone(), req.x, req.y)
    };

    if addr_eq(&shooter, &game.player_a) {
        game.shots_a.insert((x, y));
    } else if addr_eq(&shooter, &game.player_b) {
        game.shots_b.insert((x, y));
    }
    game.pending_shot = onchain
        .pending
        .clone()
        .or(Some(PendingShot { shooter, x, y }));
    game.last_action_at = now_unix();

    let response = FireShotResponse {
        game_id: game_id_string(game_id),
        status: game.status.as_str().to_string(),
        message: "Shot submitted on-chain. Waiting defender response.".to_string(),
        is_hit: None,
        pending_response: true,
        next_turn: game.current_turn.clone(),
        winner: game.winner.clone(),
        tx_hash: Some(tx_hash),
        onchain_calls: None,
        requires_wallet_signature: false,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// POST /api/v1/battleship/respond
pub async fn respond_shot(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<RespondShotRequest>,
) -> Result<Json<ApiResponse<FireShotResponse>>> {
    let user = require_starknet_user(&headers, &state).await?;
    let game_id = parse_game_id(&req.game_id)?;
    verify_bounds(req.defend_x, req.defend_y)?;
    let contract = battleship_contract_address(&state)?;
    ensure_battleship_contract_abi(&state, contract).await?;

    // Make sure we have latest pending shot in cache before prepare/finalize.
    {
        let onchain = read_onchain_game_state(&state, game_id).await?;
        let mut store = battleship_store().write().await;
        upsert_game_from_chain(&mut store, game_id, &onchain);
    }

    let (pending_shot, is_hit, shot_has_ship, defense_success) = {
        let mut store = battleship_store().write().await;
        let game = game_from_store_mut(&mut store, game_id)?;
        let pending = resolve_pending_shot_for_user(game, &user)?;
        let (is_hit, shot_has_ship, defense_success) =
            resolve_defense_outcome(game, &user, &pending, req.defend_x, req.defend_y)?;
        game.pending_shot = Some(pending.clone());
        (pending, is_hit, shot_has_ship, defense_success)
    };

    let binding = response_binding(ResponseBindingInput {
        game_id,
        shooter: &pending_shot.shooter,
        responder: &user,
        shot_x: pending_shot.x,
        shot_y: pending_shot.y,
        defend_x: req.defend_x,
        defend_y: req.defend_y,
        is_hit,
    })?;

    if req
        .onchain_tx_hash
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        let payload =
            resolve_battleship_payload(&state, &user, req.privacy.as_ref(), "respond", binding)
                .await?;
        let call = build_respond_wallet_call(
            contract,
            game_id,
            req.defend_x,
            req.defend_y,
            is_hit,
            &payload,
        )?;
        let response = prepared_fire_response(
            game_id_string(game_id),
            "Sign respond_shot transaction in wallet.",
            vec![call],
        );
        return Ok(Json(ApiResponse::success(response)));
    }

    let tx_hash = normalize_onchain_tx_hash(req.onchain_tx_hash.as_deref())?
        .ok_or_else(|| AppError::BadRequest("onchain_tx_hash is required".to_string()))?;

    let (_block_number, call, receipt) =
        verify_battleship_tx_call(&state, &tx_hash, &user, "respond_shot", |call| {
            if call.calldata.len() < 4 {
                return Err(AppError::BadRequest(
                    "respond_shot calldata is too short".to_string(),
                ));
            }
            if felt_to_u64(&call.calldata[0], "game_id")? != game_id {
                return Err(AppError::BadRequest(
                    "respond_shot game_id does not match request".to_string(),
                ));
            }
            if felt_to_u8(&call.calldata[1], "defend_x")? != req.defend_x
                || felt_to_u8(&call.calldata[2], "defend_y")? != req.defend_y
            {
                return Err(AppError::BadRequest(
                    "respond_shot defense coordinates do not match request".to_string(),
                ));
            }
            let onchain_is_hit = felt_to_u64(&call.calldata[3], "is_hit")? != 0;
            if onchain_is_hit != is_hit {
                return Err(AppError::BadRequest(
                    "respond_shot is_hit does not match resolved board outcome".to_string(),
                ));
            }
            let (_proof, public_inputs) = parse_proof_and_public_inputs(&call.calldata, 4)?;
            if public_inputs.len() < 2 {
                return Err(AppError::BadRequest(
                    "respond_shot public_inputs too short".to_string(),
                ));
            }
            if public_inputs[1] != binding {
                return Err(AppError::BadRequest(
                    "respond_shot binding mismatch with expected response binding".to_string(),
                ));
            }
            Ok(())
        })
        .await?;

    let result_from_event = extract_shot_result_event(&receipt, call.to)?;
    let final_is_hit = result_from_event.map(|(_, _, hit)| hit).unwrap_or(is_hit);
    let final_x = result_from_event
        .map(|(x, _, _)| x)
        .unwrap_or(pending_shot.x);
    let final_y = result_from_event
        .map(|(_, y, _)| y)
        .unwrap_or(pending_shot.y);

    let onchain = read_onchain_game_state(&state, game_id).await?;
    let mut point_txs: Vec<(String, &'static str, f64)> = Vec::new();

    {
        let mut store = battleship_store().write().await;
        upsert_game_from_chain(&mut store, game_id, &onchain);
        let game = game_from_store_mut(&mut store, game_id)?;

        if final_is_hit {
            point_txs.push((
                pending_shot.shooter.clone(),
                TX_BATTLE_HIT,
                POINTS_BATTLE_HIT,
            ));
        } else {
            point_txs.push((
                pending_shot.shooter.clone(),
                TX_BATTLE_MISS,
                POINTS_BATTLE_MISS,
            ));
        }

        if game.status == GameStatus::Finished {
            if let Some(winner) = &game.winner {
                point_txs.push((winner.clone(), TX_BATTLE_WIN, POINTS_BATTLE_WIN));
                let loser = if addr_eq(winner, &game.player_a) {
                    game.player_b.clone()
                } else {
                    game.player_a.clone()
                };
                point_txs.push((loser, TX_BATTLE_LOSS, POINTS_BATTLE_LOSS));
            }
        }

        game.shot_history.push(ShotRecord {
            shooter: pending_shot.shooter.clone(),
            x: final_x,
            y: final_y,
            is_hit: final_is_hit,
            timestamp: now_unix(),
            tx_hash: Some(tx_hash.clone()),
        });
        game.pending_shot = onchain.pending.clone();
        game.last_action_at = now_unix();
    }

    for (user_address, tx_type, usd_value) in point_txs {
        let _ = save_battle_transaction(&state, &user_address, tx_type, usd_value, &tx_hash).await;
    }

    let store = battleship_store().read().await;
    let game = store
        .games
        .get(&game_id)
        .ok_or_else(|| AppError::BadRequest("Game not found after response".to_string()))?;

    let response = FireShotResponse {
        game_id: game_id_string(game_id),
        status: game.status.as_str().to_string(),
        message: if game.status == GameStatus::Finished {
            "Shot resolved and game finished.".to_string()
        } else if final_is_hit {
            "Wrong defense. Your ship was burned.".to_string()
        } else if shot_has_ship && defense_success {
            "Defense success. Incoming shot was blocked.".to_string()
        } else {
            "Shot missed. No ship burned.".to_string()
        },
        is_hit: Some(final_is_hit),
        pending_response: game.pending_shot.is_some(),
        next_turn: game.current_turn.clone(),
        winner: game.winner.clone(),
        tx_hash: Some(tx_hash),
        onchain_calls: None,
        requires_wallet_signature: false,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// POST /api/v1/battleship/claim-timeout
pub async fn claim_timeout(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ClaimTimeoutRequest>,
) -> Result<Json<ApiResponse<GameActionResponse>>> {
    let user = require_starknet_user(&headers, &state).await?;
    let game_id = parse_game_id(&req.game_id)?;
    let contract = battleship_contract_address(&state)?;
    ensure_battleship_contract_abi(&state, contract).await?;

    if req
        .onchain_tx_hash
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        let call = build_timeout_wallet_call(contract, game_id);
        let response = prepared_action_response(
            game_id_string(game_id),
            "Sign claim_timeout transaction in wallet.",
            vec![call],
        );
        return Ok(Json(ApiResponse::success(response)));
    }

    let tx_hash = normalize_onchain_tx_hash(req.onchain_tx_hash.as_deref())?
        .ok_or_else(|| AppError::BadRequest("onchain_tx_hash is required".to_string()))?;

    let (_block_number, _call, _receipt) =
        verify_battleship_tx_call(&state, &tx_hash, &user, "claim_timeout", |call| {
            if call.calldata.is_empty() {
                return Err(AppError::BadRequest(
                    "claim_timeout calldata is too short".to_string(),
                ));
            }
            if felt_to_u64(&call.calldata[0], "game_id")? != game_id {
                return Err(AppError::BadRequest(
                    "claim_timeout game_id does not match request".to_string(),
                ));
            }
            Ok(())
        })
        .await?;

    let onchain = read_onchain_game_state(&state, game_id).await?;

    {
        let mut store = battleship_store().write().await;
        upsert_game_from_chain(&mut store, game_id, &onchain);
        let game = game_from_store_mut(&mut store, game_id)?;
        game.last_action_at = now_unix();
    }

    if let Some(winner) = onchain.winner.as_ref() {
        if addr_eq(winner, &user) {
            let _ = save_battle_transaction(
                &state,
                &user,
                TX_BATTLE_TIMEOUT_WIN,
                POINTS_BATTLE_TIMEOUT_WIN,
                &tx_hash,
            )
            .await;
            let loser = if addr_eq(&onchain.player_a, winner) {
                onchain.player_b.clone()
            } else {
                onchain.player_a.clone()
            };
            let _ = save_battle_transaction(
                &state,
                &loser,
                TX_BATTLE_LOSS,
                POINTS_BATTLE_LOSS,
                &tx_hash,
            )
            .await;
        }
    }

    let response = GameActionResponse {
        game_id: game_id_string(game_id),
        status: onchain.status.as_str().to_string(),
        message: "Timeout claimed on-chain.".to_string(),
        tx_hash: Some(tx_hash),
        onchain_calls: None,
        requires_wallet_signature: false,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// GET /api/v1/battleship/state/:game_id
pub async fn get_state(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(game_id): Path<String>,
) -> Result<Json<ApiResponse<BattleshipGameStateResponse>>> {
    let user = require_starknet_user(&headers, &state).await?;
    let game_id_u64 = parse_game_id(&game_id)?;

    let onchain = read_onchain_game_state(&state, game_id_u64).await?;
    let mut store = battleship_store().write().await;
    upsert_game_from_chain(&mut store, game_id_u64, &onchain);

    let game = store
        .games
        .get(&game_id_u64)
        .ok_or_else(|| AppError::BadRequest("Game not found".to_string()))?;
    let response = build_state_response(game, &user)?;
    Ok(Json(ApiResponse::success(response)))
}

#[cfg(test)]
mod tests {
    use super::addr_eq;

    #[test]
    fn addr_eq_matches_same_value_in_hex_and_decimal() {
        assert!(addr_eq("0x1234", "4660"));
    }

    #[test]
    fn addr_eq_matches_when_hex_has_leading_zeroes() {
        assert!(addr_eq("0x000abc", "0xabc"));
    }

    #[test]
    fn addr_eq_rejects_different_values() {
        assert!(!addr_eq("0xabc", "0xabd"));
    }
}
