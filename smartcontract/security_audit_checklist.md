# CAREL Protocol Security Audit Checklist

## Access Control
- [ ] Only owner can change critical parameters
- [ ] VestingManager: Only owner can create vesting schedules
- [ ] Treasury: Only owner can burn tokens
- [ ] Router: Only owner can add DEXes/bridges
- [ ] NFT: Only router can use discounts
- [ ] Points: Only approved contracts can add points

## Input Validation
- [ ] All amounts checked for > 0
- [ ] Address validation (not zero address)
- [ ] Deadline validation
- [ ] Slippage protection
- [ ] Tier bounds checking

## Arithmetic Safety
- [ ] No integer overflow/underflow
- [ ] Safe division (check denominator != 0)
- [ ] Fee calculation bounds
- [ ] Reward calculation accuracy

## State Management
- [ ] No reentrancy vulnerabilities
- [ ] Proper state updates before external calls
- [ ] No duplicate claims
- [ ] Proper vesting schedule tracking

## Token Safety
- [ ] ERC20 compliance
- [ ] Proper allowance handling
- [ ] Safe transfer patterns
- [ ] Mint/burn restrictions

## Emergency Measures
- [ ] Pause functionality (if implemented)
- [ ] Emergency withdrawal for stuck funds
- [ ] Upgradeability considerations
- [ ] Multisig requirements

## Integration Safety
- [ ] DEX integration safety
- [ ] Bridge integration safety
- [ ] Oracle price feed safety
- [ ] External contract call safety

## Testing Coverage
- [ ] Unit tests for all functions
- [ ] Integration tests for workflows
- [ ] Edge case testing
- [ ] Fuzz testing
- [ ] Load testing

## Documentation
- [ ] Code comments
- [ ] Function documentation
- [ ] Security assumptions documented
- [ ] Known limitations documented