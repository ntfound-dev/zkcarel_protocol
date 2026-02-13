use crate::{config::Config, constants::EPOCH_DURATION_SECONDS, db::Database, error::Result};
use rust_decimal::prelude::{FromPrimitive, ToPrimitive};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

fn normalize_swap_delimiters(text: &str) -> String {
    text.to_lowercase().replace("->", " to ")
}

fn normalize_token_symbol(word: &str) -> Option<&'static str> {
    match word {
        "btc" | "bitcoin" | "wbtc" => Some("BTC"),
        "eth" | "ethereum" | "weth" => Some("ETH"),
        "strk" | "starknet" => Some("STRK"),
        "carel" => Some("CAREL"),
        "usdt" | "tether" => Some("USDT"),
        "usdc" => Some("USDC"),
        _ => None,
    }
}

fn tokenize_words(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|token| !token.is_empty())
        .map(|token| token.to_ascii_lowercase())
        .collect()
}

fn extract_token_from_text(text: &str) -> String {
    let normalized = normalize_swap_delimiters(text);
    for word in tokenize_words(&normalized) {
        if let Some(symbol) = normalize_token_symbol(word.as_str()) {
            return symbol.to_string();
        }
    }
    "".to_string()
}

fn extract_swap_tokens(text: &str) -> Vec<String> {
    let normalized = normalize_swap_delimiters(text);
    let mut found = Vec::new();
    for word in tokenize_words(&normalized) {
        if let Some(symbol) = normalize_token_symbol(word.as_str()) {
            if found
                .last()
                .map(|last: &String| last != symbol)
                .unwrap_or(true)
            {
                found.push(symbol.to_string());
            }
        }
    }
    found
}

fn parse_swap_parameters(text: &str) -> (String, String, f64) {
    let normalized = normalize_swap_delimiters(text);
    let words = tokenize_words(&normalized);
    let mentioned_tokens = extract_swap_tokens(&normalized);
    let mut from = String::new();
    let mut to = String::new();

    for idx in 0..words.len() {
        match words[idx].as_str() {
            "from" | "dari" => {
                if let Some(next) = words.get(idx + 1) {
                    if let Some(symbol) = normalize_token_symbol(next) {
                        from = symbol.to_string();
                    }
                }
            }
            "to" | "ke" | "into" => {
                if let Some(next) = words.get(idx + 1) {
                    if let Some(symbol) = normalize_token_symbol(next) {
                        to = symbol.to_string();
                    }
                }
            }
            _ => {}
        }
    }

    if from.is_empty() {
        if let Some(first) = mentioned_tokens.first() {
            from = first.clone();
        }
    }

    if to.is_empty() {
        for token in &mentioned_tokens {
            if token != &from {
                to = token.clone();
                break;
            }
        }
    }

    if from == to {
        to.clear();
    }

    (from, to, extract_amount_from_text(&normalized))
}

fn contains_any_keyword(text: &str, keywords: &[&str]) -> bool {
    keywords.iter().any(|keyword| text.contains(keyword))
}

fn fallback_price_for(token: &str) -> f64 {
    match token {
        "USDT" | "USDC" => 1.0,
        _ => 0.0,
    }
}

fn extract_amount_from_text(text: &str) -> f64 {
    text.split_whitespace()
        .find_map(|word| {
            let cleaned: String = word
                .chars()
                .filter(|ch| ch.is_ascii_digit() || *ch == '.' || *ch == ',')
                .collect();
            if cleaned.is_empty() {
                return None;
            }
            let normalized = if cleaned.contains(',') && !cleaned.contains('.') {
                cleaned.replace(',', ".")
            } else {
                cleaned.replace(',', "")
            };
            normalized.parse::<f64>().ok().filter(|value| *value > 0.0)
        })
        .unwrap_or(0.0)
}

fn parse_intent_from_command(command: &str) -> Intent {
    let command_lower = command.to_lowercase();

    if contains_any_keyword(&command_lower, &["swap", "exchange", "tukar"]) {
        let (from, to, amount) = parse_swap_parameters(&command_lower);
        Intent {
            action: "swap".to_string(),
            parameters: serde_json::json!({
                "from": from,
                "to": to,
                "amount": amount,
            }),
        }
    } else if contains_any_keyword(
        &command_lower,
        &["balance", "saldo", "portfolio", "aset", "asset", "how much"],
    ) {
        Intent {
            action: "check_balance".to_string(),
            parameters: serde_json::json!({}),
        }
    } else if contains_any_keyword(
        &command_lower,
        &["points", "point", "poin", "reward", "rewards"],
    ) {
        Intent {
            action: "check_points".to_string(),
            parameters: serde_json::json!({}),
        }
    } else if contains_any_keyword(&command_lower, &["stake", "staking"]) {
        Intent {
            action: "stake".to_string(),
            parameters: serde_json::json!({
                "token": extract_token_from_text(&command_lower),
                "amount": extract_amount_from_text(&command_lower),
            }),
        }
    } else if contains_any_keyword(
        &command_lower,
        &["market", "analysis", "analisa", "analyze"],
    ) {
        Intent {
            action: "market_analysis".to_string(),
            parameters: serde_json::json!({
                "token": extract_token_from_text(&command_lower),
            }),
        }
    } else {
        Intent {
            action: "unknown".to_string(),
            parameters: serde_json::json!({}),
        }
    }
}

/// AI Service - Integrates with OpenAI for AI assistant features
pub struct AIService {
    db: Database,
    config: Config,
}

impl AIService {
    pub fn new(db: Database, config: Config) -> Self {
        Self { db, config }
    }

    /// Execute AI command
    pub async fn execute_command(&self, user_address: &str, command: &str) -> Result<AIResponse> {
        let _openai_enabled = self.config.openai_api_key.is_some();
        // Parse user intent
        let intent = self.parse_intent(command).await?;

        // Execute based on intent
        let response = match intent.action.as_str() {
            "swap" => self.execute_swap_command(&intent).await?,
            "check_balance" => self.execute_balance_command(user_address).await?,
            "check_points" => self.execute_points_command(user_address).await?,
            "stake" => self.execute_stake_command(&intent).await?,
            "market_analysis" => self.execute_market_analysis(&intent).await?,
            _ => AIResponse {
                message:
                    "I'm not sure what you want to do. Try asking about swaps, balances, or points."
                        .to_string(),
                actions: vec![],
                data: None,
            },
        };

        Ok(response)
    }

    /// Parse user intent using OpenAI (placeholder: keyword matching)
    async fn parse_intent(&self, command: &str) -> Result<Intent> {
        Ok(parse_intent_from_command(command))
    }

    async fn execute_swap_command(&self, intent: &Intent) -> Result<AIResponse> {
        let from = intent
            .parameters
            .get("from")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let to = intent
            .parameters
            .get("to")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let amount = intent
            .parameters
            .get("amount")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);

        if from.is_empty() || to.is_empty() || amount == 0.0 || from == to {
            return Ok(AIResponse {
                message: "I need swap details in this format: swap <amount> <FROM> to <TO>. Example: swap 25 STRK to CAREL".to_string(),
                actions: vec![],
                data: None,
            });
        }

        Ok(AIResponse {
            message: format!(
                "I'll help you swap {} {} to {}. Let me get the best rate...",
                amount, from, to
            ),
            actions: vec!["get_swap_quote".to_string()],
            data: Some(serde_json::json!({
                "from_token": from,
                "to_token": to,
                "amount": amount,
            })),
        })
    }

    async fn execute_balance_command(&self, user_address: &str) -> Result<AIResponse> {
        let assets = self.fetch_portfolio_assets(user_address).await?;
        if assets.is_empty() {
            return Ok(AIResponse {
                message:
                    "Belum ada data portfolio. Lakukan transaksi on-chain dulu, lalu cek lagi."
                        .to_string(),
                actions: vec!["open_portfolio".to_string()],
                data: Some(serde_json::json!({
                    "total_usd": 0.0,
                    "assets": [],
                })),
            });
        }

        let total_usd: f64 = assets.iter().map(|asset| asset.value_usd).sum();
        let top_assets = assets
            .iter()
            .take(3)
            .map(|asset| format!("{} {:.4}", asset.token, asset.amount))
            .collect::<Vec<_>>()
            .join(", ");

        Ok(AIResponse {
            message: format!(
                "Portfolio {} sekitar ${:.2}. Top aset: {}.",
                user_address, total_usd, top_assets
            ),
            actions: vec!["show_balance".to_string()],
            data: Some(serde_json::json!({
                "total_usd": total_usd,
                "assets": assets,
            })),
        })
    }

    async fn execute_points_command(&self, user_address: &str) -> Result<AIResponse> {
        let epoch = (chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS) as i64;

        let points = self.db.get_user_points(user_address, epoch).await?;

        let total = points
            .as_ref()
            .map(|p| p.total_points.to_string().parse::<f64>().unwrap_or(0.0))
            .unwrap_or(0.0);

        let total_points_epoch: Decimal = sqlx::query_scalar(
            "SELECT COALESCE(SUM(total_points), 0) FROM points WHERE epoch = $1",
        )
        .bind(epoch)
        .fetch_one(self.db.pool())
        .await?;

        let estimated_carel = estimate_carel_from_points(
            Decimal::from_f64_retain(total).unwrap_or(Decimal::ZERO),
            total_points_epoch,
        )
        .to_f64()
        .unwrap_or(0.0);

        Ok(AIResponse {
            message: format!("You have {} points this epoch! 🎉", total),
            actions: vec!["show_points_breakdown".to_string()],
            data: Some(serde_json::json!({
                "total_points": total,
                "estimated_carel": estimated_carel,
            })),
        })
    }

    async fn execute_stake_command(&self, intent: &Intent) -> Result<AIResponse> {
        // Use intent parameters (if provided) to craft a more useful reply
        let token = intent
            .parameters
            .get("token")
            .and_then(|v| v.as_str())
            .unwrap_or("the token");
        let amount = intent
            .parameters
            .get("amount")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);

        let message = if amount > 0.0 && !token.is_empty() {
            format!(
                "Staking {} {} will help you earn rewards and boost your points!",
                amount, token
            )
        } else {
            "Staking will help you earn rewards and boost your points!".to_string()
        };

        Ok(AIResponse {
            message,
            actions: vec!["show_staking_pools".to_string()],
            data: None,
        })
    }

    async fn execute_market_analysis(&self, intent: &Intent) -> Result<AIResponse> {
        // Optionally use token parameter if provided
        let token_opt = intent.parameters.get("token").and_then(|v| v.as_str());

        let message = if let Some(token) = token_opt {
            format!("Based on current market conditions, {} is showing interesting signals. Here's a high-level summary...", token)
        } else {
            "Based on current market conditions, BTC is showing bullish momentum...".to_string()
        };

        Ok(AIResponse {
            message,
            actions: vec!["show_chart".to_string()],
            data: None,
        })
    }

    async fn fetch_portfolio_assets(&self, user_address: &str) -> Result<Vec<PortfolioAsset>> {
        let rows = sqlx::query_as::<_, PortfolioAssetRow>(
            r#"
            SELECT token, SUM(amount)::FLOAT8 as amount
            FROM (
                SELECT UPPER(token_out) as token, COALESCE(CAST(amount_out AS FLOAT8), 0) as amount
                FROM transactions
                WHERE user_address = $1 AND token_out IS NOT NULL AND COALESCE(is_private, false) = false
                UNION ALL
                SELECT UPPER(token_in) as token, -COALESCE(CAST(amount_in AS FLOAT8), 0) as amount
                FROM transactions
                WHERE user_address = $1 AND token_in IS NOT NULL AND COALESCE(is_private, false) = false
            ) t
            GROUP BY token
            HAVING SUM(amount) > 0
            ORDER BY SUM(amount) DESC
            LIMIT 10
            "#,
        )
        .bind(user_address)
        .fetch_all(self.db.pool())
        .await?;

        let mut assets = Vec::with_capacity(rows.len());
        for row in rows {
            let price = self.latest_price_for(&row.token).await?;
            assets.push(PortfolioAsset {
                token: row.token,
                amount: row.amount,
                price,
                value_usd: row.amount * price,
            });
        }
        Ok(assets)
    }

    async fn latest_price_for(&self, token: &str) -> Result<f64> {
        let latest: Option<f64> = sqlx::query_scalar(
            "SELECT close::FLOAT8 FROM price_history WHERE token = $1 ORDER BY timestamp DESC LIMIT 1",
        )
        .bind(token)
        .fetch_optional(self.db.pool())
        .await?;
        Ok(latest.unwrap_or_else(|| fallback_price_for(token)))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Intent {
    pub action: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct AIResponse {
    pub message: String,
    pub actions: Vec<String>,
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
struct PortfolioAsset {
    token: String,
    amount: f64,
    price: f64,
    value_usd: f64,
}

#[derive(Debug, FromRow)]
struct PortfolioAssetRow {
    token: String,
    amount: f64,
}

fn monthly_ecosystem_pool_carel() -> Decimal {
    let total_supply = Decimal::from_i64(1_000_000_000).unwrap();
    let bps = Decimal::from_i64(4000).unwrap();
    let denom = Decimal::from_i64(10000).unwrap();
    let months = Decimal::from_i64(36).unwrap();
    total_supply * bps / denom / months
}

fn estimate_carel_from_points(points: Decimal, total_points: Decimal) -> Decimal {
    if total_points.is_zero() {
        return Decimal::ZERO;
    }
    (points / total_points) * monthly_ecosystem_pool_carel()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_token_from_text_detects_eth() {
        // Memastikan token ETH terdeteksi dari teks
        let token = extract_token_from_text("swap eth to usdt");
        assert_eq!(token, "ETH");
    }

    #[test]
    fn extract_amount_from_text_reads_number() {
        // Memastikan angka pertama diambil dari teks
        let amount = extract_amount_from_text("swap 12.5 eth");
        assert!((amount - 12.5).abs() < f64::EPSILON);
    }

    #[test]
    fn parse_intent_from_command_sets_action() {
        // Memastikan intent swap dikenali
        let intent = parse_intent_from_command("please swap 1 btc to eth");
        assert_eq!(intent.action, "swap");
    }

    #[test]
    fn parse_swap_parameters_reads_from_and_to() {
        // Memastikan token asal dan tujuan swap terdeteksi benar
        let (from, to, amount) = parse_swap_parameters("swap 25 strk to carel");
        assert_eq!(from, "STRK");
        assert_eq!(to, "CAREL");
        assert!((amount - 25.0).abs() < f64::EPSILON);
    }

    #[test]
    fn parse_swap_parameters_supports_indonesian_keyword() {
        // Memastikan format "ke" juga terbaca untuk token tujuan
        let (from, to, amount) = parse_swap_parameters("tukar 10 usdt ke strk");
        assert_eq!(from, "USDT");
        assert_eq!(to, "STRK");
        assert!((amount - 10.0).abs() < f64::EPSILON);
    }

    #[test]
    fn extract_amount_from_text_supports_decimal_comma() {
        // Memastikan angka dengan koma tetap bisa diparse
        let amount = extract_amount_from_text("swap 1,5 strk to carel");
        assert!((amount - 1.5).abs() < f64::EPSILON);
    }
}
