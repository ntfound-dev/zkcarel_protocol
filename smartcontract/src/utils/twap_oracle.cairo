use starknet::ContractAddress;

#[derive(Drop, Serde, starknet::Store)]
pub struct PriceObservation {
    pub timestamp: u64,
    pub price: u256,
    pub cumulative_price: u256
}

#[starknet::interface]
pub trait ITWAPOracle<TContractState> {
    fn update_observation(ref self: TContractState, token: ContractAddress, price: u256);
    fn get_twap(self: @TContractState, token: ContractAddress, period: u64) -> u256;
    fn get_spot_price(self: @TContractState, token: ContractAddress) -> u256;
    fn get_price_deviation(self: @TContractState, token: ContractAddress) -> u256;
}

#[starknet::contract]
pub mod TWAPOracle {
    use starknet::ContractAddress;
    use starknet::get_block_timestamp;
    use starknet::storage::*;
    use super::PriceObservation;

    #[storage]
    pub struct Storage {
        pub price_observations: Map<ContractAddress, Vec<PriceObservation>>,
        pub observation_window: u64,
        pub min_observations: u256,
    }

    #[constructor]
    fn constructor(ref self: ContractState) {
        self.observation_window.write(1800);
        self.min_observations.write(10);
    }

    #[abi(embed_v0)]
    pub impl TWAPOracleImpl of super::ITWAPOracle<ContractState> {
        fn update_observation(ref self: ContractState, token: ContractAddress, price: u256) {
            let now = get_block_timestamp();
            let mut observations = self.price_observations.entry(token);
            let len = observations.len();

            let cumulative_price = if len == 0 {
                0_u256
            } else {
                let last_obs = observations.at(len - 1).read();
                let time_diff = now - last_obs.timestamp;
                last_obs.cumulative_price + (price * time_diff.into())
            };

            let new_observation = PriceObservation {
                timestamp: now,
                price: price,
                cumulative_price: cumulative_price
            };

            // Use push instead of append().write() to resolve deprecation warning
            observations.push(new_observation);
        }

        fn get_twap(self: @ContractState, token: ContractAddress, period: u64) -> u256 {
            let observations = self.price_observations.entry(token);
            let len = observations.len();
            
            assert!(len.into() >= self.min_observations.read(), "Insufficient observations");

            let current_obs = observations.at(len - 1).read();
            let target_ts = get_block_timestamp() - period;

            let mut start_obs = observations.at(0).read();
            let mut i = len - 1;
            
            loop {
                let obs = observations.at(i).read();
                if obs.timestamp <= target_ts || i == 0 {
                    start_obs = obs;
                    break;
                }
                i -= 1;
            };

            let time_diff = current_obs.timestamp - start_obs.timestamp;
            assert!(time_diff > 0, "Time difference must be positive");

            (current_obs.cumulative_price - start_obs.cumulative_price) / time_diff.into()
        }

        fn get_spot_price(self: @ContractState, token: ContractAddress) -> u256 {
            let observations = self.price_observations.entry(token);
            let len = observations.len();
            assert!(len > 0, "No observations found");
            observations.at(len - 1).read().price
        }

        fn get_price_deviation(self: @ContractState, token: ContractAddress) -> u256 {
            let spot = self.get_spot_price(token);
            let twap = self.get_twap(token, self.observation_window.read());
            
            if spot > twap {
                spot - twap
            } else {
                twap - spot
            }
        }
    }
}