import type { WorkStyleState } from "../../../src/shared/work-style-presets"

export function resolveWorkStyleOnboarding(current: boolean, style: WorkStyleState): boolean {
  if (style === "unset") return true
  if (style === "skipped") return current
  return false
}
