"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"

type TradeErrorBoundaryProps = {
  children: React.ReactNode
}

type TradeErrorBoundaryState = {
  hasError: boolean
  message: string
}

export class TradeErrorBoundary extends React.Component<
  TradeErrorBoundaryProps,
  TradeErrorBoundaryState
> {
  state: TradeErrorBoundaryState = {
    hasError: false,
    message: "",
  }

  static getDerivedStateFromError(error: unknown) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    return { hasError: true, message }
  }

  componentDidCatch(error: unknown) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Trade UI error boundary", error)
    }
  }

  private handleReload = () => {
    if (typeof window === "undefined") return
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="w-full max-w-xl mx-auto px-2 sm:px-0 pb-28 md:pb-0">
        <div className="p-4 sm:p-6 rounded-xl sm:rounded-2xl glass-strong border border-border neon-border">
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">Trading UI crashed</h2>
            <p className="text-sm text-muted-foreground">
              A rendering error occurred. Reload the page to recover the trading interface.
            </p>
            {this.state.message ? (
              <p className="text-xs text-muted-foreground break-words">
                {this.state.message}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button onClick={this.handleReload}>Reload</Button>
            </div>
          </div>
        </div>
      </div>
    )
  }
}
