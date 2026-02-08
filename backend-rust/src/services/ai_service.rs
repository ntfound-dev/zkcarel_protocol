use crate::{config::Config, constants::{EPOCH_DURATION_SECONDS, POINTS_TO_CAREL_RATIO}, db::Database, error::Result};
use serde::{Deserialize, Serialize};

fn extract_token_from_text(text: &str) -> String {
    if text.contains("btc") || text.contains("bitcoin") {
        "BTC".to_string()
    } else if text.contains("eth") || text.contains("ethereum") {
        "ETH".to_string()
    } else if text.contains("strk") || text.contains("starknet") {
        "STRK".to_string()
    } else if text.contains("carel") {
        "CAREL".to_string()
    } else if text.contains("usdt") {
        "USDT".to_string()
    } else {
        "".to_string()
    }
}

fn extract_amount_from_text(text: &str) -> f64 {
    text.split_whitespace()
        .find_map(|word| word.parse::<f64>().ok())
        .unwrap_or(0.0)
}

fn parse_intent_from_command(command: &str) -> Intent {
    let command_lower = command.to_lowercase();

    if command_lower.contains("swap") || command_lower.contains("exchange") {
        Intent {
            action: "swap".to_string(),
            parameters: serde_json::json!({
                "from": extract_token_from_text(&command_lower),
                "to": extract_token_from_text(&command_lower),
                "amount": extract_amount_from_text(&command_lower),
            }),
        }
    } else if command_lower.contains("balance") || command_lower.contains("how much") {
        Intent {
            action: "check_balance".to_string(),
            parameters: serde_json::json!({}),
        }
    } else if command_lower.contains("points") || command_lower.contains("rewards") {
        Intent {
            action: "check_points".to_string(),
            parameters: serde_json::json!({}),
        }
    } else if command_lower.contains("stake") {
        Intent {
            action: "stake".to_string(),
            parameters: serde_json::json!({
                "token": extract_token_from_text(&command_lower),
                "amount": extract_amount_from_text(&command_lower),
            }),
        }
    } else if command_lower.contains("market") || command_lower.contains("analysis") {
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
        let has_ai_key = self.config.openai_api_key.is_some();
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
                message: "I'm not sure what you want to do. Try asking about swaps, balances, or points.".to_string(),
                actions: vec![],
                data: None,
            },
        };

        let response = if has_ai_key {
            response
        } else {
            AIResponse {
                message: format!("{} (AI key not configured)", response.message),
                actions: response.actions,
                data: response.data,
            }
        };

        Ok(response)
    }

    /// Parse user intent using OpenAI (placeholder: keyword matching)
    async fn parse_intent(&self, command: &str) -> Result<Intent> {
        Ok(parse_intent_from_command(command))
    }


    async fn execute_swap_command(&self, intent: &Intent) -> Result<AIResponse> {
        let from = intent.parameters.get("from")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let to = intent.parameters.get("to")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let amount = intent.parameters.get("amount")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);

        if from.is_empty() || to.is_empty() || amount == 0.0 {
            return Ok(AIResponse {
                message: "I need more details. Which tokens do you want to swap and how much?".to_string(),
                actions: vec![],
                data: None,
            });
        }

        Ok(AIResponse {
            message: format!("I'll help you swap {} {} to {}. Let me get the best rate...", amount, from, to),
            actions: vec!["get_swap_quote".to_string()],
            data: Some(serde_json::json!({
                "from_token": from,
                "to_token": to,
                "amount": amount,
            })),
        })
    }

    async fn execute_balance_command(&self, user_address: &str) -> Result<AIResponse> {
        // TODO: Get actual balance from DB / on-chain sources.
        // For now return a stub including user_address to avoid unused-variable warnings.
        Ok(AIResponse {
            message: format!("Here's the current portfolio balance for {}:", user_address),
            actions: vec!["show_balance".to_string()],
            data: Some(serde_json::json!({
                "total_usd": 31000.0,
                "assets": {
                    "BTC": 0.15,
                    "ETH": 2.5,
                    "CAREL": 15000.0,
                }
            })),
        })
    }

    async fn execute_points_command(&self, user_address: &str) -> Result<AIResponse> {
        let epoch = (chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS) as i64;

        let points = self.db.get_user_points(user_address, epoch).await?;

        let total = points.as_ref()
            .map(|p| p.total_points.to_string().parse::<f64>().unwrap_or(0.0))
            .unwrap_or(0.0);

        Ok(AIResponse {
            message: format!("You have {} points this epoch! 🎉", total),
            actions: vec!["show_points_breakdown".to_string()],
            data: Some(serde_json::json!({
                "total_points": total,
                "estimated_carel": total * POINTS_TO_CAREL_RATIO,
            })),
        })
    }

    async fn execute_stake_command(&self, intent: &Intent) -> Result<AIResponse> {
        // Use intent parameters (if provided) to craft a more useful reply
        let token = intent.parameters.get("token")
            .and_then(|v| v.as_str())
            .unwrap_or("the token");
        let amount = intent.parameters.get("amount")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);

        let message = if amount > 0.0 && !token.is_empty() {
            format!("Staking {} {} will help you earn rewards and boost your points!", amount, token)
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
        let token_opt = intent.parameters.get("token")
            .and_then(|v| v.as_str());

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
}
