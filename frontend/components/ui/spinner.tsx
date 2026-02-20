import { Loader2Icon } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Handles `Spinner` logic.
 *
 * @param className - Input used by `Spinner` to compute state, payload, or request behavior.
 * @param props - Input used by `Spinner` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  )
}

export { Spinner }
