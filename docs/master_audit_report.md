Daftar Isi

Ringkasan Eksekutif
Scope Audit
Ringkasan Temuan
Temuan Detail -- Batch 1 (18 Kontrak)
Temuan Detail -- Batch 2 (17 Kontrak)
Rekomendasi dan Checklist Deployment

## 1. Ringkasan Eksekutif

Audit ini mencakup 35 smart contract Cairo yang membentuk ekosistem Carel Protocol, meliputi: token issuance, governance, vesting, treasury, staking multi-aset, swap aggregation, privacy routing, referral, reward distribution, AI executor, dan game ZK.

Ditemukan total 25 temuan keamanan: 6 Critical, 9 High, 6 Medium, dan 4 Low/Info. Semua temuan Critical dan High wajib diperbaiki sebelum mainnet deployment.

| Severity | Jumlah |
| --- | --- |
| CRITICAL | 6 |
| HIGH | 9 |
| MEDIUM | 6 |
| LOW / INFO | 4 |
| Total | 25 |

## 2. Scope Audit

Batch 1 -- Core Protocol (18 Kontrak)

| # | File |
| --- | --- |
| 1 | carel_protocol.cairo |
| 2 | fee_collector.cairo |
| 3 | registry.cairo |
| 4 | token.cairo |
| 5 | treasury.cairo |
| 6 | vesting_manager.cairo |
| 7 | governance.cairo |
| 8 | timelock.cairo |
| 9 | emergency_pause.cairo |
| 10 | multisig.cairo |
| 11 | price_oracle.cairo |
| 12 | twap_oracle.cairo |
| 13 | merkle_verifier.cairo |
| 14 | point_storage.cairo |
| 15 | point_token.cairo |
| 16 | referral_system.cairo |
| 17 | rewards_escrow.cairo |
| 18 | snapshot_distributor.cairo |

Batch 2 -- Trading, Staking, AI, dan Game (17 Kontrak)

| # | File |
| --- | --- |
| 19 | discount_soulbound.cairo |
| 20 | battleship_garaga.cairo |
| 21 | dca_orders.cairo |
| 22 | privacy_intermediary.cairo |
| 23 | staking.cairo |
| 24 | staking_carel.cairo |
| 25 | staking_lp.cairo |
| 26 | staking_stablecoin.cairo |
| 27 | staking_wbtc.cairo |
| 28 | action_types.cairo |
| 29 | privacy_router.cairo |
| 30 | private_swap.cairo |
| 31 | router.cairo |
| 32 | swap_aggregator.cairo |
| 33 | ai_executor.cairo |
| 34 | ai_signature_verifier.cairo |
| 35 | action_types.cairo (swap module) |

## 3. Ringkasan Temuan

| ID | Judul | Severity | File |
| --- | --- | --- | --- |
| C-01 | swap() dan stake_btc() -- Tidak ada logika bisnis | CRITICAL | carel_protocol.cairo |
| C-02 | Emergency Pause tidak memanggil kontrak eksternal | CRITICAL | emergency_pause.cairo |
| C-03 | execute() governance -- tidak ada end-block dan quorum | CRITICAL | governance.cairo |
| C-04 | update_observation() TWAP tanpa access control | CRITICAL | twap_oracle.cairo |
| C-05 | private_swap.cairo dan router.cairo -- Sintaks Cairo 0 legacy | CRITICAL | private_swap.cairo, router.cairo |
| C-06 | execute_limit_order() -- tidak ada transfer token aktual | CRITICAL | dca_orders.cairo |
| H-01 | collect_* fee tanpa access control | HIGH | fee_collector.cairo |
| H-02 | Bridge dev-fee underflow jika provider_share > bridge_fee_rate | HIGH | fee_collector.cairo |
| H-03 | Flag executing di Multisig memungkinkan reentrancy | HIGH | multisig.cairo |
| H-04 | authorized_updaters PriceOracle tidak bisa diisi | HIGH | price_oracle.cairo |
| H-05 | Merkle root bisa ditimpa setelah klaim dimulai | HIGH | snapshot_distributor.cairo |
| H-06 | use_discount_batch() tanpa validasi caller | HIGH | discount_soulbound.cairo |
| H-07 | CEI violation -- nullifier di Battleship di-set setelah external call | HIGH | battleship_garaga.cairo |
| H-08 | CEI violation -- nonce di-set setelah external call | HIGH | privacy_intermediary.cairo |
| H-09 | batch_execute_actions() -- satu signature untuk semua aksi | HIGH | ai_executor.cairo |
| M-01 | fund_rewards() catat tanpa transfer token | MEDIUM | treasury.cairo |
| M-02 | set_privacy_router tanpa access control (3 kontrak) | MEDIUM | carel_protocol.cairo, governance.cairo, twap_oracle.cairo |
| M-03 | update_data() Registry tanpa validasi ownership | MEDIUM | registry.cairo |
| M-04 | set_privacy_router StakingCarel tanpa access control | MEDIUM | staking_carel.cairo |
| M-05 | _calculate_tier() panic untuk amount < 100 CAREL | MEDIUM | staking_carel.cairo |
| M-06 | execute_limit_order() tanpa access control | MEDIUM | dca_orders.cairo |
| L-01 | TWAP adalah rata-rata biasa, bukan time-weighted | LOW | twap_oracle.cairo |
| L-02 | backend_signer single point of failure | LOW | point_storage.cairo, snapshot_distributor.cairo, referral_system.cairo |
| L-03 | Ekosistem vesting -- nilai intermediate bisa melampaui cap | LOW | vesting_manager.cairo |
| L-04 | WBTC Staking -- semua tier APY identik | LOW | staking_wbtc.cairo |

## 4. Temuan Detail -- Batch 1

### C-01

Judul: swap() dan stake_btc() -- Tidak Ada Logika Bisnis  
Severity: CRITICAL  
File: carel_protocol.cairo  
Lokasi: CarelProtocol::swap(), CarelProtocol::stake_btc()

Deskripsi:  
Kedua fungsi swap() dan stake_btc() sama sekali tidak memiliki validasi input, state transition, maupun transfer token. Keduanya hanya memancarkan event tanpa syarat apapun, terlepas dari nilai input yang diberikan.

Dampak:  
Siapapun dapat memanggil swap() dengan amount nol atau token sembarang dan mendapat event SwapExecuted. Log event dapat dibanjiri data palsu, merusak analytics dan sistem reward off-chain. Pengguna yang mengira swap sudah dieksekusi tidak mendapat token apapun.

Kode rentan:
```cairo
fn swap(ref self: ContractState, amount: u256, ...) {
    let caller = get_caller_address();
    self.emit(SwapExecuted { ... }); // Hanya emit, tidak ada transfer
}
```

Rekomendasi:
```cairo
fn swap(
    ref self: ContractState,
    amount: u256,
    token_from: ContractAddress,
    token_to: ContractAddress
) {
    assert!(amount > 0, "Amount must be > 0");
    assert!(token_from != token_to, "Same token");
    assert!(self.active_wrappers.entry(token_from).read(), "Token not active");
    // ... ERC20 transferFrom ...
    self.emit(SwapExecuted { ... });
}
```

### C-02

Judul: Emergency Pause Tidak Memanggil Kontrak Eksternal  
Severity: CRITICAL  
File: emergency_pause.cairo  
Lokasi: EmergencyPause::pause_all(), unpause_all()

Deskripsi:  
pause_all() hanya mengubah flag paused lokal dan emit event, tanpa pernah mengiterasi contracts_to_pause untuk memanggil fungsi pause pada kontrak terdaftar.

Dampak:  
Insiden keamanan yang membutuhkan pause seluruh protokol tidak dapat dilaksanakan. Setiap kontrak individual terus beroperasi normal meskipun pause_all() sudah dipanggil oleh GUARDIAN_ROLE.

Kode rentan:
```cairo
fn pause_all(ref self: ContractState, reason: ByteArray) {
    self.access_control.assert_only_role(GUARDIAN_ROLE);
    self.paused.write(true); // Hanya set flag lokal
    self.emit(EmergencyPaused { ... });
    // contracts_to_pause TIDAK PERNAH diiterasi
}
```

Rekomendasi:
```cairo
fn pause_all(ref self: ContractState, reason: ByteArray) {
    self.access_control.assert_only_role(GUARDIAN_ROLE);
    assert!(!self.paused.read(), "Already paused");
    self.paused.write(true);
    let len = self.contracts_to_pause.len();
    let mut i: u64 = 0;
    while i < len {
        let addr = self.contracts_to_pause.at(i).read();
        // panggil addr.pause() via IPausable dispatcher
        i += 1;
    };
    self.emit(EmergencyPaused { ... });
}
```

### C-03

Judul: Governance execute() -- Tidak Ada End-Block dan Quorum Check  
Severity: CRITICAL  
File: governance.cairo  
Lokasi: Governance::execute()

Deskripsi:  
execute() hanya memeriksa for_votes > against_votes dan !proposal.executed. Tidak ada pengecekan bahwa voting sudah berakhir (current_block > end_block), dan tidak ada quorum minimum. Satu suara sudah cukup untuk lolos.

Dampak:  
Proposer yang memiliki saldo token apapun dapat membuat proposal, langsung memvote, lalu mengeksekusi proposal tersebut sebelum token holder lain berkesempatan bereaksi. Ini dapat menguras treasury atau mengubah parameter protokol.

Kode rentan:
```cairo
fn execute(ref self: ContractState, proposal_id: u256, ...) {
    let proposal = self.proposals.entry(proposal_id).read();
    assert!(proposal.for_votes > proposal.against_votes, "Did not pass");
    assert!(!proposal.executed, "Already executed");
    // Tidak ada pengecekan end_block dan quorum
}
```

Rekomendasi:
```cairo
fn execute(ref self: ContractState, proposal_id: u256, ...) {
    let current_block = get_block_number();
    assert!(current_block > proposal.end_block, "Voting not ended");
    assert!(proposal.for_votes > proposal.against_votes, "Did not pass");
    let quorum = self.quorum_votes.read();
    assert!(proposal.for_votes >= quorum, "Quorum not reached");
    assert!(!proposal.executed, "Already executed");
}
```

### C-04

Judul: update_observation() TWAP Tanpa Access Control  
Severity: CRITICAL  
File: twap_oracle.cairo  
Lokasi: TWAPOracle::update_observation()

Deskripsi:  
update_observation() tidak memiliki pengecekan caller sama sekali. Alamat manapun dapat memasukkan nilai harga sembarang ke dalam running_sum oracle, memanipulasi output TWAP maupun spot price.

Dampak:  
TWAP dapat dimanipulasi dengan biaya sangat rendah, berdampak pada kualitas quote swap, valuasi kolateral, dan perhitungan reward yang bergantung pada get_twap() atau get_spot_price().

Kode rentan:
```cairo
fn update_observation(ref self: ContractState, token: ContractAddress, price: u256) {
    // Tidak ada access control check
    let mut state = self.twap_state.entry(token).read();
    state.running_sum += price;
    state.count += 1;
    ...
}
```

Rekomendasi:
```cairo
fn update_observation(ref self: ContractState, token: ContractAddress, price: u256) {
    let caller = get_caller_address();
    assert!(
        self.authorized_feeders.entry(caller).read(),
        "Not an authorized price feeder"
    );
    // ... lanjutkan logika
}
```

### C-05

Judul: private_swap.cairo dan router.cairo -- Sintaks Cairo 0 Legacy  
Severity: CRITICAL  
File: private_swap.cairo, router.cairo  
Lokasi: seluruh file

Deskripsi:  
Kedua file menggunakan sintaks Cairo 0 yang sudah deprecated. File-file ini tidak akan dikompilasi dengan Cairo compiler modern (v2.x+). Selain itu, private_swap.cairo menyimpan Array<felt252> di dalam Map storage, yang tidak didukung di Cairo.

Dampak:  
Kedua kontrak ini tidak dapat di-deploy. Fungsi inti swap dan routing tidak tersedia untuk pengguna.

Rekomendasi:  
Tulis ulang kedua file menggunakan sintaks Cairo 2.x yang sesuai. Gunakan struktur data yang didukung (misalnya Vec<felt252>) untuk menggantikan Map<ContractAddress, Array<felt252>>.

### C-06

Judul: execute_limit_order() -- Tidak Ada Transfer Token Aktual  
Severity: CRITICAL  
File: dca_orders.cairo  
Lokasi: LimitOrderBook::execute_limit_order(), create_limit_order()

Deskripsi:  
execute_limit_order() hanya mengubah status order menjadi "filled" dan emit event, tanpa melakukan transfer token. create_limit_order() tidak mengunci token pengguna saat pembuatan order. Seluruh alur keuangan berjalan hanya di atas kertas.

Dampak:  
Pengguna yang percaya ordernya tereksekusi tidak menerima token apapun. Fee hanya di-emit sebagai event, tidak berpindah ke recipient.

Kode rentan:
```cairo
fn execute_limit_order(ref self: ContractState, order_id: felt252, order_value: u256) {
    // ... cek oracle price ...
    order.status = 2_u8;
    self.limit_orders.entry(order_id).write(order);
    self.emit(LimitOrderExecuted { ... });
    // Tidak ada transferFrom, tidak ada transfer ke order.owner
}
```

Rekomendasi:  
Tambahkan transferFrom saat create_limit_order untuk mengunci token, dan tambahkan transfer ke owner saat order tereksekusi.

## 5. Temuan Detail -- Batch 2

### H-01

Judul: collect_* fee tanpa access control  
Severity: HIGH  
File: fee_collector.cairo  
Lokasi: collect_swap_fee(), collect_bridge_fee(), collect_mev_fee()

Deskripsi:  
Semua fungsi pengumpulan fee tidak memiliki pengecekan caller. Siapapun dapat memanggil collect_* dengan token dan amount sembarang.

Dampak:  
Penyerang dapat menggelembungkan saldo LP fee atau memicu logika burn CAREL yang tidak diinginkan jika token CAREL dimasukkan sebagai parameter.

Rekomendasi:
```cairo
fn collect_swap_fee(ref self: ContractState, ...) {
    assert!(
        self.authorized_routers.entry(get_caller_address()).read(),
        "Not an authorized router"
    );
    ...
}
```

### H-02

Judul: Bridge Dev-Fee Underflow  
Severity: HIGH  
File: fee_collector.cairo  
Lokasi: collect_bridge_fee()

Deskripsi:  
Jika bridge_provider_share > bridge_fee_rate, dev_fee = total_fee - provider_fee akan underflow dan menyebabkan panic.

Rekomendasi:
```cairo
let total_fee = (amount * self.bridge_fee_rate.read()) / BPS_DENOMINATOR;
let provider_fee = (total_fee * self.bridge_provider_share.read())
    / self.bridge_fee_rate.read();
let dev_fee = total_fee - provider_fee;
```

### H-03

Judul: Flag executing di Multisig Memungkinkan Reentrancy  
Severity: HIGH  
File: multisig.cairo  
Lokasi: execute_transaction(), assert_only_self(), add_owner(), remove_owner()

Deskripsi:  
assert_only_self() melewati pengecekan caller ketika executing == true. Selama execute_transaction() berjalan, flag ini aktif, memungkinkan kontrak target re-enter ke multisig.

Rekomendasi:
```cairo
fn assert_only_self(self: @ContractState) {
    assert!(
        get_caller_address() == get_contract_address(),
        "Only contract can call this"
    );
}
```

### H-04

Judul: authorized_updaters PriceOracle Tidak Bisa Diisi  
Severity: HIGH  
File: price_oracle.cairo  
Lokasi: update_price_manual()

Deskripsi:  
Map authorized_updaters dicek, tetapi tidak ada fungsi untuk mengisinya. Akibatnya update_price_manual() permanen terkunci.

Rekomendasi:
```cairo
fn set_authorized_updater(
    ref self: ContractState,
    updater: ContractAddress,
    authorized: bool
) {
    assert!(get_caller_address() == self.owner.read(), "Only owner");
    self.authorized_updaters.entry(updater).write(authorized);
}
```

### H-05

Judul: Merkle Root Bisa Ditimpa Setelah Klaim Dimulai  
Severity: HIGH  
File: snapshot_distributor.cairo  
Lokasi: submit_merkle_root()

Deskripsi:  
submit_merkle_root() tidak memeriksa apakah root untuk epoch tersebut sudah ada. Root aktif dapat diganti kapan saja.

Rekomendasi:
```cairo
fn submit_merkle_root(ref self: ContractState, epoch: u64, root: felt252) {
    assert!(get_caller_address() == self.backend_signer.read(), ...);
    let existing = self.merkle_roots.entry(epoch).read();
    assert!(existing == 0, "Root already finalized for epoch");
    self.merkle_roots.entry(epoch).write(root);
}
```

### H-06

Judul: use_discount_batch() Tanpa Validasi Caller  
Severity: HIGH  
File: discount_soulbound.cairo  
Lokasi: use_discount(), use_discount_batch()

Deskripsi:  
Fungsi menerima parameter user tanpa memastikan caller adalah user atau kontrak terotorisasi.

Rekomendasi:
```cairo
fn use_discount_batch(ref self: ContractState, user: ContractAddress, uses: u256) -> u256 {
    let caller = get_caller_address();
    assert!(
        caller == user || self.authorized_callers.entry(caller).read(),
        "Unauthorized caller"
    );
    ...
}
```

### H-07

Judul: CEI Violation -- Nullifier di Battleship Di-set Setelah External Call  
Severity: HIGH  
File: battleship_garaga.cairo  
Lokasi: InternalImpl::_verify_action_proof()

Deskripsi:  
Nullifier ditandai used setelah external call ke verifier. Ini melanggar CEI.

Rekomendasi:
```cairo
fn _verify_action_proof(ref self: ContractState, ...) {
    assert!(!self.nullifier_used.read(nullifier), "Nullifier already used");
    self.nullifier_used.write(nullifier, true);
    let verification = dispatcher.verify_groth16_proof_bls12_381(proof);
    match verification {
        Option::Some(_) => {},
        Option::None => panic!("Invalid proof"),
    }
}
```

### H-08

Judul: CEI Violation -- Nonce di PrivacyIntermediary Di-set Setelah External Call  
Severity: HIGH  
File: privacy_intermediary.cairo  
Lokasi: PrivacyIntermediary::execute()

Deskripsi:  
used_nonces.write(nonce_key, true) dilakukan setelah dua external call.

Rekomendasi:
```cairo
fn execute(ref self: ContractState, ...) {
    assert!(!self.used_nonces.read(nonce_key), "Nonce already used");
    self.used_nonces.write(nonce_key, true);
    let _ = call_contract_syscall(executor, params.submit_selector, ...).unwrap_syscall();
    let _ = call_contract_syscall(executor, params.execute_selector, ...).unwrap_syscall();
}
```

### H-09

Judul: batch_execute_actions() -- Satu Signature untuk Semua Aksi  
Severity: HIGH  
File: ai_executor.cairo  
Lokasi: AIExecutor::batch_execute_actions()

Deskripsi:  
batch_execute_actions() menerima satu backend_signature lalu digunakan untuk semua action_hash, sehingga verifikasi signature gagal saat signature_verification_enabled = true.

Rekomendasi:  
Gunakan array signature (satu per aksi) atau gunakan batch-hash gabungan.

### M-01

Judul: fund_rewards() Catat Tanpa Transfer Token  
Severity: MEDIUM  
File: treasury.cairo  
Lokasi: Treasury::fund_rewards(), batch_fund_rewards()

Deskripsi:  
Fungsi memperbarui map distributed_rewards dan emit event, tanpa memindahkan token.

Rekomendasi:  
Tambahkan transfer token sebelum akuntansi diperbarui.

### M-02

Judul: set_privacy_router Tanpa Access Control (3 Kontrak)  
Severity: MEDIUM  
File: carel_protocol.cairo, governance.cairo, twap_oracle.cairo  
Lokasi: set_privacy_router()

Rekomendasi:
```cairo
fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
    self.ownable.assert_only_owner();
    assert!(!router.is_zero(), "Privacy router required");
    self.privacy_router.write(router);
}
```

### M-03

Judul: update_data() Registry Tanpa Validasi Ownership  
Severity: MEDIUM  
File: registry.cairo  
Lokasi: Registry::update_data()

Rekomendasi:  
Tambahkan map data_owner dan validasi sebelum update.

### M-04

Judul: set_privacy_router StakingCarel Tanpa Access Control  
Severity: MEDIUM  
File: staking_carel.cairo  
Lokasi: StakingCarelPrivacyImpl::set_privacy_router()

Rekomendasi:
```cairo
fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
    assert!(get_caller_address() == self.owner.read(), "Unauthorized");
    assert!(!router.is_zero(), "Privacy router required");
    self.privacy_router.write(router);
}
```

### M-05

Judul: _calculate_tier() Panic untuk Amount < 100 CAREL  
Severity: MEDIUM  
File: staking_carel.cairo  
Lokasi: InternalFunctions::_calculate_tier()

Rekomendasi:
```cairo
fn _calculate_tier(self: @ContractState, amount: u256) -> u8 {
    let one_carel: u256 = 1000000000000000000;
    if amount >= 10000 * one_carel { return 3; }
    if amount >= 1000 * one_carel { return 2; }
    if amount >= 100 * one_carel { return 1; }
    0
}
```

### M-06

Judul: execute_limit_order() Tanpa Access Control  
Severity: MEDIUM  
File: dca_orders.cairo  
Lokasi: LimitOrderBook::execute_limit_order()

Rekomendasi:  
Tambahkan keeper allowlist dan validasi oracle sebelum eksekusi.

### L-01

Judul: TWAP Adalah Rata-Rata Biasa, Bukan Time-Weighted  
Severity: LOW  
File: twap_oracle.cairo

Rekomendasi:  
Gunakan cumulative price * duration / total elapsed time.

### L-02

Judul: backend_signer Single Point of Failure  
Severity: LOW  
File: point_storage.cairo, snapshot_distributor.cairo, referral_system.cairo

Rekomendasi:  
Gunakan multisig atau key rotation dengan timelock.

### L-03

Judul: Ekosistem Vesting -- Nilai Intermediate Bisa Melampaui Cap  
Severity: LOW  
File: vesting_manager.cairo  
Lokasi: calculate_releasable() -- cabang Ecosystem

Rekomendasi:
```cairo
let mut vested = ECOSYSTEM_MONTHLY_RELEASE * months_elapsed.into();
if vested > schedule.total_amount {
    vested = schedule.total_amount;
}
```

### L-04

Judul: WBTC Staking -- Semua Tier APY Identik  
Severity: LOW  
File: staking_wbtc.cairo  
Lokasi: InternalFunctions::_calculate_pending()

Rekomendasi:  
Diferensiasikan APY per tier, misalnya Tier 1 = 4%, Tier 2 = 6%, Tier 3 = 8%.

## 6. Rekomendasi dan Checklist Deployment

Wajib sebelum mainnet (Critical dan High):

1. C-01 -- Implementasikan logika swap dan staking sesungguhnya di carel_protocol.cairo  
2. C-02 -- Perbaiki emergency_pause.cairo agar mengiterasi dan memanggil kontrak eksternal  
3. C-03 -- Tambahkan end-block check dan quorum minimum di governance.cairo  
4. C-04 -- Tambahkan access control di twap_oracle.cairo::update_observation()  
5. C-05 -- Tulis ulang private_swap.cairo dan router.cairo menggunakan sintaks Cairo 2.x  
6. C-06 -- Implementasikan transfer token aktual di dca_orders.cairo  
7. H-01 -- Batasi collect_* di fee_collector.cairo ke authorized routers  
8. H-02 -- Perbaiki perhitungan bridge dev-fee agar berbasis total_fee  
9. H-03 -- Hapus bypass flag executing di multisig.cairo::assert_only_self()  
10. H-04 -- Tambahkan set_authorized_updater() di price_oracle.cairo  
11. H-05 -- Cegah overwrite Merkle root di snapshot_distributor.cairo  
12. H-06 -- Tambahkan validasi caller di discount_soulbound.cairo::use_discount_batch()  
13. H-07 -- Perbaiki urutan CEI di battleship_garaga.cairo::_verify_action_proof()  
14. H-08 -- Set nonce sebelum external call di privacy_intermediary.cairo  
15. H-09 -- Perbaiki batch signature logic di ai_executor.cairo::batch_execute_actions()

Disarankan sebelum mainnet (Medium):

1. M-01 -- Tambahkan transfer token di treasury.cairo::fund_rewards()  
2. M-02 -- Tambahkan owner check ke semua set_privacy_router() yang belum aman  
3. M-03 -- Tambahkan ownership tracking di registry.cairo::update_data()  
4. M-04 -- Tambahkan owner check di staking_carel.cairo::set_privacy_router()  
5. M-05 -- Ubah _calculate_tier() agar tidak panic untuk amount kecil  
6. M-06 -- Tambahkan keeper allowlist di dca_orders.cairo::execute_limit_order()

Perbaikan jangka menengah (Low):

1. L-01 -- Implementasikan TWAP sesungguhnya  
2. L-02 -- Ganti single backend_signer dengan multisig atau timelock  
3. L-03 -- Tambahkan cap eksplisit di vesting Ecosystem  
4. L-04 -- Diferensiasikan APY per tier di WBTC staking

Rekomendasi tambahan:

1. Lakukan integration testing end-to-end pada alur governance -> timelock -> treasury -> vesting  
2. Tambahkan test suite untuk edge cases overflow dan underflow di semua kalkulasi reward  
3. Pertimbangkan formal verification untuk merkle_verifier.cairo dan vesting_manager.cairo  
4. Tinjau semua kontrak yang menggunakan call_contract_syscall langsung untuk memastikan tidak ada reentrancy path tersembunyi  
5. Audit ulang setelah rewrite private_swap.cairo dan router.cairo
