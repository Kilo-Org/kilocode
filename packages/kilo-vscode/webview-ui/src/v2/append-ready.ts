import { onCleanup } from "solid-js"
import type { BrowserReference } from "../../../src/shared/browser-feedback"

export type AppendHandler = (value: string, send: boolean) => void

/** Adds an element picked in the Integrated Browser to the composer's reference list. */
export type ReferenceHandler = (reference: BrowserReference) => void

/**
 * Hands a composer function to its caller and clears it when the composer disposes. A caller that keeps this
 * function must not call it into a composer that already unmounted.
 */
export function registerAppend<T = AppendHandler>(report: ((value: T | undefined) => void) | undefined, value: T) {
  report?.(value)
  onCleanup(() => report?.(undefined))
}
