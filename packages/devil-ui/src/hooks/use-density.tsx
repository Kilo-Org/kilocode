/**
 * useDensity / useDensityOptional — hooks for reading the current DensityContextValue.
 *
 * useDensity()         — throws when called outside a <DensityProvider>
 * useDensityOptional() — returns undefined when called outside a <DensityProvider> (no throw)
 *
 * Import DensityContext from context/density to avoid a circular dep:
 * hooks/use-density → context/density (one-way).
 */
import { useContext, type Accessor } from "solid-js"
import { DensityContext, type DensityContextValue } from "../context/density"

export type { DensityMode } from "../context/density"

/**
 * Returns the reactive DensityContextValue accessor.
 * Throws if called outside a <DensityProvider>.
 */
export function useDensity(): Accessor<DensityContextValue> {
  const ctx = useContext(DensityContext)
  if (!ctx) {
    throw new Error("useDensity must be called inside a <DensityProvider>")
  }
  return ctx
}

/**
 * Returns the reactive DensityContextValue accessor, or undefined if not inside a provider.
 * Safe to call unconditionally — useful in primitives that work with or without density context.
 */
export function useDensityOptional(): Accessor<DensityContextValue> | undefined {
  return useContext(DensityContext) ?? undefined
}
