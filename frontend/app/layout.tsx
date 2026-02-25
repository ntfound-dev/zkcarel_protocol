import React from "react"
import type { Metadata, Viewport } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { Orbitron, Exo_2 } from "next/font/google"
import './globals.css'

const orbitron = Orbitron({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
  variable: "--font-orbitron",
})

const exo2 = Exo_2({
  subsets: ["latin"],
  weight: ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
  display: "swap",
  variable: "--font-exo2",
})

export const metadata: Metadata = {
  title: 'Carel Protocol - Privacy-First Crypto Trading',
  description: 'Trade cryptocurrencies with zero-knowledge privacy. Swap, bridge, and earn rewards on the most advanced DeFi platform.',
  generator: 'Carel Protocol',
  keywords: ['crypto', 'trading', 'DeFi', 'privacy', 'zero-knowledge', 'swap', 'bridge'],
  authors: [{ name: 'Carel Protocol Team' }],
}

export const viewport: Viewport = {
  themeColor: '#9D00FF',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className="dark"
      suppressHydrationWarning
    >
      <body className={`${orbitron.variable} ${exo2.variable} font-sans antialiased min-h-screen bg-background circuit-bg`}>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
