#[contract]
mod SnapshotMerkleDistributor {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use array::ArrayTrait;
    use core::serde::Serde;
    use super::ICARELToken;

    #[storage]
    struct Storage {
        token: ContractAddress,
        owner: ContractAddress,
        backend_signer: ContractAddress,
        epoch_data: LegacyMap<u64, EpochData>,
        claimed: LegacyMap<(u64, ContractAddress), bool>,
        min_stake_amount: u256,
        claim_expiry_days: u64,
        tax_percentage: u64, // basis points (500 = 5%)
        dev_tax_wallet: ContractAddress,
        treasury_wallet: ContractAddress,
        current_epoch: u64,
    }

    #[derive(Drop, Serde)]
    struct EpochData {
        merkle_root: felt252,
        total_points: u256,
        reward_pool: u256,
        snapshot_time: u64,
        is_finalized: bool,
    }

    #[derive(Drop, Serde)]
    struct MerkleClaim {
        user: ContractAddress,
        amount: u256,
        epoch: u64,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        EpochFinalized: EpochFinalized,
        RewardClaimed: RewardClaimed,
        MerkleRootUpdated: MerkleRootUpdated,
    }

    #[derive(Drop, starknet::Event)]
    struct EpochFinalized {
        epoch: u64,
        reward_pool: u256,
        total_points: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct RewardClaimed {
        user: ContractAddress,
        epoch: u64,
        amount: u256,
        tax_amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct MerkleRootUpdated {
        epoch: u64,
        merkle_root: felt252,
        by: ContractAddress,
    }

    #[constructor]
    fn constructor(
        token_address: ContractAddress,
        backend_signer: ContractAddress,
        dev_tax_wallet: ContractAddress,
        treasury_wallet: ContractAddress
    ) {
        storage.token.write(token_address);
        storage.owner.write(get_caller_address());
        storage.backend_signer.write(backend_signer);
        storage.dev_tax_wallet.write(dev_tax_wallet);
        storage.treasury_wallet.write(treasury_wallet);
        storage.min_stake_amount.write(100 * 10**18); // 100 CAREL
        storage.claim_expiry_days.write(30);
        storage.tax_percentage.write(500); // 5%
        storage.current_epoch.write(1);
    }

    #[external(v0)]
    fn set_merkle_root(epoch: u64, merkle_root: felt252, total_points: u256) {
        // Hanya backend signer yang bisa set merkle root
        assert(get_caller_address() == storage.backend_signer.read(), 'Unauthorized');
        
        let epoch_data = EpochData {
            merkle_root: merkle_root,
            total_points: total_points,
            reward_pool: 13888888 * 10**18, // 13,888,888 CAREL
            snapshot_time: get_block_timestamp(),
            is_finalized: true,
        };
        
        storage.epoch_data.write(epoch, epoch_data);
        
        let mut events = array![];
        events.append(Event::MerkleRootUpdated(MerkleRootUpdated {
            epoch: epoch,
            merkle_root: merkle_root,
            by: get_caller_address(),
        }));
        starknet::emit_event_syscall(events.span()).unwrap();
    }

    #[external(v0)]
    fn claim(
        epoch: u64,
        amount: u256,
        proof: Array<felt252>
    ) -> u256 {
        let user = get_caller_address();
        
        // Cek belum pernah claim
        assert(!storage.claimed.read((epoch, user)), 'Already claimed');
        
        // Cek epoch sudah finalized
        let epoch_data = storage.epoch_data.read(epoch);
        assert(epoch_data.is_finalized, 'Epoch not finalized');
        
        // Cek tidak expired (30 hari)
        let current_time = get_block_timestamp();
        let expiry_time = epoch_data.snapshot_time + (storage.claim_expiry_days.read() * 24 * 3600);
        assert(current_time <= expiry_time, 'Claim expired');
        
        // Verify merkle proof
        let leaf = _hash_leaf(user, amount, epoch);
        assert(_verify_proof(leaf, epoch_data.merkle_root, proof), 'Invalid proof');
        
        // Hitung tax 5%
        let tax_amount = (amount * storage.tax_percentage.read().into()) / 10000;
        let net_amount = amount - tax_amount;
        
        // Split tax: 2.5% dev, 2.5% treasury
        let dev_tax = tax_amount / 2;
        let treasury_tax = tax_amount - dev_tax;
        
        // Transfer tokens
        let token = ICARELTokenDispatcher { contract_address: storage.token.read() };
        
        // Transfer ke user
        token.transfer(user, net_amount);
        
        // Transfer tax
        token.transfer(storage.dev_tax_wallet.read(), dev_tax);
        token.transfer(storage.treasury_wallet.read(), treasury_tax);
        
        // Mark as claimed
        storage.claimed.write((epoch, user), true);
        
        let mut events = array![];
        events.append(Event::RewardClaimed(RewardClaimed {
            user: user,
            epoch: epoch,
            amount: net_amount,
            tax_amount: tax_amount,
        }));
        starknet::emit_event_syscall(events.span()).unwrap();
        
        net_amount
    }

    #[external(v0)]
    fn finalize_epoch(epoch: u64, reward_pool: u256) {
        assert(get_caller_address() == storage.owner.read(), 'Ownable: caller is not owner');
        
        let mut epoch_data = storage.epoch_data.read(epoch);
        epoch_data.is_finalized = true;
        epoch_data.reward_pool = reward_pool;
        storage.epoch_data.write(epoch, epoch_data);
        
        // Update current epoch
        storage.current_epoch.write(epoch + 1);
        
        let mut events = array![];
        events.append(Event::EpochFinalized(EpochFinalized {
            epoch: epoch,
            reward_pool: reward_pool,
            total_points: epoch_data.total_points,
        }));
        starknet::emit_event_syscall(events.span()).unwrap();
    }

    #[external(v0)]
    fn has_claimed(user: ContractAddress, epoch: u64) -> bool {
        storage.claimed.read((epoch, user))
    }

    #[external(v0)]
    fn get_epoch_data(epoch: u64) -> EpochData {
        storage.epoch_data.read(epoch)
    }

    #[external(v0)]
    fn set_min_stake_amount(amount: u256) {
        assert(get_caller_address() == storage.owner.read(), 'Ownable: caller is not owner');
        storage.min_stake_amount.write(amount);
    }

    #[external(v0)]
    fn set_tax_percentage(percentage: u64) {
        assert(get_caller_address() == storage.owner.read(), 'Ownable: caller is not owner');
        assert(percentage <= 1000, 'Tax cannot exceed 10%');
        storage.tax_percentage.write(percentage);
    }

    fn _hash_leaf(user: ContractAddress, amount: u256, epoch: u64) -> felt252 {
        // Implementasi hash leaf sederhana
        // Di production gunakan pedersen hash
        let mut data = array![];
        data.append(user.into());
        data.append(amount.low.into());
        data.append(amount.high.into());
        data.append(epoch.into());
        
        // Return hash dari data
        starknet::pedersen(data.span())
    }

    fn _verify_proof(leaf: felt252, root: felt252, proof: Array<felt252>) -> bool {
        // Implementasi verify merkle proof sederhana
        // Di production gunakan library merkle tree yang proper
        let mut computed_hash = leaf;
        
        let proof_len = proof.len();
        let mut i = 0;
        loop {
            if i >= proof_len {
                break;
            }
            
            let proof_element = proof.at(i);
            
            if computed_hash < proof_element {
                computed_hash = starknet::pedersen(array![computed_hash, proof_element].span());
            } else {
                computed_hash = starknet::pedersen(array![proof_element, computed_hash].span());
            }
            
            i += 1;
        }
        
        computed_hash == root
    }
}