import { onCleanup } from "solid-js"

export type AppendHandler = (value: string, send: boolean) => void

/**
 * Hands the composer append function to its caller and clears it when the composer disposes. A caller that keeps
 * this function must not append into a composer that already unmounted.
 */
export function registerAppend(
  report: ((append: AppendHandler | undefined) => void) | undefined,
  append: AppendHandler,
) {
  report?.(append)
  onCleanup(() => report?.(undefined))
}
