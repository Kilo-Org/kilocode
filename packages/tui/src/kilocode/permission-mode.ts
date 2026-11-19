// Runtime auto-approve for the TUI. The configured mode (`--auto` or `session.permissions`) is the starting value, and
// a toggle overrides it for this process, so switching never needs a config edit or a restart.
import { createSignal } from "solid-js"
import type { PermissionMode } from "../context/permission"

const [override, setOverride] = createSignal<PermissionMode | undefined>()

/** The runtime override, or undefined while the configured mode applies. */
export function permissionModeOverride() {
  return override()
}

export function setPermissionMode(mode: PermissionMode | undefined) {
  setOverride(mode)
}

/**
 * Flips the effective mode and returns the new one. An unrecognized mode degrades to prompting instead of granting the
 * bypass, so a future mode that reaches here cannot silently enable auto-approve.
 */
export function togglePermissionMode(current: PermissionMode) {
  const next: PermissionMode = current === "prompt" ? "autoaccept" : "prompt"
  setOverride(next)
  return next
}
