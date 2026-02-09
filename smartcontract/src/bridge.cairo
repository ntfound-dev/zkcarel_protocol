/// @title Bridge Module
/// @author CAREL Team
/// @notice Bridge and swap aggregation components for multi-chain routing.
/// @dev Groups aggregator, private swap, and BTC-native bridge contracts.
pub mod bridge_aggregator;
pub mod swap_aggregator;
pub mod private_swap;
pub mod btc_native_bridge;
pub mod provider_adapter;
pub mod atomiq_adapter;
pub mod garden_adapter;
pub mod layerswap_adapter;
pub mod private_btc_swap;
