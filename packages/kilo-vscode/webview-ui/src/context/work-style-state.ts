import type { WorkStyleState } from "../../../src/shared/work-style-presets"

/**
 * Whether the first-run picker should be visible after a state load. A skipped state keeps the picker that is already
 * visible, so a load that races a new task does not bring it back.
 */
export function resolveWorkStyleOnboarding(current: boolean, style: WorkStyleState): boolean {
  if (style === "unset") return true
  if (style === "skipped") return current
  return false
}
