import React from "react"
import type { Metadata, Viewport } from 'next'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ZkCarel - Privacy-First Crypto Trading',
  description: 'Trade cryptocurrencies with zero-knowledge privacy. Swap, bridge, and earn rewards on the most advanced DeFi platform.',
  generator: 'ZkCarel',
  keywords: ['crypto', 'trading', 'DeFi', 'privacy', 'zero-knowledge', 'swap', 'bridge'],
  authors: [{ name: 'ZkCarel Team' }],
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
      <body className="font-sans antialiased min-h-screen bg-background circuit-bg">
        {children}
        <Analytics />
      </body>
    </html>
  )
}
