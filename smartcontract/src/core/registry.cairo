// Interface didefinisikan tepat di atas modul kontrak
#[starknet::interface]
pub trait IRegistry<TContractState> {
    fn register_data(ref self: TContractState, data: felt252);
    fn update_data(ref self: TContractState, index: u64, new_data: felt252);
    fn get_data(self: @TContractState, index: u64) -> felt252;
    fn get_all_data(self: @TContractState) -> Array<felt252>;
    fn get_user_data(self: @TContractState, user: starknet::ContractAddress) -> felt252;
}

#[starknet::contract]
pub mod Registry {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::get_caller_address;

    #[storage]
    pub struct Storage {
        // Menggunakan Vec untuk koleksi data di storage
        data_vector: Vec<felt252>,
        user_data_map: Map<ContractAddress, felt252>,
        foo: usize,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        DataRegistered: DataRegistered,
        DataUpdated: DataUpdated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct DataRegistered {
        pub user: ContractAddress,
        pub data: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct DataUpdated {
        pub user: ContractAddress,
        pub index: u64,
        pub new_data: felt252,
    }

    #[constructor]
    fn constructor(ref self: ContractState, initial_data: usize) {
        self.foo.write(initial_data);
    }

    #[abi(embed_v0)]
    pub impl RegistryImpl of super::IRegistry<ContractState> {
        fn register_data(ref self: ContractState, data: felt252) {
            let caller = get_caller_address();
            
            // Menggunakan .push() sesuai rekomendasi compiler terbaru
            self.data_vector.push(data);
            
            self.user_data_map.entry(caller).write(data);
            self.emit(Event::DataRegistered(DataRegistered { user: caller, data }));
        }

        fn update_data(ref self: ContractState, index: u64, new_data: felt252) {
            let caller = get_caller_address();
            
            // Menggunakan indexing langsung untuk menulis ulang data
            self.data_vector[index].write(new_data);
            
            self.user_data_map.entry(caller).write(new_data);
            self.emit(Event::DataUpdated(DataUpdated { user: caller, index, new_data }));
        }

        fn get_data(self: @ContractState, index: u64) -> felt252 {
            // Menggunakan .at() untuk membaca data di index tertentu
            self.data_vector.at(index).read()
        }

        fn get_all_data(self: @ContractState) -> Array<felt252> {
            let mut all_data = array![];
            for i in 0..self.data_vector.len() {
                all_data.append(self.data_vector.at(i).read());
            };
            all_data
        }

        fn get_user_data(self: @ContractState, user: ContractAddress) -> felt252 {
            self.user_data_map.entry(user).read()
        }
    }
}