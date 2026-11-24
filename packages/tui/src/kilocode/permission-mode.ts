// Runtime auto-approve for the TUI. The configured mode (`--auto` or the saved `session.permissions` setting) is the
// starting value; a toggle saves the choice for the next run and overrides it for this process.
import type { PermissionRequest } from "@opencode/client"
import { KiloPermission } from "@opencode/schema/kilocode/permission"
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
 * The mode a toggle selects. An unrecognized mode degrades to prompting instead of granting the bypass, so a future
 * mode that reaches here cannot silently enable auto-approve.
 */
export function nextPermissionMode(current: PermissionMode): PermissionMode {
  return current === "prompt" ? "autoaccept" : "prompt"
}

/**
 * True for a request that only a person may answer: auto-approve never replies to it and the permission prompt stays
 * up, as in prompt mode. Kilo plugins set `metadata.interactive` on such requests (a sandbox escalation, a sensitive
 * browser step); `run --auto` rejects them for the same reason. The rule is shared with the VS Code client; `run
 * --auto` still repeats the comparison (`packages/cli/src/run/noninteractive.ts`) and moves here when next touched.
 */
export function requiresPerson(request: PermissionRequest | undefined) {
  return KiloPermission.requiresPerson(request?.metadata)
}
