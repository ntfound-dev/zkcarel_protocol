use dotenv::dotenv;
use reqwest::Client;
use serde::Deserialize;
use starknet::{
    accounts::{Account, ExecutionEncoding, SingleOwnerAccount},
    core::{
        types::{Call, Felt},
        utils::get_selector_from_name,
    },
    providers::jsonrpc::{HttpTransport, JsonRpcClient},
    signers::{LocalWallet, SigningKey},
};
use std::{
    collections::{HashMap, HashSet},
    env,
    time::Duration,
};
use tokio::time;
use tracing::{error, info, warn};
use url::Url;

const BTC_VAULT_ADDRESS: &str = "tb1qreplace_with_your_vault_address";
const COINGECKO_API: &str =
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";
const MEMPOOL_TESTNET_API_BASE: &str = "https://mempool.space/testnet/api/address";

const POLL_INTERVAL_SECS: u64 = 30;
const MIN_USD_THRESHOLD: f64 = 50.0;
const POINTS_PER_USD: f64 = 15.0;
const POINT_DECIMALS_FACTOR: f64 = 1_000_000_000_000_000_000.0; // 1e18

#[derive(Debug, Clone)]
struct BridgeWatcherConfig {
    btc_vault_address: String,
    coingecko_api: String,
    point_token_address: String,
    starknet_rpc_url: String,
    starknet_chain_id: String,
    admin_private_key: String,
    admin_account_address: String,
    default_starknet_recipient: Option<String>,
    btc_to_starknet_map: HashMap<String, String>,
}

impl BridgeWatcherConfig {
    fn from_env() -> anyhow::Result<Self> {
        let btc_vault_address =
            env::var("BTC_VAULT_ADDRESS").unwrap_or_else(|_| BTC_VAULT_ADDRESS.to_string());
        if btc_vault_address == BTC_VAULT_ADDRESS {
            warn!(
                "BTC_VAULT_ADDRESS is still default placeholder; set env BTC_VAULT_ADDRESS for production."
            );
        }

        let coingecko_api =
            env::var("BTC_PRICE_API_URL").unwrap_or_else(|_| COINGECKO_API.to_string());
        let point_token_address = env::var("POINT_TOKEN_ADDRESS")
            .or_else(|_| env::var("POINT_TOKEN_CONTRACT_ADDRESS"))
            .or_else(|_| env::var("POINT_STORAGE_ADDRESS"))
            .map_err(|_| {
                anyhow::anyhow!(
                    "Missing POINT_TOKEN_ADDRESS, POINT_TOKEN_CONTRACT_ADDRESS, or POINT_STORAGE_ADDRESS in env."
                )
            })?;
        let starknet_rpc_url = env::var("STARKNET_RPC_URL")
            .map_err(|_| anyhow::anyhow!("Missing STARKNET_RPC_URL in env."))?;
        let starknet_chain_id =
            env::var("STARKNET_CHAIN_ID").unwrap_or_else(|_| "SN_SEPOLIA".to_string());
        let admin_private_key = env::var("BRIDGE_ADMIN_PRIVATE_KEY")
            .or_else(|_| env::var("BACKEND_PRIVATE_KEY"))
            .map_err(|_| {
                anyhow::anyhow!("Missing BRIDGE_ADMIN_PRIVATE_KEY (or BACKEND_PRIVATE_KEY) in env.")
            })?;
        let admin_account_address = env::var("BRIDGE_ADMIN_ACCOUNT_ADDRESS")
            .or_else(|_| env::var("BACKEND_ACCOUNT_ADDRESS"))
            .map_err(|_| {
                anyhow::anyhow!(
                    "Missing BRIDGE_ADMIN_ACCOUNT_ADDRESS (or BACKEND_ACCOUNT_ADDRESS)."
                )
            })?;

        let default_starknet_recipient = env::var("DEFAULT_STARKNET_RECIPIENT")
            .ok()
            .map(|v| v.trim().to_string());
        let btc_to_starknet_map =
            parse_btc_to_starknet_map(&env::var("BTC_TO_STARKNET_MAP").unwrap_or_default());

        Ok(Self {
            btc_vault_address,
            coingecko_api,
            point_token_address,
            starknet_rpc_url,
            starknet_chain_id,
            admin_private_key,
            admin_account_address,
            default_starknet_recipient,
            btc_to_starknet_map,
        })
    }
}

struct StarknetPointMinter {
    account: SingleOwnerAccount<JsonRpcClient<HttpTransport>, LocalWallet>,
    point_token_address: Felt,
}

impl StarknetPointMinter {
    fn from_config(config: &BridgeWatcherConfig) -> anyhow::Result<Self> {
        let rpc_url = Url::parse(&config.starknet_rpc_url)
            .map_err(|e| anyhow::anyhow!("Invalid STARKNET_RPC_URL: {e}"))?;
        let provider = JsonRpcClient::new(HttpTransport::new(rpc_url));

        let private_key = parse_felt(&config.admin_private_key)?;
        let account_address = parse_felt(&config.admin_account_address)?;
        let chain_id = parse_chain_id(&config.starknet_chain_id)?;

        let signer = LocalWallet::from_signing_key(SigningKey::from_secret_scalar(private_key));
        let account = SingleOwnerAccount::new(
            provider,
            signer,
            account_address,
            chain_id,
            ExecutionEncoding::New,
        );

        let point_token_address = parse_felt(&config.point_token_address)?;

        Ok(Self {
            account,
            point_token_address,
        })
    }

    async fn mint_points(&self, recipient: &str, amount_low: u128) -> anyhow::Result<Felt> {
        let selector = get_selector_from_name("mint_points")
            .map_err(|e| anyhow::anyhow!("Unable to resolve mint_points selector: {e}"))?;
        let recipient_felt = parse_felt(recipient)?;

        let call = Call {
            to: self.point_token_address,
            selector,
            calldata: vec![recipient_felt, Felt::from(amount_low), Felt::from(0_u8)],
        };

        let tx = self
            .account
            .execute_v3(vec![call])
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("Starknet mint_points invoke failed: {e}"))?;

        Ok(tx.transaction_hash)
    }
}

#[derive(Debug, Deserialize)]
struct CoinGeckoPriceResponse {
    bitcoin: BtcPricePayload,
}

#[derive(Debug, Deserialize)]
struct BtcPricePayload {
    usd: f64,
}

#[derive(Debug, Deserialize)]
struct MempoolTx {
    txid: String,
    status: MempoolTxStatus,
    #[serde(default)]
    vin: Vec<MempoolVin>,
    #[serde(default)]
    vout: Vec<MempoolVout>,
}

#[derive(Debug, Deserialize)]
struct MempoolTxStatus {
    confirmed: bool,
}

#[derive(Debug, Deserialize)]
struct MempoolVin {
    prevout: Option<MempoolPrevout>,
}

#[derive(Debug, Deserialize)]
struct MempoolPrevout {
    scriptpubkey_address: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MempoolVout {
    value: u64,
    scriptpubkey_address: Option<String>,
}

/// Start the Bitcoin->Starknet bridge watcher loop.
///
/// Required env:
/// - `BTC_VAULT_ADDRESS`
/// - `POINT_TOKEN_ADDRESS` (or `POINT_TOKEN_CONTRACT_ADDRESS` / `POINT_STORAGE_ADDRESS`)
/// - `STARKNET_RPC_URL`
/// - `BRIDGE_ADMIN_PRIVATE_KEY` (or `BACKEND_PRIVATE_KEY`)
/// - `BRIDGE_ADMIN_ACCOUNT_ADDRESS` (or `BACKEND_ACCOUNT_ADDRESS`)
///
/// Optional env:
/// - `BTC_PRICE_API_URL` (defaults to CoinGecko simple price endpoint)
/// - `STARKNET_CHAIN_ID` (default `SN_SEPOLIA`)
/// - `BTC_TO_STARKNET_MAP` JSON object (`{"tb1...":"0x..."}`)
/// - `DEFAULT_STARKNET_RECIPIENT` fallback Starknet recipient
pub async fn start_bridge_watcher() {
    dotenv().ok();

    let config = match BridgeWatcherConfig::from_env() {
        Ok(cfg) => cfg,
        Err(err) => {
            error!("Bridge watcher config error: {err}");
            return;
        }
    };

    let minter = match StarknetPointMinter::from_config(&config) {
        Ok(v) => v,
        Err(err) => {
            error!("Bridge watcher Starknet init error: {err}");
            return;
        }
    };

    let client = Client::new();
    let mut processed_txids: HashSet<String> = HashSet::new();
    let mut ticker = time::interval(Duration::from_secs(POLL_INTERVAL_SECS));
    ticker.set_missed_tick_behavior(time::MissedTickBehavior::Delay);

    info!(
        "Bridge watcher started. vault={} interval={}s threshold=${}",
        config.btc_vault_address, POLL_INTERVAL_SECS, MIN_USD_THRESHOLD
    );

    loop {
        ticker.tick().await;
        if let Err(err) = process_once(&client, &config, &minter, &mut processed_txids).await {
            error!("Bridge watcher tick failed: {err}");
        }
    }
}

async fn process_once(
    client: &Client,
    config: &BridgeWatcherConfig,
    minter: &StarknetPointMinter,
    processed_txids: &mut HashSet<String>,
) -> anyhow::Result<()> {
    // Step A: Get BTC/USD price
    let btc_price_usd = fetch_btc_price_usd(client, &config.coingecko_api).await?;

    // Step B: Get tx history for vault
    let txs = fetch_vault_txs(client, &config.btc_vault_address).await?;

    // Step C + D: Process confirmed txs, threshold decision, mint points
    for tx in txs {
        if !tx.status.confirmed {
            continue;
        }
        if processed_txids.contains(&tx.txid) {
            continue;
        }

        let sats_amount = received_sats_for_vault(&tx, &config.btc_vault_address);
        if sats_amount == 0 {
            continue;
        }

        let usd_val = (sats_amount as f64 / 100_000_000.0) * btc_price_usd;
        if usd_val >= MIN_USD_THRESHOLD {
            let point_amount = usd_val * POINTS_PER_USD;
            let point_amount_wei = match points_to_wei(point_amount) {
                Some(v) => v,
                None => {
                    warn!(
                        "Skipped tx {}: point amount overflow/non-finite for usd={:.8}",
                        tx.txid, usd_val
                    );
                    processed_txids.insert(tx.txid);
                    continue;
                }
            };

            let recipient = resolve_starknet_recipient(
                &tx,
                &config.btc_to_starknet_map,
                config.default_starknet_recipient.as_deref(),
            );

            if let Some(recipient_address) = recipient {
                let mint_tx_hash = minter
                    .mint_points(&recipient_address, point_amount_wei)
                    .await?;
                info!(
                    "Success: Deposit ${:.2}. Minted {:.6} Points. txid={} mint_tx={}",
                    usd_val, point_amount, tx.txid, mint_tx_hash
                );
            } else {
                warn!(
                    "Skipped tx {}: no Starknet recipient mapping. Set BTC_TO_STARKNET_MAP or DEFAULT_STARKNET_RECIPIENT.",
                    tx.txid
                );
            }
        } else {
            info!(
                "Ignored: Deposit ${:.2} is below the $50 threshold. Deposit below threshold. txid={}",
                usd_val, tx.txid
            );
        }

        processed_txids.insert(tx.txid);
    }

    Ok(())
}

async fn fetch_btc_price_usd(client: &Client, api_url: &str) -> anyhow::Result<f64> {
    let response = client
        .get(api_url)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to fetch BTC price: {e}"))?
        .error_for_status()
        .map_err(|e| anyhow::anyhow!("BTC price endpoint returned error status: {e}"))?;

    let payload: CoinGeckoPriceResponse = response
        .json()
        .await
        .map_err(|e| anyhow::anyhow!("Invalid BTC price payload: {e}"))?;

    Ok(payload.bitcoin.usd)
}

async fn fetch_vault_txs(client: &Client, vault_address: &str) -> anyhow::Result<Vec<MempoolTx>> {
    let url = format!("{}/{}/txs", MEMPOOL_TESTNET_API_BASE, vault_address);
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to fetch vault txs: {e}"))?
        .error_for_status()
        .map_err(|e| anyhow::anyhow!("Mempool endpoint returned error status: {e}"))?;

    let txs: Vec<MempoolTx> = response
        .json()
        .await
        .map_err(|e| anyhow::anyhow!("Invalid mempool tx payload: {e}"))?;

    Ok(txs)
}

fn received_sats_for_vault(tx: &MempoolTx, vault_address: &str) -> u64 {
    tx.vout
        .iter()
        .filter_map(|vout| {
            let addr = vout.scriptpubkey_address.as_ref()?;
            if addr.eq_ignore_ascii_case(vault_address) {
                Some(vout.value)
            } else {
                None
            }
        })
        .sum()
}

fn resolve_starknet_recipient(
    tx: &MempoolTx,
    btc_to_starknet_map: &HashMap<String, String>,
    default_recipient: Option<&str>,
) -> Option<String> {
    let sender_btc_address = tx
        .vin
        .iter()
        .filter_map(|vin| vin.prevout.as_ref())
        .filter_map(|prevout| prevout.scriptpubkey_address.as_ref())
        .find(|address| !address.trim().is_empty())
        .map(|address| address.trim().to_lowercase());

    if let Some(sender) = sender_btc_address {
        if let Some(mapped) = btc_to_starknet_map.get(&sender) {
            return Some(mapped.clone());
        }
    }

    default_recipient
        .map(|v| v.to_string())
        .filter(|v| !v.trim().is_empty())
}

fn parse_btc_to_starknet_map(raw: &str) -> HashMap<String, String> {
    if raw.trim().is_empty() {
        return HashMap::new();
    }

    match serde_json::from_str::<HashMap<String, String>>(raw) {
        Ok(map) => map
            .into_iter()
            .filter_map(|(btc, starknet)| {
                let btc_key = btc.trim().to_lowercase();
                let starknet_value = starknet.trim().to_string();
                if btc_key.is_empty() || starknet_value.is_empty() {
                    None
                } else {
                    Some((btc_key, starknet_value))
                }
            })
            .collect(),
        Err(err) => {
            warn!("Invalid BTC_TO_STARKNET_MAP JSON (ignored): {err}");
            HashMap::new()
        }
    }
}

fn points_to_wei(point_amount: f64) -> Option<u128> {
    if !point_amount.is_finite() || point_amount <= 0.0 {
        return None;
    }

    let raw = point_amount * POINT_DECIMALS_FACTOR;
    if !raw.is_finite() || raw <= 0.0 || raw > u128::MAX as f64 {
        return None;
    }

    Some(raw.round() as u128)
}

fn parse_chain_id(raw: &str) -> anyhow::Result<Felt> {
    if raw.starts_with("0x") || raw.chars().all(|c| c.is_ascii_digit()) {
        return parse_felt(raw);
    }

    let as_hex = format!("0x{}", hex::encode(raw.as_bytes()));
    parse_felt(&as_hex)
}

fn parse_felt(raw: &str) -> anyhow::Result<Felt> {
    let value = raw.trim();
    if value.is_empty() {
        anyhow::bail!("Empty felt value");
    }

    if value.starts_with("0x") {
        Felt::from_hex(value).map_err(|e| anyhow::anyhow!("Invalid felt hex '{value}': {e}"))
    } else {
        Felt::from_dec_str(value).map_err(|e| anyhow::anyhow!("Invalid felt dec '{value}': {e}"))
    }
}
