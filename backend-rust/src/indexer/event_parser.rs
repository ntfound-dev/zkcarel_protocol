use super::starknet_client::Event;
use serde_json::Value;

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

        match event_key.as_str() {
            // Swap event: keccak256("Swap")
            k if k.contains("Swap") => self.parse_swap_event(event),
            
            // Bridge event: keccak256("Bridge")
            k if k.contains("Bridge") => self.parse_bridge_event(event),
            
            // Stake event: keccak256("Stake")
            k if k.contains("Stake") => self.parse_stake_event(event),
            
            // Unstake event: keccak256("Unstake")
            k if k.contains("Unstake") => self.parse_unstake_event(event),
            
            // LimitOrderFilled: keccak256("LimitOrderFilled")
            k if k.contains("LimitOrderFilled") => self.parse_order_filled_event(event),
            
            _ => None,
        }
    }

    fn parse_swap_event(&self, event: &Event) -> Option<ParsedEvent> {
        if event.data.len() < 5 {
            return None;
        }

        Some(ParsedEvent {
            event_type: "Swap".to_string(),
            data: serde_json::json!({
                "user": event.data.get(0)?.clone(),
                "token_in": event.data.get(1)?.clone(),
                "token_out": event.data.get(2)?.clone(),
                "amount_in": event.data.get(3)?.clone(),
                "amount_out": event.data.get(4)?.clone(),
            }),
        })
    }

    fn parse_bridge_event(&self, event: &Event) -> Option<ParsedEvent> {
        if event.data.len() < 4 {
            return None;
        }

        Some(ParsedEvent {
            event_type: "Bridge".to_string(),
            data: serde_json::json!({
                "user": event.data.get(0)?.clone(),
                "from_chain": event.data.get(1)?.clone(),
                "to_chain": event.data.get(2)?.clone(),
                "amount": event.data.get(3)?.clone(),
            }),
        })
    }

    fn parse_stake_event(&self, event: &Event) -> Option<ParsedEvent> {
        if event.data.len() < 3 {
            return None;
        }

        Some(ParsedEvent {
            event_type: "Stake".to_string(),
            data: serde_json::json!({
                "user": event.data.get(0)?.clone(),
                "token": event.data.get(1)?.clone(),
                "amount": event.data.get(2)?.clone(),
            }),
        })
    }

    fn parse_unstake_event(&self, event: &Event) -> Option<ParsedEvent> {
        if event.data.len() < 3 {
            return None;
        }

        Some(ParsedEvent {
            event_type: "Unstake".to_string(),
            data: serde_json::json!({
                "user": event.data.get(0)?.clone(),
                "token": event.data.get(1)?.clone(),
                "amount": event.data.get(2)?.clone(),
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
        let event = Event {
            from_address: "0x123".to_string(),
            keys: vec!["Swap".to_string()],
            data: vec![
                "0x456".to_string(),
                "0xETH".to_string(),
                "0xUSDT".to_string(),
                "0x1000".to_string(),
                "0x2000".to_string(),
            ],
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
