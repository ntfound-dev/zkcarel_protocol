use super::starknet_client::Event;
use serde_json::Value;
use starknet_core::utils::get_selector_from_name;

/// Event Parser - Parses Starknet events into structured data
pub struct EventParser;

impl EventParser {
    pub fn new() -> Self {
        Self
    }

    /// Parse event based on event key
    pub fn parse_event(&self, event: &Event) -> Option<ParsedEvent> {
        if event.keys.is_empty() {
            return None;
        }

        let event_key = &event.keys[0];
        if key_is(event_key, "SwapExecuted") {
            return self.parse_swap_event(event);
        }
        if key_is(event_key, "BridgeExecuted") || key_is(event_key, "BridgeInitiated") {
            return self.parse_bridge_event(event);
        }
        if key_is(event_key, "Staked") {
            return self.parse_stake_event(event);
        }
        if key_is(event_key, "Unstaked") {
            return self.parse_unstake_event(event);
        }
        if key_is(event_key, "RewardsClaimed") || key_is(event_key, "RewardClaimed") {
            return self.parse_claim_event(event);
        }
        if key_is(event_key, "LimitOrderFilled") {
            return self.parse_order_filled_event(event);
        }

        None
    }

    fn parse_swap_event(&self, event: &Event) -> Option<ParsedEvent> {
        let user = user_from_keys_or_data(event, 0)?;

        let (token_in, token_out, amount_in, amount_out) = if event.keys.len() > 1 {
            (
                event.data.get(1).cloned(),
                event.data.get(2).cloned(),
                event.data.get(0).cloned(),
                event.data.get(3).cloned(),
            )
        } else {
            (
                event.data.get(1).cloned(),
                event.data.get(2).cloned(),
                event.data.get(3).cloned(),
                event.data.get(4).cloned(),
            )
        };

        let mut data = serde_json::json!({
            "user": user,
        });
        if let Some(value) = token_in {
            data["token_in"] = Value::String(value);
        }
        if let Some(value) = token_out {
            data["token_out"] = Value::String(value);
        }
        if let Some(value) = amount_in {
            data["amount_in"] = Value::String(value);
        }
        if let Some(value) = amount_out {
            data["amount_out"] = Value::String(value);
        }

        Some(ParsedEvent {
            event_type: "Swap".to_string(),
            data,
        })
    }

    fn parse_bridge_event(&self, event: &Event) -> Option<ParsedEvent> {
        let user = if key_is(event.keys.get(0)?.as_str(), "BridgeInitiated") {
            event.data.get(1)?.clone()
        } else {
            user_from_keys_or_data(event, 0)?
        };

        Some(ParsedEvent {
            event_type: "Bridge".to_string(),
            data: serde_json::json!({
                "user": user,
            }),
        })
    }

    fn parse_stake_event(&self, event: &Event) -> Option<ParsedEvent> {
        let user = user_from_keys_or_data(event, 0)?;

        Some(ParsedEvent {
            event_type: "Stake".to_string(),
            data: serde_json::json!({
                "user": user,
            }),
        })
    }

    fn parse_unstake_event(&self, event: &Event) -> Option<ParsedEvent> {
        let user = user_from_keys_or_data(event, 0)?;

        Some(ParsedEvent {
            event_type: "Unstake".to_string(),
            data: serde_json::json!({
                "user": user,
            }),
        })
    }

    fn parse_claim_event(&self, event: &Event) -> Option<ParsedEvent> {
        let user = user_from_keys_or_data(event, 0)?;

        Some(ParsedEvent {
            event_type: "Claim".to_string(),
            data: serde_json::json!({
                "user": user,
            }),
        })
    }

    fn parse_order_filled_event(&self, event: &Event) -> Option<ParsedEvent> {
        if event.data.len() < 2 {
            return None;
        }

        Some(ParsedEvent {
            event_type: "LimitOrderFilled".to_string(),
            data: serde_json::json!({
                "order_id": event.data.get(0)?.clone(),
                "filled_amount": event.data.get(1)?.clone(),
            }),
        })
    }

    /// Convert hex string to decimal
    pub fn hex_to_decimal(&self, hex: &str) -> Option<u64> {
        u64::from_str_radix(hex.trim_start_matches("0x"), 16).ok()
    }

    /// Convert hex string to address
    pub fn hex_to_address(&self, hex: &str) -> String {
        format!("0x{}", hex.trim_start_matches("0x"))
    }
}

fn selector_hex(name: &str) -> Option<String> {
    let selector = get_selector_from_name(name).ok()?;
    Some(format!("{selector:#x}"))
}

fn normalize_hex(value: &str) -> String {
    let trimmed = value.trim_start_matches("0x");
    let trimmed = trimmed.trim_start_matches('0');
    let normalized = if trimmed.is_empty() { "0" } else { trimmed };
    normalized.to_ascii_lowercase()
}

fn key_is(key: &str, name: &str) -> bool {
    let Some(selector) = selector_hex(name) else {
        return false;
    };
    normalize_hex(key) == normalize_hex(&selector)
}

fn user_from_keys_or_data(event: &Event, data_index: usize) -> Option<String> {
    if event.keys.len() > 1 {
        return event.keys.get(1).cloned();
    }
    event.data.get(data_index).cloned()
}

#[derive(Debug, Clone)]
pub struct ParsedEvent {
    pub event_type: String,
    pub data: Value,
}

impl Default for EventParser {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_swap_event() {
        let parser = EventParser::new();
        let selector = selector_hex("SwapExecuted").unwrap();
        let event = Event {
            from_address: "0x123".to_string(),
            keys: vec![selector],
            data: vec![
                "0x456".to_string(),
                "0xETH".to_string(),
                "0xUSDT".to_string(),
                "0x1000".to_string(),
                "0x2000".to_string(),
            ],
            transaction_hash: None,
            block_number: None,
        };

        let parsed = parser.parse_event(&event);
        assert!(parsed.is_some());

        let parsed = parsed.unwrap();
        assert_eq!(parsed.event_type, "Swap");
    }

    #[test]
    fn parse_event_returns_none_for_empty_keys() {
        // Memastikan event tanpa key diabaikan
        let parser = EventParser::new();
        let event = Event {
            from_address: "0x123".to_string(),
            keys: vec![],
            data: vec![],
            transaction_hash: None,
            block_number: None,
        };
        assert!(parser.parse_event(&event).is_none());
    }

    #[test]
    fn hex_to_decimal_parses_valid_hex() {
        // Memastikan hex valid diubah menjadi angka desimal
        let parser = EventParser::new();
        assert_eq!(parser.hex_to_decimal("0x10"), Some(16));
    }

    #[test]
    fn hex_to_address_always_prefixes() {
        // Memastikan alamat selalu memiliki prefix 0x
        let parser = EventParser::new();
        assert_eq!(parser.hex_to_address("abc"), "0xabc");
    }
}
