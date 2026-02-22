use crate::{
    config::Config,
    constants::EPOCH_DURATION_SECONDS,
    db::Database,
    error::Result,
    services::price_guard::{fallback_price_for, first_sane_price, symbol_candidates_for},
    tokenomics::rewards_distribution_pool_for_environment,
};
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

// Internal helper that parses or transforms values for `normalize_swap_delimiters`.
fn normalize_swap_delimiters(text: &str) -> String {
    text.to_lowercase().replace("->", " to ")
}

// Internal helper that parses or transforms values for `normalize_token_symbol`.
fn normalize_token_symbol(word: &str) -> Option<&'static str> {
    match word {
        "btc" | "bitcoin" => Some("BTC"),
        "wbtc" => Some("WBTC"),
        "eth" | "ethereum" | "weth" => Some("ETH"),
        "strk" | "starknet" => Some("STRK"),
        "carel" => Some("CAREL"),
        "usdt" | "tether" => Some("USDT"),
        "usdc" => Some("USDC"),
        _ => None,
    }
}

// Internal helper that supports `tokenize_words` operations.
fn tokenize_words(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|token| !token.is_empty())
        .map(|token| token.to_ascii_lowercase())
        .collect()
}

// Internal helper that supports `extract_token_from_text` operations.
fn extract_token_from_text(text: &str) -> String {
    let normalized = normalize_swap_delimiters(text);
    for word in tokenize_words(&normalized) {
        if let Some(symbol) = normalize_token_symbol(word.as_str()) {
            return symbol.to_string();
        }
    }
    "".to_string()
}

// Internal helper that supports `extract_swap_tokens` operations.
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

// Internal helper that parses or transforms values for `parse_swap_parameters`.
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

// Internal helper that supports `contains_any_keyword` operations.
fn contains_any_keyword(text: &str, keywords: &[&str]) -> bool {
    keywords.iter().any(|keyword| text.contains(keyword))
}

// Internal helper that supports `contains_any_exact_word` operations.
fn contains_any_exact_word(text: &str, keywords: &[&str]) -> bool {
    let words = tokenize_words(text);
    words
        .iter()
        .any(|word| keywords.iter().any(|keyword| word == keyword))
}

// Internal helper that supports `has_non_empty_value` operations.
fn has_non_empty_value(value: Option<&str>) -> bool {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
}

// Internal helper that supports `extract_text_from_json_pointers` operations.
fn extract_text_from_json_pointers(value: &serde_json::Value, pointers: &[&str]) -> Option<String> {
    pointers.iter().find_map(|pointer| {
        value
            .pointer(pointer)
            .and_then(|entry| entry.as_str())
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string)
    })
}

// Internal helper that supports `detect_locale_from_command` operations.
fn detect_locale_from_command(command_lower: &str) -> &'static str {
    if contains_any_keyword(
        command_lower,
        &[
            "bahasa indonesia",
            "pakai bahasa indonesia",
            "gunakan bahasa indonesia",
            "reply in indonesian",
            "speak indonesian",
            "use indonesian",
        ],
    ) || contains_any_exact_word(command_lower, &["indonesian"])
    {
        "id"
    } else {
        "en"
    }
}

// Internal helper that supports `with_locale` operations.
fn with_locale(mut parameters: serde_json::Value, locale: &str) -> serde_json::Value {
    if let Some(map) = parameters.as_object_mut() {
        map.insert(
            "locale".to_string(),
            serde_json::Value::String(locale.to_string()),
        );
    }
    parameters
}

// Internal helper that supports `locale_from_intent` operations.
fn locale_from_intent(intent: &Intent) -> &str {
    intent
        .parameters
        .get("locale")
        .and_then(|value| value.as_str())
        .unwrap_or("en")
}

// Internal helper that supports `is_indonesian_locale` operations.
fn is_indonesian_locale(locale: &str) -> bool {
    locale.eq_ignore_ascii_case("id")
}

// Internal helper that supports `build_real_execution_system_prompt` operations.
fn build_real_execution_system_prompt(level: u8, locale: &str) -> String {
    let language_rule = if is_indonesian_locale(locale) {
        "Reply in Indonesian."
    } else {
        "Reply in English."
    };

    format!(
        "You are CAREL AI Assistant, a DeFi execution agent on CAREL platform.\n\
         You do NOT simulate. For on-chain operations, treat execution as REAL after user wallet confirmation.\n\
         ACCESS LEVELS:\n\
         - Level 1: chat + read-only (price, balance, points, market)\n\
         - Level 2: real swap, bridge, stake, claim rewards, limit order after one Auto Setup On-Chain\n\
         - Level 3: same commands in Garaga/private mode + unstake, portfolio rebalance, alerts, and complex analysis\n\
         CURRENT USER LEVEL: {level}\n\
         ON-CHAIN RULES:\n\
         - Never execute without wallet confirmation.\n\
         - Ask confirmation before execution (example: 'You're about to swap X -> Y. Confirm?').\n\
         - If level is insufficient, explain required level upgrade clearly.\n\
         - If setup is missing, tell user to click Auto Setup On-Chain once.\n\
         RESPONSE STYLE:\n\
         - Answer user intent first, then next action.\n\
         - Friendly, clear, conversational. Avoid robotic template repetition.\n\
         - Never repeat tutorial/menu unless user explicitly asks for tutorial/help.\n\
         {language_rule}\n\
         Return plain text only."
    )
}

// Internal helper that supports `build_real_execution_user_prompt` operations.
fn build_real_execution_user_prompt(
    level: u8,
    user_address: &str,
    command: &str,
    intent: &Intent,
    fallback: &AIResponse,
) -> String {
    let onchain_setup = if level >= 2
        && matches!(
            intent.action.as_str(),
            "swap"
                | "bridge"
                | "stake"
                | "unstake"
                | "claim_staking_rewards"
                | "limit_order_create"
                | "limit_order_cancel"
                | "portfolio_management"
                | "alerts"
        ) {
        "true (validated by backend for current request)"
    } else if level >= 2 {
        "unknown (not required for this intent)"
    } else {
        "not_required_level_1"
    };
    let carel_balance = fallback
        .data
        .as_ref()
        .and_then(|data| data.get("carel_balance"))
        .map(|value| value.to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let user_points = fallback
        .data
        .as_ref()
        .and_then(|data| data.get("total_points"))
        .map(|value| value.to_string())
        .unwrap_or_else(|| "unknown".to_string());

    format!(
        "USER CONTEXT:\n\
         - User Level: {level}\n\
         - Wallet Address: {user_address}\n\
         - On-chain Setup Done: {onchain_setup}\n\
         - CAREL Balance: {carel_balance}\n\
         - Current Epoch Points: {user_points}\n\
         Parsed intent: {}\n\
         User command: {command}\n\
         Deterministic fallback: {}\n\
         Keep it concise (max 120 words).",
        intent.action, fallback.message
    )
}

// Internal helper that supports `extract_amount_from_text` operations.
fn extract_amount_from_text(text: &str) -> f64 {
    // Internal helper that parses or transforms values for `parse_numeric_word`.
    fn parse_numeric_word(word: &str) -> Option<f64> {
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
    }

    text.split_whitespace()
        .find_map(parse_numeric_word)
        .unwrap_or(0.0)
}

// Internal helper that supports `extract_price_from_text` operations.
fn extract_price_from_text(text: &str) -> f64 {
    let words: Vec<&str> = text.split_whitespace().collect();
    for idx in 0..words.len() {
        let marker = words[idx].trim().to_ascii_lowercase();
        if marker == "at" || marker == "price" || marker == "@" {
            if let Some(next) = words.get(idx + 1) {
                let value = extract_amount_from_text(next);
                if value > 0.0 {
                    return value;
                };
            }
        }
    }
    0.0
}

// Internal helper that supports `extract_expiry_from_text` operations.
fn extract_expiry_from_text(text: &str) -> String {
    let lower = text.to_ascii_lowercase();
    if lower.contains("30d") || lower.contains("30 days") {
        return "30d".to_string();
    }
    if lower.contains("1d") || lower.contains("1 day") || lower.contains("24h") {
        return "1d".to_string();
    }
    "7d".to_string()
}

// Internal helper that parses or transforms values for `parse_limit_order_parameters`.
fn parse_limit_order_parameters(text: &str) -> (String, String, f64, f64, String) {
    let (from, to, amount) = parse_swap_parameters(text);
    let price = extract_price_from_text(text);
    let expiry = extract_expiry_from_text(text);
    (from, to, amount, price, expiry)
}

// Internal helper that parses or transforms values for `parse_intent_from_command`.
fn parse_intent_from_command(command: &str) -> Intent {
    let command_lower = command.to_lowercase();
    let locale = detect_locale_from_command(&command_lower);

    if contains_any_keyword(
        &command_lower,
        &["cancel order", "cancel limit", "batalkan order"],
    ) {
        Intent {
            action: "limit_order_cancel".to_string(),
            parameters: with_locale(serde_json::json!({}), locale),
        }
    } else if contains_any_keyword(
        &command_lower,
        &["limit order", "place order", "buat order"],
    ) {
        let (from, to, amount, price, expiry) = parse_limit_order_parameters(&command_lower);
        Intent {
            action: "limit_order_create".to_string(),
            parameters: with_locale(
                serde_json::json!({
                    "from": from,
                    "to": to,
                    "amount": amount,
                    "price": price,
                    "expiry": expiry,
                }),
                locale,
            ),
        }
    } else if contains_any_keyword(
        &command_lower,
        &[
            "claim rewards",
            "claim reward",
            "claim staking",
            "klaim reward",
            "klaim staking",
        ],
    ) {
        Intent {
            action: "claim_staking_rewards".to_string(),
            parameters: with_locale(
                serde_json::json!({
                    "token": extract_token_from_text(&command_lower),
                }),
                locale,
            ),
        }
    } else if contains_any_keyword(
        &command_lower,
        &["unstake", "withdraw stake", "cabut stake"],
    ) {
        Intent {
            action: "unstake".to_string(),
            parameters: with_locale(
                serde_json::json!({
                    "token": extract_token_from_text(&command_lower),
                    "amount": extract_amount_from_text(&command_lower),
                }),
                locale,
            ),
        }
    } else if contains_any_keyword(&command_lower, &["swap", "exchange", "tukar"]) {
        let (from, to, amount) = parse_swap_parameters(&command_lower);
        Intent {
            action: "swap".to_string(),
            parameters: with_locale(
                serde_json::json!({
                    "from": from,
                    "to": to,
                    "amount": amount,
                }),
                locale,
            ),
        }
    } else if contains_any_keyword(&command_lower, &["bridge", "brigde", "jembatan"]) {
        let (from, to, amount) = parse_swap_parameters(&command_lower);
        Intent {
            action: "bridge".to_string(),
            parameters: with_locale(
                serde_json::json!({
                    "from": from,
                    "to": to,
                    "amount": amount,
                }),
                locale,
            ),
        }
    } else if contains_any_keyword(
        &command_lower,
        &[
            "portfolio management",
            "manage portfolio",
            "rebalance",
            "allocation",
            "alokasi",
        ],
    ) {
        Intent {
            action: "portfolio_management".to_string(),
            parameters: with_locale(serde_json::json!({}), locale),
        }
    } else if contains_any_keyword(
        &command_lower,
        &["alert", "alerts", "notifikasi", "reminder", "peringatan"],
    ) {
        Intent {
            action: "alerts".to_string(),
            parameters: with_locale(serde_json::json!({}), locale),
        }
    } else if contains_any_keyword(
        &command_lower,
        &[
            "bahasa indonesia",
            "bahasa indo",
            "bhs indo",
            "pakai bahasa indonesia",
            "bahsa indo",
        ],
    ) {
        Intent {
            action: "set_language_indonesian".to_string(),
            parameters: with_locale(serde_json::json!({}), "id"),
        }
    } else if contains_any_keyword(
        &command_lower,
        &[
            "english",
            "speak english",
            "use english",
            "bahasa inggris",
            "pakai inggris",
            "inggris saja",
        ],
    ) {
        Intent {
            action: "set_language_english".to_string(),
            parameters: with_locale(serde_json::json!({}), "en"),
        }
    } else if contains_any_keyword(&command_lower, &["price", "harga"]) {
        Intent {
            action: "check_price".to_string(),
            parameters: with_locale(
                serde_json::json!({
                    "token": extract_token_from_text(&command_lower),
                }),
                locale,
            ),
        }
    } else if contains_any_keyword(
        &command_lower,
        &["balance", "saldo", "portfolio", "aset", "asset", "how much"],
    ) {
        Intent {
            action: "check_balance".to_string(),
            parameters: with_locale(serde_json::json!({}), locale),
        }
    } else if contains_any_keyword(
        &command_lower,
        &["points", "point", "poin", "reward", "rewards"],
    ) {
        Intent {
            action: "check_points".to_string(),
            parameters: with_locale(serde_json::json!({}), locale),
        }
    } else if contains_any_keyword(&command_lower, &["stake", "staking"]) {
        Intent {
            action: "stake".to_string(),
            parameters: with_locale(
                serde_json::json!({
                    "token": extract_token_from_text(&command_lower),
                    "amount": extract_amount_from_text(&command_lower),
                }),
                locale,
            ),
        }
    } else if contains_any_keyword(
        &command_lower,
        &["market", "analysis", "analisa", "analyze"],
    ) {
        Intent {
            action: "market_analysis".to_string(),
            parameters: with_locale(
                serde_json::json!({
                    "token": extract_token_from_text(&command_lower),
                }),
                locale,
            ),
        }
    } else if contains_any_keyword(
        &command_lower,
        &["tutorial", "guide", "how to use", "pemula", "panduan"],
    ) {
        Intent {
            action: "tutorial".to_string(),
            parameters: with_locale(serde_json::json!({}), locale),
        }
    } else if contains_any_keyword(
        &command_lower,
        &[
            "who are you",
            "kamu siapa",
            "siapa kamu",
            "can you help",
            "bisa bantu",
            "help me",
            "tolong",
            "thanks",
            "thank you",
            "makasih",
            "terima kasih",
            "oke",
            "ok",
            "ngobrol",
            "chat",
        ],
    ) {
        Intent {
            action: "chat_general".to_string(),
            parameters: with_locale(
                serde_json::json!({
                    "query": command_lower,
                }),
                locale,
            ),
        }
    } else if contains_any_exact_word(&command_lower, &["hello", "hi", "hey", "halo", "hai"]) {
        Intent {
            action: "chat_greeting".to_string(),
            parameters: with_locale(serde_json::json!({}), locale),
        }
    } else {
        Intent {
            action: "unknown".to_string(),
            parameters: with_locale(serde_json::json!({}), locale),
        }
    }
}

#[derive(Debug, Serialize)]
struct GeminiGenerateRequest {
    contents: Vec<GeminiContent>,
    #[serde(rename = "generationConfig")]
    generation_config: GeminiGenerationConfig,
}

#[derive(Debug, Serialize)]
struct GeminiGenerationConfig {
    temperature: f64,
    #[serde(rename = "maxOutputTokens")]
    max_output_tokens: u32,
}

#[derive(Debug, Serialize)]
struct GeminiContent {
    parts: Vec<GeminiPart>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GeminiPart {
    text: String,
}

#[derive(Debug, Deserialize)]
struct GeminiGenerateResponse {
    candidates: Option<Vec<GeminiCandidate>>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiResponseContent>,
}

#[derive(Debug, Deserialize)]
struct GeminiResponseContent {
    parts: Option<Vec<GeminiResponsePart>>,
}

#[derive(Debug, Deserialize)]
struct GeminiResponsePart {
    text: Option<String>,
}

const OPENAI_CHAT_COMPLETIONS_URL: &str = "https://api.openai.com/v1/chat/completions";
const OPENAI_DEFAULT_MODEL: &str = "gpt-4o-mini";
const LLM_REWRITE_TIMEOUT_MS_DEFAULT: u64 = 8_000;

#[derive(Debug, Serialize)]
struct CairoCoderChatRequest {
    messages: Vec<OpenAIChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
}

#[derive(Debug, Serialize)]
struct OpenAIChatRequest {
    model: String,
    messages: Vec<OpenAIChatMessage>,
    temperature: f64,
    max_tokens: u32,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenAIChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct OpenAIChatResponse {
    choices: Vec<OpenAIChatChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAIChatChoice {
    message: OpenAIResponseMessage,
}

#[derive(Debug, Deserialize)]
struct OpenAIResponseMessage {
    content: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AIGuardScope {
    ReadOnly,
    SwapBridge,
    PortfolioAlert,
    Unknown,
}

/// Internal helper that supports `has_llm_provider_configured` operations.
pub fn has_llm_provider_configured(config: &Config) -> bool {
    let openai_enabled = has_non_empty_value(config.openai_api_key.as_deref());
    let cairo_enabled = has_non_empty_value(config.cairo_coder_api_key.as_deref())
        && !config.cairo_coder_api_url.trim().is_empty();
    let gemini_enabled = has_non_empty_value(config.gemini_api_key.as_deref())
        && !config.gemini_api_url.trim().is_empty()
        && !config.gemini_model.trim().is_empty();
    openai_enabled || cairo_enabled || gemini_enabled
}

/// Handles `classify_command_scope` logic.
///
/// # Arguments
/// * Uses function parameters as validated input and runtime context.
///
/// # Returns
/// * `Ok(...)` when processing succeeds.
/// * `Err(AppError)` when validation, authorization, or integration checks fail.
///
/// # Notes
/// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
pub fn classify_command_scope(command: &str) -> AIGuardScope {
    let intent = parse_intent_from_command(command);
    match intent.action.as_str() {
        "check_balance"
        | "check_points"
        | "check_price"
        | "market_analysis"
        | "tutorial"
        | "chat_greeting"
        | "chat_general"
        | "set_language_indonesian"
        | "set_language_english" => AIGuardScope::ReadOnly,
        "swap"
        | "bridge"
        | "stake"
        | "claim_staking_rewards"
        | "limit_order_create"
        | "limit_order_cancel" => AIGuardScope::SwapBridge,
        "unstake" | "portfolio_management" | "alerts" => AIGuardScope::PortfolioAlert,
        _ => AIGuardScope::Unknown,
    }
}

/// AI Service - keyword intent + optional LLM rewrite (Gemini/Cairo/OpenAI)
pub struct AIService {
    db: Database,
    config: Config,
}

impl AIService {
    /// Constructs a new instance via `new`.
    ///
    /// # Arguments
    /// * Uses function parameters as validated input and runtime context.
    ///
    /// # Returns
    /// * `Ok(...)` when processing succeeds.
    /// * `Err(AppError)` when validation, authorization, or integration checks fail.
    ///
    /// # Notes
    /// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
    pub fn new(db: Database, config: Config) -> Self {
        Self { db, config }
    }

    /// Execute AI command.
    /// Flow:
    /// 1) intent routing (deterministic)
    /// 2) optional LLM rewrite (Gemini/Cairo/OpenAI if configured)
    pub async fn execute_command(
        &self,
        user_address: &str,
        command: &str,
        level: u8,
    ) -> Result<AIResponse> {
        // Parse user intent
        let intent = self.parse_intent(command).await?;
        let locale = locale_from_intent(&intent);

        // Execute based on intent
        let mut response = match intent.action.as_str() {
            "swap" => self.execute_swap_command(&intent).await?,
            "bridge" => self.execute_bridge_command(&intent).await?,
            "limit_order_create" => self.execute_limit_order_create_command(&intent).await?,
            "limit_order_cancel" => self.execute_limit_order_cancel_command(locale).await?,
            "check_balance" => self.execute_balance_command(user_address, locale).await?,
            "check_points" => self.execute_points_command(user_address, locale).await?,
            "check_price" => self.execute_price_command(&intent).await?,
            "stake" => self.execute_stake_command(&intent).await?,
            "unstake" => self.execute_unstake_command(&intent).await?,
            "claim_staking_rewards" => self.execute_stake_claim_command(&intent).await?,
            "market_analysis" => self.execute_market_analysis(&intent).await?,
            "portfolio_management" => {
                self.execute_portfolio_management_command(user_address, locale)
                    .await?
            }
            "alerts" => self.execute_alerts_command(locale).await?,
            "tutorial" => self.execute_tutorial_command(level, locale).await?,
            "chat_greeting" => self.execute_greeting_command(level, &intent).await?,
            "chat_general" => self.execute_general_chat_command(level, &intent).await?,
            "set_language_indonesian" => self.execute_set_language_indonesian_command().await?,
            "set_language_english" => self.execute_set_language_english_command().await?,
            _ => self.execute_unknown_command(level, locale),
        };

        let should_try_llm_rewrite = matches!(intent.action.as_str(), "unknown");
        if should_try_llm_rewrite {
            let llm_rewrite_timeout_ms = if self.config.ai_llm_rewrite_timeout_ms == 0 {
                LLM_REWRITE_TIMEOUT_MS_DEFAULT
            } else {
                self.config.ai_llm_rewrite_timeout_ms
            };
            match tokio::time::timeout(
                std::time::Duration::from_millis(llm_rewrite_timeout_ms),
                self.generate_with_llm(user_address, command, level, &intent, &response),
            )
            .await
            {
                Ok(Some(llm_text)) => {
                    response.message = llm_text;
                }
                Ok(None) => {}
                Err(_) => {
                    tracing::warn!("LLM rewrite timed out after {}ms", llm_rewrite_timeout_ms);
                }
            }
        }

        Ok(response)
    }

    /// Parse user intent using OpenAI (placeholder: keyword matching)
    async fn parse_intent(&self, command: &str) -> Result<Intent> {
        Ok(parse_intent_from_command(command))
    }

    // Internal helper that builds inputs for `generate_with_llm`.
    async fn generate_with_llm(
        &self,
        user_address: &str,
        command: &str,
        level: u8,
        intent: &Intent,
        fallback: &AIResponse,
    ) -> Option<String> {
        if let Some(text) = self
            .generate_with_cairo_coder(user_address, command, level, intent, fallback)
            .await
        {
            return Some(text);
        }
        if let Some(text) = self
            .generate_with_gemini(user_address, command, level, intent, fallback)
            .await
        {
            return Some(text);
        }
        self.generate_with_openai(user_address, command, level, intent, fallback)
            .await
    }

    // Internal helper that builds inputs for `generate_with_gemini`.
    async fn generate_with_gemini(
        &self,
        user_address: &str,
        command: &str,
        level: u8,
        intent: &Intent,
        fallback: &AIResponse,
    ) -> Option<String> {
        let api_key = self
            .config
            .gemini_api_key
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())?;
        let api_url = self.config.gemini_api_url.trim_end_matches('/');
        let model = self.config.gemini_model.trim();
        if api_url.is_empty() || model.is_empty() {
            return None;
        }

        let locale = locale_from_intent(intent);
        let system_prompt = build_real_execution_system_prompt(level, locale);
        let user_prompt =
            build_real_execution_user_prompt(level, user_address, command, intent, fallback);
        let prompt = format!("SYSTEM:\n{system_prompt}\n\nUSER:\n{user_prompt}");

        let request = GeminiGenerateRequest {
            contents: vec![GeminiContent {
                parts: vec![GeminiPart { text: prompt }],
            }],
            generation_config: GeminiGenerationConfig {
                temperature: 0.2,
                max_output_tokens: 256,
            },
        };

        let url = format!("{api_url}/models/{model}:generateContent?key={api_key}");
        let client = reqwest::Client::new();
        let response = match client
            .post(url)
            .json(&request)
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await
        {
            Ok(value) => value,
            Err(err) => {
                tracing::warn!("Gemini request failed: {}", err);
                return None;
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            tracing::warn!("Gemini returned {}: {}", status, body);
            return None;
        }

        let payload: GeminiGenerateResponse = match response.json().await {
            Ok(value) => value,
            Err(err) => {
                tracing::warn!("Gemini response parse failed: {}", err);
                return None;
            }
        };

        payload
            .candidates
            .unwrap_or_default()
            .into_iter()
            .filter_map(|candidate| candidate.content)
            .flat_map(|content| content.parts.unwrap_or_default())
            .filter_map(|part| part.text.map(|text| text.trim().to_string()))
            .find(|text| !text.is_empty())
    }

    // Internal helper that builds inputs for `generate_with_cairo_coder`.
    async fn generate_with_cairo_coder(
        &self,
        user_address: &str,
        command: &str,
        level: u8,
        intent: &Intent,
        fallback: &AIResponse,
    ) -> Option<String> {
        let api_key = self
            .config
            .cairo_coder_api_key
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())?;
        let api_url = self.config.cairo_coder_api_url.trim();
        if api_url.is_empty() {
            return None;
        }

        let locale = locale_from_intent(intent);
        let system_prompt = build_real_execution_system_prompt(level, locale);
        let user_prompt =
            build_real_execution_user_prompt(level, user_address, command, intent, fallback);

        let request = CairoCoderChatRequest {
            messages: vec![
                OpenAIChatMessage {
                    role: "system".to_string(),
                    content: system_prompt.to_string(),
                },
                OpenAIChatMessage {
                    role: "user".to_string(),
                    content: user_prompt,
                },
            ],
            model: self
                .config
                .cairo_coder_model
                .as_ref()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
        };

        let client = reqwest::Client::new();
        let response = match client
            .post(api_url)
            .header("x-api-key", api_key)
            .json(&request)
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await
        {
            Ok(value) => value,
            Err(err) => {
                tracing::warn!("Cairo Coder request failed: {}", err);
                return None;
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            tracing::warn!("Cairo Coder returned {}: {}", status, body);
            return None;
        }

        let body = match response.text().await {
            Ok(value) => value,
            Err(err) => {
                tracing::warn!("Cairo Coder body read failed: {}", err);
                return None;
            }
        };

        if body.trim().is_empty() {
            return None;
        }

        let parsed_json: serde_json::Value = match serde_json::from_str(&body) {
            Ok(value) => value,
            Err(_) => {
                return Some(body.trim().to_string());
            }
        };

        extract_text_from_json_pointers(
            &parsed_json,
            &[
                "/choices/0/message/content",
                "/data/choices/0/message/content",
                "/data/message/content",
                "/message",
                "/data/message",
                "/response",
                "/output_text",
            ],
        )
    }

    // Internal helper that builds inputs for `generate_with_openai`.
    async fn generate_with_openai(
        &self,
        user_address: &str,
        command: &str,
        level: u8,
        intent: &Intent,
        fallback: &AIResponse,
    ) -> Option<String> {
        let api_key = self
            .config
            .openai_api_key
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())?;
        let locale = locale_from_intent(intent);
        let system_prompt = build_real_execution_system_prompt(level, locale);
        let user_prompt =
            build_real_execution_user_prompt(level, user_address, command, intent, fallback);

        let request = OpenAIChatRequest {
            model: OPENAI_DEFAULT_MODEL.to_string(),
            messages: vec![
                OpenAIChatMessage {
                    role: "system".to_string(),
                    content: system_prompt.to_string(),
                },
                OpenAIChatMessage {
                    role: "user".to_string(),
                    content: user_prompt,
                },
            ],
            temperature: 0.2,
            max_tokens: 256,
        };

        let client = reqwest::Client::new();
        let response = match client
            .post(OPENAI_CHAT_COMPLETIONS_URL)
            .bearer_auth(api_key)
            .json(&request)
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await
        {
            Ok(value) => value,
            Err(err) => {
                tracing::warn!("OpenAI request failed: {}", err);
                return None;
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            tracing::warn!("OpenAI returned {}: {}", status, body);
            return None;
        }

        let payload: OpenAIChatResponse = match response.json().await {
            Ok(value) => value,
            Err(err) => {
                tracing::warn!("OpenAI response parse failed: {}", err);
                return None;
            }
        };

        payload
            .choices
            .into_iter()
            .filter_map(|choice| {
                let text = choice.message.content?.trim().to_string();
                if text.is_empty() {
                    None
                } else {
                    Some(text)
                }
            })
            .next()
    }

    // Internal helper that runs side-effecting logic for `execute_swap_command`.
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
        let locale = locale_from_intent(intent);
        let is_id = is_indonesian_locale(locale);

        if from.is_empty() || to.is_empty() || amount == 0.0 || from == to {
            return Ok(AIResponse {
                message: if is_id {
                    "Saya butuh detail swap dengan format: swap <jumlah> <DARI> ke <TUJUAN>. Contoh: swap 25 STRK ke CAREL".to_string()
                } else {
                    "I need swap details in this format: swap <amount> <FROM> to <TO>. Example: swap 25 STRK to CAREL".to_string()
                },
                actions: vec![],
                data: None,
            });
        }

        Ok(AIResponse {
            message: if is_id {
                format!(
                    "Aksi ini REAL on-chain. Kamu akan swap {} {} ke {}. Konfirmasi dulu: lanjutkan? (ya/tidak)",
                    amount, from, to
                )
            } else {
                format!(
                    "This is a REAL on-chain action. You're about to swap {} {} to {}. Confirm to proceed? (yes/no)",
                    amount, from, to
                )
            },
            actions: vec!["get_swap_quote".to_string()],
            data: Some(serde_json::json!({
                "from_token": from,
                "to_token": to,
                "amount": amount,
                "locale": locale,
            })),
        })
    }

    // Internal helper that runs side-effecting logic for `execute_bridge_command`.
    async fn execute_bridge_command(&self, intent: &Intent) -> Result<AIResponse> {
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
        let locale = locale_from_intent(intent);
        let is_id = is_indonesian_locale(locale);

        if from.is_empty() || to.is_empty() || amount == 0.0 || from == to {
            return Ok(AIResponse {
                message: if is_id {
                    "Saya butuh detail bridge dengan format: bridge <jumlah> <DARI> ke <TUJUAN>. Contoh: bridge 100 USDT ke STRK".to_string()
                } else {
                    "I need bridge details in this format: bridge <amount> <FROM> to <TO>. Example: bridge 100 USDT to STRK".to_string()
                },
                actions: vec![],
                data: None,
            });
        }

        Ok(AIResponse {
            message: if is_id {
                format!(
                    "Aksi ini REAL on-chain. Kamu akan bridge {} {} ke {}. Konfirmasi dulu: lanjutkan? (ya/tidak)",
                    amount, from, to
                )
            } else {
                format!(
                    "This is a REAL on-chain action. You're about to bridge {} {} to {}. Confirm to proceed? (yes/no)",
                    amount, from, to
                )
            },
            actions: vec!["get_bridge_quote".to_string()],
            data: Some(serde_json::json!({
                "from_token": from,
                "to_token": to,
                "amount": amount,
                "locale": locale,
            })),
        })
    }

    // Internal helper that runs side-effecting logic for `execute_balance_command`.
    async fn execute_balance_command(
        &self,
        user_address: &str,
        locale: &str,
    ) -> Result<AIResponse> {
        let is_id = is_indonesian_locale(locale);
        let assets = self.fetch_portfolio_assets(user_address).await?;
        if assets.is_empty() {
            return Ok(AIResponse {
                message: if is_id {
                    "Belum ada data portfolio. Lakukan transaksi on-chain pertama dulu lalu cek lagi."
                        .to_string()
                } else {
                    "No portfolio data yet. Do your first on-chain transaction and check again."
                        .to_string()
                },
                actions: vec!["open_portfolio".to_string()],
                data: Some(serde_json::json!({
                    "total_usd": 0.0,
                    "assets": [],
                    "locale": locale,
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
            message: if is_id {
                format!(
                    "Portfolio {} sekitar ${:.2}. Aset utama: {}.",
                    user_address, total_usd, top_assets
                )
            } else {
                format!(
                    "Portfolio {} is around ${:.2}. Top assets: {}.",
                    user_address, total_usd, top_assets
                )
            },
            actions: vec!["show_balance".to_string()],
            data: Some(serde_json::json!({
                "total_usd": total_usd,
                "assets": assets,
                "locale": locale,
            })),
        })
    }

    // Internal helper that runs side-effecting logic for `execute_points_command`.
    async fn execute_points_command(&self, user_address: &str, locale: &str) -> Result<AIResponse> {
        let is_id = is_indonesian_locale(locale);
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
            rewards_distribution_pool_for_environment(&self.config.environment),
        )
        .to_f64()
        .unwrap_or(0.0);

        Ok(AIResponse {
            message: if is_id {
                format!("Kamu punya {} poin di epoch ini! 🎉", total)
            } else {
                format!("You have {} points this epoch! 🎉", total)
            },
            actions: vec!["show_points_breakdown".to_string()],
            data: Some(serde_json::json!({
                "total_points": total,
                "estimated_carel": estimated_carel,
                "locale": locale,
            })),
        })
    }

    // Internal helper that runs side-effecting logic for `execute_price_command`.
    async fn execute_price_command(&self, intent: &Intent) -> Result<AIResponse> {
        let locale = locale_from_intent(intent);
        let is_id = is_indonesian_locale(locale);
        let token = intent
            .parameters
            .get("token")
            .and_then(|v| v.as_str())
            .filter(|token| !token.trim().is_empty())
            .unwrap_or("STRK")
            .trim()
            .to_uppercase();

        let price = self.latest_price_for(&token).await?;
        if price <= 0.0 {
            return Ok(AIResponse {
                message: if is_id {
                    format!(
                        "Data harga untuk {} belum tersedia. Coba BTC, ETH, STRK, USDT, atau USDC.",
                        token
                    )
                } else {
                    format!(
                        "Price data for {} is not available yet. Try BTC, ETH, STRK, USDT, or USDC.",
                        token
                    )
                },
                actions: vec![],
                data: Some(serde_json::json!({
                    "token": token,
                    "price_usd": 0.0,
                    "locale": locale,
                })),
            });
        }

        Ok(AIResponse {
            message: if is_id {
                format!("Harga terbaru {} sekitar ${:.6}.", token, price)
            } else {
                format!("Latest {} price is about ${:.6}.", token, price)
            },
            actions: vec!["show_chart".to_string()],
            data: Some(serde_json::json!({
                "token": token,
                "price_usd": price,
                "locale": locale,
            })),
        })
    }

    // Internal helper that runs side-effecting logic for `execute_stake_command`.
    async fn execute_stake_command(&self, intent: &Intent) -> Result<AIResponse> {
        let locale = locale_from_intent(intent);
        let is_id = is_indonesian_locale(locale);
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
            if is_id {
                format!(
                    "Aksi ini REAL on-chain. Kamu akan stake {} {}. Konfirmasi dulu: lanjutkan? (ya/tidak)",
                    amount, token
                )
            } else {
                format!(
                    "This is a REAL on-chain action. You're about to stake {} {}. Confirm to proceed? (yes/no)",
                    amount, token
                )
            }
        } else if is_id {
            "Aksi stake ini REAL on-chain. Kirim format: stake <jumlah> <token>. Contoh: stake 100 USDT.".to_string()
        } else {
            "This stake action is REAL on-chain. Share details as: stake <amount> <token>. Example: stake 100 USDT.".to_string()
        };

        Ok(AIResponse {
            message,
            actions: vec!["show_staking_pools".to_string()],
            data: Some(serde_json::json!({
                "token": token,
                "amount": amount,
                "locale": locale,
            })),
        })
    }

    // Internal helper that runs side-effecting logic for `execute_unstake_command`.
    async fn execute_unstake_command(&self, intent: &Intent) -> Result<AIResponse> {
        let locale = locale_from_intent(intent);
        let is_id = is_indonesian_locale(locale);
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

        let message = if amount > 0.0 {
            if is_id {
                format!(
                    "Aksi ini REAL on-chain. Kamu akan unstake {} {}. Konfirmasi dulu: lanjutkan? (ya/tidak)",
                    amount, token
                )
            } else {
                format!(
                    "This is a REAL on-chain action. You're about to unstake {} {}. Confirm to proceed? (yes/no)",
                    amount, token
                )
            }
        } else if is_id {
            format!(
                "Saya bisa bantu unstake {}. Tambahkan jumlah agar bisa lanjut eksekusi.",
                token
            )
        } else {
            format!(
                "Got it. I can help unstake {}. Share amount too for faster execution.",
                token
            )
        };

        Ok(AIResponse {
            message,
            actions: vec!["prepare_unstake".to_string()],
            data: Some(serde_json::json!({
                "token": token,
                "amount": amount,
                "locale": locale,
            })),
        })
    }

    // Internal helper that runs side-effecting logic for `execute_stake_claim_command`.
    async fn execute_stake_claim_command(&self, intent: &Intent) -> Result<AIResponse> {
        let locale = locale_from_intent(intent);
        let is_id = is_indonesian_locale(locale);
        let token = intent
            .parameters
            .get("token")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let message = if token.is_empty() {
            if is_id {
                "Saya bisa bantu claim reward staking kamu. Kalau mau pool tertentu, tambahkan token (contoh: claim rewards USDT).".to_string()
            } else {
                "I can help claim your staking rewards. If you want specific pool, add token name (e.g. claim rewards USDT).".to_string()
            }
        } else if is_id {
            format!(
                "Aksi ini REAL on-chain. Kamu akan claim rewards staking untuk {}. Konfirmasi dulu: lanjutkan? (ya/tidak)",
                token
            )
        } else {
            format!(
                "This is a REAL on-chain action. You're about to claim staking rewards for {}. Confirm to proceed? (yes/no)",
                token
            )
        };
        Ok(AIResponse {
            message,
            actions: vec!["prepare_stake_claim".to_string()],
            data: Some(serde_json::json!({
                "token": token,
                "locale": locale,
            })),
        })
    }

    // Internal helper that runs side-effecting logic for `execute_limit_order_create_command`.
    async fn execute_limit_order_create_command(&self, intent: &Intent) -> Result<AIResponse> {
        let locale = locale_from_intent(intent);
        let is_id = is_indonesian_locale(locale);
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
        let price = intent
            .parameters
            .get("price")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let expiry = intent
            .parameters
            .get("expiry")
            .and_then(|v| v.as_str())
            .unwrap_or("7d");

        if from.is_empty() || to.is_empty() || amount <= 0.0 || from == to {
            return Ok(AIResponse {
                message: if is_id {
                    "Saya butuh detail limit order dengan format: create limit order <jumlah> <DARI> ke <TUJUAN> at <harga>. Contoh: create limit order 10 STRK ke USDC at 1.2".to_string()
                } else {
                    "I need limit order details in this format: create limit order <amount> <FROM> to <TO> at <price>. Example: create limit order 10 STRK to USDC at 1.2".to_string()
                },
                actions: vec![],
                data: None,
            });
        }

        let message = if price > 0.0 {
            if is_id {
                format!(
                    "Aksi ini REAL on-chain. Kamu akan buat limit order: {} {} -> {} di harga {} (expiry {}). Konfirmasi dulu: lanjutkan? (ya/tidak)",
                    amount, from, to, price, expiry
                )
            } else {
                format!(
                    "This is a REAL on-chain action. You're about to place limit order: {} {} -> {} at price {} (expiry {}). Confirm to proceed? (yes/no)",
                    amount, from, to, price, expiry
                )
            }
        } else if is_id {
            format!(
                "Limit order terdeteksi: {} {} -> {} (expiry {}). Tambahkan 'at <harga>' lalu konfirmasi untuk lanjut.",
                amount, from, to, expiry
            )
        } else {
            format!(
                "Limit order detected: {} {} -> {} (expiry {}). Add 'at <price>' then confirm to proceed.",
                amount, from, to, expiry
            )
        };

        Ok(AIResponse {
            message,
            actions: vec!["prepare_limit_order".to_string()],
            data: Some(serde_json::json!({
                "from_token": from,
                "to_token": to,
                "amount": amount,
                "price": price,
                "expiry": expiry,
                "locale": locale,
            })),
        })
    }

    // Internal helper that runs side-effecting logic for `execute_limit_order_cancel_command`.
    async fn execute_limit_order_cancel_command(&self, locale: &str) -> Result<AIResponse> {
        let is_id = is_indonesian_locale(locale);
        Ok(AIResponse {
            message: if is_id {
                "Aksi ini REAL on-chain. Kamu akan batalkan limit order aktif. Beri order id kalau mau spesifik, lalu konfirmasi. Lanjutkan? (ya/tidak)"
                    .to_string()
            } else {
                "This is a REAL on-chain action. You are about to cancel an active limit order. Provide order id for specific target, then confirm. Proceed? (yes/no)"
                    .to_string()
            },
            actions: vec!["prepare_limit_order_cancel".to_string()],
            data: Some(serde_json::json!({
                "locale": locale,
            })),
        })
    }

    // Internal helper that runs side-effecting logic for `execute_market_analysis`.
    async fn execute_market_analysis(&self, intent: &Intent) -> Result<AIResponse> {
        let locale = locale_from_intent(intent);
        let is_id = is_indonesian_locale(locale);
        let token = intent
            .parameters
            .get("token")
            .and_then(|v| v.as_str())
            .filter(|token| !token.trim().is_empty())
            .unwrap_or("BTC")
            .trim()
            .to_uppercase();
        let price = self.latest_price_for(&token).await?;

        let message = if price > 0.0 {
            if is_id {
                format!(
                    "Snapshot market real-time: {} sekitar ${:.6}. Kalau mau, saya lanjutkan analisis timeframe (1h/4h/1d).",
                    token, price
                )
            } else {
                format!(
                    "Live market snapshot: {} is around ${:.6}. If you want, I can continue with timeframe analysis (1h/4h/1d).",
                    token, price
                )
            }
        } else if is_id {
            format!(
                "Data market real-time untuk {} belum tersedia. Coba token lain seperti BTC, ETH, STRK, USDT, atau USDC.",
                token
            )
        } else {
            format!(
                "Live market data for {} is not available yet. Try another token like BTC, ETH, STRK, USDT, or USDC.",
                token
            )
        };

        Ok(AIResponse {
            message,
            actions: vec!["show_chart".to_string()],
            data: Some(serde_json::json!({
                "token": token,
                "price_usd": price,
                "locale": locale,
            })),
        })
    }

    // Internal helper that runs side-effecting logic for `execute_portfolio_management_command`.
    async fn execute_portfolio_management_command(
        &self,
        user_address: &str,
        locale: &str,
    ) -> Result<AIResponse> {
        let is_id = is_indonesian_locale(locale);
        let assets = self.fetch_portfolio_assets(user_address).await?;
        let total_usd: f64 = assets.iter().map(|asset| asset.value_usd).sum();
        Ok(AIResponse {
            message: if is_id {
                format!(
                    "Ringkasan manajemen portfolio untuk {} siap. Total nilai saat ini sekitar ${:.2}.",
                    user_address, total_usd
                )
            } else {
                format!(
                    "Portfolio management summary for {} is ready. Current total value is about ${:.2}.",
                    user_address, total_usd
                )
            },
            actions: vec![
                "open_portfolio_manager".to_string(),
                "set_rebalance_plan".to_string(),
            ],
            data: Some(serde_json::json!({
                "total_usd": total_usd,
                "assets": assets,
                "locale": locale,
            })),
        })
    }

    // Internal helper that runs side-effecting logic for `execute_alerts_command`.
    async fn execute_alerts_command(&self, locale: &str) -> Result<AIResponse> {
        let is_id = is_indonesian_locale(locale);
        Ok(AIResponse {
            message: if is_id {
                "Alert siap. Pilih token, kondisi trigger, dan channel notifikasi.".to_string()
            } else {
                "Alerts are ready. Choose token, trigger condition, and notification channel."
                    .to_string()
            },
            actions: vec!["configure_alerts".to_string()],
            data: Some(serde_json::json!({
                "supported_triggers": ["price_above", "price_below", "volatility_spike"],
                "locale": locale,
            })),
        })
    }

    // Internal helper that runs side-effecting logic for `execute_tutorial_command`.
    async fn execute_tutorial_command(&self, level: u8, locale: &str) -> Result<AIResponse> {
        let is_id = is_indonesian_locale(locale);
        let level_hint = match level {
            1 => "You are on Level 1 (read-only).",
            2 => "You are on Level 2 (swap/bridge/stake/claim/limit).",
            3 => {
                "You are on Level 3 (Garaga/private execution + unstake/portfolio/alerts/complex analysis)."
            }
            _ => "Unknown level.",
        };
        Ok(AIResponse {
            message: if is_id {
                format!(
                    "Kamu ada di Level {}. Panduan singkat: 1) Hubungkan wallet. 2) Untuk command on-chain klik Auto Setup On-Chain sekali. 3) Coba 'cek saldo saya'. 4) Lanjut swap/bridge/stake/claim/limit. 5) Konfirmasi hanya di popup wallet.",
                    level
                )
            } else {
                format!(
                    "{level_hint} Beginner steps: 1) Connect wallet. 2) For on-chain commands click Auto Setup On-Chain once. 3) Try: 'check my balance'. 4) Then try swap/bridge/stake/claim/limit commands. 5) Confirm only in wallet popup."
                )
            },
            actions: vec!["show_tutorial".to_string()],
            data: Some(serde_json::json!({
                "steps": [
                    "Connect wallet",
                    "Run Auto Setup On-Chain once (Level 2/3)",
                    "Run read-only command",
                    "Run swap/bridge/stake/claim/limit command",
                    "Confirm transaction in wallet"
                ],
                "locale": locale,
            })),
        })
    }

    // Internal helper that runs side-effecting logic for `execute_greeting_command`.
    async fn execute_greeting_command(&self, level: u8, intent: &Intent) -> Result<AIResponse> {
        let locale = intent
            .parameters
            .get("locale")
            .and_then(|v| v.as_str())
            .unwrap_or("en");

        let message = if locale == "id" {
            "Halo! Tentu bisa. Mau cek harga, saldo, poin, atau langsung aksi tertentu?".to_string()
        } else if level == 1 {
            "Hey! Of course. On Level 1 I can help with price, balance, points, and market data."
                .to_string()
        } else if level == 2 {
            "Hey! Of course. On Level 2 I can run real swap/bridge/stake/claim/limit after setup confirmation."
                .to_string()
        } else {
            "Hey! Of course. On Level 3 I run Garaga/private mode for execution, plus unstake/portfolio/alerts."
                .to_string()
        };

        Ok(AIResponse {
            message,
            actions: vec![],
            data: None,
        })
    }

    // Internal helper that runs side-effecting logic for `execute_general_chat_command`.
    async fn execute_general_chat_command(&self, level: u8, intent: &Intent) -> Result<AIResponse> {
        let locale = intent
            .parameters
            .get("locale")
            .and_then(|v| v.as_str())
            .unwrap_or("en");
        let is_id = is_indonesian_locale(locale);
        let query = intent
            .parameters
            .get("query")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_ascii_lowercase();

        let is_thanks =
            contains_any_keyword(&query, &["thanks", "thank you", "makasih", "terima kasih"]);
        let asks_identity = contains_any_keyword(
            &query,
            &[
                "who are you",
                "kamu siapa",
                "siapa kamu",
                "what can you do",
                "bisa bantu",
            ],
        );

        let message = if is_thanks {
            if is_id {
                "Sama-sama. Lanjut apa sekarang? Bisa cek harga, saldo, poin, atau langsung eksekusi command."
                    .to_string()
            } else {
                "You're welcome. What do you want to do next? I can check price, balance, points, or run execution commands."
                    .to_string()
            }
        } else if asks_identity {
            if is_id {
                match level {
                    1 => "Saya CAREL Agent. Di Level 1 saya bisa ngobrol dan bantu data real-time: harga, saldo, poin, dan market.".to_string(),
                    2 => "Saya CAREL Agent. Di Level 2 saya bisa chat + eksekusi real swap/bridge/stake/claim/limit setelah setup on-chain.".to_string(),
                    _ => "Saya CAREL Agent. Di Level 3 saya jalankan mode Garaga/private + unstake/portfolio/alerts dan analisis lanjutan.".to_string(),
                }
            } else {
                match level {
                    1 => "I'm CAREL Agent. On Level 1 I handle chat plus real-time read-only data: price, balance, points, and market."
                        .to_string(),
                    2 => "I'm CAREL Agent. On Level 2 I handle chat plus real on-chain swap/bridge/stake/claim/limit after setup."
                        .to_string(),
                    _ => "I'm CAREL Agent. On Level 3 I run Garaga/private mode plus unstake/portfolio/alerts and deeper analysis."
                        .to_string(),
                }
            }
        } else if is_id {
            "Bisa. Ceritakan tujuanmu singkat, nanti saya bantu langkah paling cepat.".to_string()
        } else {
            "Sure. Tell me your goal in one short sentence and I'll guide the fastest path."
                .to_string()
        };

        Ok(AIResponse {
            message,
            actions: vec![],
            data: Some(serde_json::json!({
                "locale": locale,
            })),
        })
    }

    // Internal helper that runs side-effecting logic for `execute_set_language_indonesian_command`.
    async fn execute_set_language_indonesian_command(&self) -> Result<AIResponse> {
        Ok(AIResponse {
            message:
                "Siap, saya pakai Bahasa Indonesia. Coba perintah: 'cek saldo saya', 'berapa poin saya', 'harga STRK', atau 'tukar 25 STRK ke WBTC'."
                    .to_string(),
            actions: vec![],
            data: None,
        })
    }

    // Internal helper that runs side-effecting logic for `execute_set_language_english_command`.
    async fn execute_set_language_english_command(&self) -> Result<AIResponse> {
        Ok(AIResponse {
            message:
                "Sure, I'll use English. Try: 'check my balance', 'my points', 'show STRK price', or 'swap 25 STRK to WBTC'."
                    .to_string(),
            actions: vec![],
            data: None,
        })
    }

    // Internal helper that supports `execute_unknown_command` operations.
    fn execute_unknown_command(&self, level: u8, locale: &str) -> AIResponse {
        let message = if has_llm_provider_configured(&self.config) {
            if level <= 1 {
                "CAREL Agent is being further developed by the team for this feature. Right now I can help with available commands: price, balance, points, and market data."
                    .to_string()
            } else {
                "CAREL Agent is being further developed by the team for this feature. Right now I can help with available commands: swap, bridge (Level 2), stake, claim, and limit order."
                    .to_string()
            }
        } else {
            "CAREL Agent is being further developed by the team for this feature. Free-form AI provider is not configured on backend yet."
                .to_string()
        };

        AIResponse {
            message,
            actions: vec![],
            data: Some(serde_json::json!({
                "locale": locale,
            })),
        }
    }

    // Internal helper that fetches data for `fetch_portfolio_assets`.
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

    // Internal helper that supports `latest_price_for` operations.
    async fn latest_price_for(&self, token: &str) -> Result<f64> {
        let symbol = token.to_ascii_uppercase();
        for candidate in symbol_candidates_for(&symbol) {
            let rows: Vec<f64> = sqlx::query_scalar(
                "SELECT close::FLOAT8 FROM price_history WHERE token = $1 ORDER BY timestamp DESC LIMIT 16",
            )
            .bind(&candidate)
            .fetch_all(self.db.pool())
            .await?;
            if let Some(price) = first_sane_price(&candidate, &rows) {
                return Ok(price);
            }
        }
        Ok(fallback_price_for(&symbol))
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

// Internal helper that supports `estimate_carel_from_points` operations.
fn estimate_carel_from_points(
    points: Decimal,
    total_points: Decimal,
    distribution_pool: Decimal,
) -> Decimal {
    if total_points.is_zero() {
        return Decimal::ZERO;
    }
    (points / total_points) * distribution_pool
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    // Internal helper that supports `extract_token_from_text_detects_eth` operations.
    fn extract_token_from_text_detects_eth() {
        // Memastikan token ETH terdeteksi dari teks
        let token = extract_token_from_text("swap eth to usdt");
        assert_eq!(token, "ETH");
    }

    #[test]
    // Internal helper that supports `extract_amount_from_text_reads_number` operations.
    fn extract_amount_from_text_reads_number() {
        // Memastikan angka pertama diambil dari teks
        let amount = extract_amount_from_text("swap 12.5 eth");
        assert!((amount - 12.5).abs() < f64::EPSILON);
    }

    #[test]
    // Internal helper that parses or transforms values for `parse_intent_from_command_sets_action`.
    fn parse_intent_from_command_sets_action() {
        // Memastikan intent swap dikenali
        let intent = parse_intent_from_command("please swap 1 btc to eth");
        assert_eq!(intent.action, "swap");
    }

    #[test]
    // Internal helper that parses or transforms values for `parse_swap_parameters_reads_from_and_to`.
    fn parse_swap_parameters_reads_from_and_to() {
        // Memastikan token asal dan tujuan swap terdeteksi benar
        let (from, to, amount) = parse_swap_parameters("swap 25 strk to carel");
        assert_eq!(from, "STRK");
        assert_eq!(to, "CAREL");
        assert!((amount - 25.0).abs() < f64::EPSILON);
    }

    #[test]
    // Internal helper that parses or transforms values for `parse_swap_parameters_supports_indonesian_keyword`.
    fn parse_swap_parameters_supports_indonesian_keyword() {
        // Memastikan format "ke" juga terbaca untuk token tujuan
        let (from, to, amount) = parse_swap_parameters("tukar 10 usdt ke strk");
        assert_eq!(from, "USDT");
        assert_eq!(to, "STRK");
        assert!((amount - 10.0).abs() < f64::EPSILON);
    }

    #[test]
    // Internal helper that supports `extract_amount_from_text_supports_decimal_comma` operations.
    fn extract_amount_from_text_supports_decimal_comma() {
        // Memastikan angka dengan koma tetap bisa diparse
        let amount = extract_amount_from_text("swap 1,5 strk to carel");
        assert!((amount - 1.5).abs() < f64::EPSILON);
    }

    #[test]
    // Internal helper that supports `classify_command_scope_enforces_read_only` operations.
    fn classify_command_scope_enforces_read_only() {
        let scope = classify_command_scope("cek saldo portfolio saya");
        assert_eq!(scope, AIGuardScope::ReadOnly);
    }

    #[test]
    // Internal helper that supports `classify_command_scope_enforces_swap_bridge` operations.
    fn classify_command_scope_enforces_swap_bridge() {
        let scope = classify_command_scope("bridge 100 usdt to strk");
        assert_eq!(scope, AIGuardScope::SwapBridge);
    }

    #[test]
    // Internal helper that supports `parse_intent_handles_bridge_typo` operations.
    fn parse_intent_handles_bridge_typo() {
        let intent = parse_intent_from_command("please brigde 0.0005 btc to wbtc");
        assert_eq!(intent.action, "bridge");
        assert_eq!(
            intent.parameters.get("from").and_then(|value| value.as_str()),
            Some("BTC")
        );
        assert_eq!(
            intent.parameters.get("to").and_then(|value| value.as_str()),
            Some("WBTC")
        );
    }

    #[test]
    // Internal helper that supports `classify_command_scope_bridge_typo_is_onchain_scope` operations.
    fn classify_command_scope_bridge_typo_is_onchain_scope() {
        let scope = classify_command_scope("brigde 0.0005 btc to wbtc");
        assert_eq!(scope, AIGuardScope::SwapBridge);
    }

    #[test]
    // Internal helper that supports `classify_command_scope_limit_order_is_onchain_scope` operations.
    fn classify_command_scope_limit_order_is_onchain_scope() {
        let scope = classify_command_scope("create limit order 10 strk to usdc at 1.2");
        assert_eq!(scope, AIGuardScope::SwapBridge);
    }

    #[test]
    // Internal helper that parses or transforms values for `parse_limit_order_parameters_reads_price_and_expiry`.
    fn parse_limit_order_parameters_reads_price_and_expiry() {
        let (from, to, amount, price, expiry) =
            parse_limit_order_parameters("create limit order 10 strk to usdc at 1.2 for 30d");
        assert_eq!(from, "STRK");
        assert_eq!(to, "USDC");
        assert!((amount - 10.0).abs() < f64::EPSILON);
        assert!((price - 1.2).abs() < f64::EPSILON);
        assert_eq!(expiry, "30d");
    }

    #[test]
    // Internal helper that parses or transforms values for `parse_intent_handles_unstake_and_claim`.
    fn parse_intent_handles_unstake_and_claim() {
        let unstake_intent = parse_intent_from_command("unstake 50 usdt");
        assert_eq!(unstake_intent.action, "unstake");
        let claim_intent = parse_intent_from_command("claim rewards usdt");
        assert_eq!(claim_intent.action, "claim_staking_rewards");
    }

    #[test]
    // Internal helper that parses or transforms values for `parse_intent_handles_price_query`.
    fn parse_intent_handles_price_query() {
        let intent = parse_intent_from_command("show strk price");
        assert_eq!(intent.action, "check_price");
        assert_eq!(
            intent.parameters.get("token").and_then(|v| v.as_str()),
            Some("STRK")
        );
    }

    #[test]
    // Internal helper that parses or transforms values for `parse_intent_handles_indonesian_language_request`.
    fn parse_intent_handles_indonesian_language_request() {
        let intent = parse_intent_from_command("bahsa indo lah");
        assert_eq!(intent.action, "set_language_indonesian");
    }

    #[test]
    // Internal helper that parses or transforms values for `parse_intent_handles_english_language_request`.
    fn parse_intent_handles_english_language_request() {
        let intent = parse_intent_from_command("please use english");
        assert_eq!(intent.action, "set_language_english");
    }

    #[test]
    // Internal helper that parses or transforms values for `parse_intent_handles_general_chat_request`.
    fn parse_intent_handles_general_chat_request() {
        let intent = parse_intent_from_command("kamu siapa dan bisa bantu apa?");
        assert_eq!(intent.action, "chat_general");
    }

    #[test]
    // Internal helper that parses or transforms values for `detect_locale_defaults_to_english_without_explicit_switch`.
    fn detect_locale_defaults_to_english_without_explicit_switch() {
        assert_eq!(detect_locale_from_command("kamu siapa"), "en");
        assert_eq!(
            detect_locale_from_command("how many points do I have"),
            "en"
        );
        assert_eq!(detect_locale_from_command("pakai bahasa indonesia"), "id");
    }

    #[test]
    // Internal helper that parses or transforms values for `parse_intent_handles_greeting`.
    fn parse_intent_handles_greeting() {
        let intent = parse_intent_from_command("hello there");
        assert_eq!(intent.action, "chat_greeting");
    }

    #[test]
    // Internal helper that supports `classify_command_scope_greeting_is_read_only` operations.
    fn classify_command_scope_greeting_is_read_only() {
        let scope = classify_command_scope("hello");
        assert_eq!(scope, AIGuardScope::ReadOnly);
    }

    #[test]
    // Internal helper that supports `classify_command_scope_general_chat_is_read_only` operations.
    fn classify_command_scope_general_chat_is_read_only() {
        let scope = classify_command_scope("can you help me choose strategy?");
        assert_eq!(scope, AIGuardScope::ReadOnly);
    }

    #[test]
    // Internal helper that supports `classify_command_scope_price_is_read_only` operations.
    fn classify_command_scope_price_is_read_only() {
        let scope = classify_command_scope("show strk price");
        assert_eq!(scope, AIGuardScope::ReadOnly);
    }

    #[test]
    // Internal helper that supports `classify_command_scope_enforces_portfolio_alert` operations.
    fn classify_command_scope_enforces_portfolio_alert() {
        let scope = classify_command_scope("buat alert harga btc");
        assert_eq!(scope, AIGuardScope::PortfolioAlert);
    }
}
