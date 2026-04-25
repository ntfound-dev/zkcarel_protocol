export type ReferralTier = {
  tierId: number
  name: string
  minReferrals: number
  maxReferrals: number | null
  commissionPercent: number
  bonusCarel: number
}

export const referralTiers: ReferralTier[] = [
  {
    tierId: 1,
    name: "Bronze",
    minReferrals: 1,
    maxReferrals: 10,
    commissionPercent: 10,
    bonusCarel: 50,
  },
  {
    tierId: 2,
    name: "Silver",
    minReferrals: 11,
    maxReferrals: 25,
    commissionPercent: 15,
    bonusCarel: 150,
  },
  {
    tierId: 3,
    name: "Gold",
    minReferrals: 26,
    maxReferrals: 50,
    commissionPercent: 20,
    bonusCarel: 400,
  },
  {
    tierId: 4,
    name: "Platinum",
    minReferrals: 51,
    maxReferrals: null,
    commissionPercent: 25,
    bonusCarel: 1000,
  },
]

export const formatReferralRange = (tier: ReferralTier) => {
  if (typeof tier.maxReferrals === "number" && Number.isFinite(tier.maxReferrals)) {
    return `${tier.minReferrals}-${tier.maxReferrals}`
  }
  return `${tier.minReferrals}+`
}

export const resolveReferralTier = (totalReferrals: number) => {
  const matched = referralTiers.find((tier) => {
    const meetsMin = totalReferrals >= tier.minReferrals
    const meetsMax =
      tier.maxReferrals === null ||
      (Number.isFinite(tier.maxReferrals) && totalReferrals <= tier.maxReferrals)
    return meetsMin && meetsMax
  })
  return matched || referralTiers[0]
}

export const copyReferralToClipboard = ({
  text,
  setCopied,
  onCopied,
}: {
  text: string
  setCopied: (value: boolean) => void
  onCopied?: () => void
}) => {
  navigator.clipboard.writeText(text)
  setCopied(true)
  window.setTimeout(() => setCopied(false), 2000)
  onCopied?.()
}
