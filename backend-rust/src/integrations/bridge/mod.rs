pub mod atomiq;
pub mod garden;
pub mod layerswap;

pub use atomiq::{AtomiqClient, AtomiqQuote};
#[derive(Debug, Clone)]
pub struct BridgeQuote {
    pub from_token: String,
    pub to_token: String,
    pub amount_in_units: u128,
    pub amount_out_units: u128,
    pub fee_units: u128,
    pub estimated_time_minutes: u32,
}
pub use garden::{GardenClient, GardenEvmTransaction, GardenQuote, GardenStarknetTransaction};
pub use layerswap::{LayerSwapClient, LayerSwapQuote};
