import { cn } from '@/lib/utils'

/**
 * Handles `Skeleton` logic.
 *
 * @param className - Input used by `Skeleton` to compute state, payload, or request behavior.
 * @param props - Input used by `Skeleton` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('bg-accent animate-pulse rounded-md', className)}
      {...props}
    />
  )
}

export { Skeleton }
