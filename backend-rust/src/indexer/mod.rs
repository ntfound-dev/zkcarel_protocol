pub mod starknet_client;
pub mod event_parser;
pub mod block_processor;

// pub use starknet_client::StarknetClient;
// pub use event_parser::EventParser;
// pub use block_processor::BlockProcessor;

#[cfg(test)]
mod tests {
    use super::event_parser::EventParser;

    #[test]
    fn event_parser_default_formats_address() {
        let parser = EventParser::default();
        assert_eq!(parser.hex_to_address("abc"), "0xabc");
        assert_eq!(parser.hex_to_address("0xabc"), "0xabc");
    }
}
