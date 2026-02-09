# CAREL Protocol Plan Addendum

## Scope Additions (Not in README)
1. ZK social login dApp using Sumo Login.
2. BTC wallet + bridge integration using Xverse API.
3. Global leaderboard metrics (points, volume, referrals) aggregated by backend.
4. Nullifier status endpoints for privacy modules (anon credentials, dark pool, private payments).
5. Additional tests for private BTC swap, dark pool, private payments.

## Delivery Steps
1. Backend integration plan
   - Add Sumo Login auth provider module.
   - Add Xverse BTC address/session handling for bridge flows.
   - Expose leaderboard global metrics endpoints (points/volume/referrals).
2. Smart contract alignment
   - Ensure nullifier checks are viewable for privacy modules.
   - Keep adapters/verifiers compatible with backend payloads.
3. QA
   - Run Cairo tests for privacy modules.
   - Add API integration tests for nullifier endpoints.

## Owners
- Smart Contract: CAREL Team
- Backend: CAREL Team
- Frontend: CAREL Team
