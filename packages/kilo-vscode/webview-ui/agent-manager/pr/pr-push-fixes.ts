import { createSignal } from "solid-js"
import { getVSCodeAPI } from "../../src/context/vscode"
import { kiloSettings } from "../../src/v2/kilo-settings"

/**
 * `kilo-code.v2.agentManager.pushFixes`: whether "Fix with Kilo" also commits
 * and pushes so the PR updates. On by default. Kept apart from the comment
 * payload helpers, which must load without a DOM because the pure tests import
 * them.
 */
const [pending, setPending] = createSignal<{ value: boolean; before: boolean }>()

export function pushFixes(): boolean {
  const configured = kiloSettings()["agentManager.pushFixes"] !== false
  const value = pending()
  // The host confirms a write by pushing the settings back; a different value
  // means the change came from elsewhere, so that value wins.
  if (value && configured !== value.before) return configured
  return value?.value ?? configured
}

export function setPushFixes(enabled: boolean): void {
  setPending({ value: enabled, before: pushFixes() })
  getVSCodeAPI().postMessage({ type: "updateVSCodeSettings", values: { "agentManager.pushFixes": enabled } })
}
