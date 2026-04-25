export const DEFAULT_BALANCE: Record<string, number> = {
  ETH: 0,
  USDT: 0,
  USDC: 0,
  BTC: 0,
  STRK: 0,
  CAREL: 0,
}

export const STRK_TOKEN_ADDRESS =
  process.env.NEXT_PUBLIC_STRK_TOKEN_ADDRESS ||
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
export const STRK_DECIMALS = 18

export const CAREL_TOKEN_ADDRESS =
  process.env.NEXT_PUBLIC_TOKEN_CAREL_ADDRESS ||
  "0x0517f60f4ec4e1b2b748f0f642dfdcb32c0ddc893f777f2b595a4e4f6df51545"
export const CAREL_DECIMALS = 18

export const USDC_TOKEN_ADDRESS =
  process.env.NEXT_PUBLIC_TOKEN_USDC_ADDRESS ||
  "0x05a26f9680c5dc0c36dcf1670d7f51f24ba0080d15fedb7396d23a77bf5c1924"
export const USDC_DECIMALS = 6

export const USDT_TOKEN_ADDRESS =
  process.env.NEXT_PUBLIC_TOKEN_USDT_ADDRESS ||
  "0x07439bce89f5559b3f6aa1793291c5bb20c03adf5bac57debe4d7209c2cb053b"
export const USDT_DECIMALS = 6

export const WBTC_TOKEN_ADDRESS =
  process.env.NEXT_PUBLIC_TOKEN_WBTC_ADDRESS ||
  process.env.NEXT_PUBLIC_TOKEN_BTC_ADDRESS ||
  "0x496bef3ed20371382fbe0ca6a5a64252c5c848f9f1f0cccf8110fc4def912d5"
export const WBTC_DECIMALS = 8

export const STRK_L1_TOKEN_ADDRESS =
  process.env.NEXT_PUBLIC_STRK_L1_TOKEN_ADDRESS ||
  "0xca14007eff0db1f8135f4c25b34de49ab0d42766"
