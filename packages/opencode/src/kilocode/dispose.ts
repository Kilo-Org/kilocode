// kilocode_change - new file
/**
 * Debounced Instance.disposeAll() helper.
 *
 * Bulk operations like legacy migration call client.auth.set() for each provider
 * in rapid succession. Calling Instance.disposeAll() immediately on every auth
 * change causes repeated disposal/recreation cycles. This module coalesces all
 * dispose requests within a 300ms window into a single disposal call.
 */
import { Instance } from "../project/instance"

let timer: ReturnType<typeof setTimeout> | undefined

export function scheduleDisposeAll() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = undefined
    void Instance.disposeAll().catch(() => undefined)
  }, 300)
}
