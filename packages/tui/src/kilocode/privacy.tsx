// Kilo `/privacy`: toggles the `privacy_mode` config key through the `kilocode.settings` RPC. Enabling writes the
// global value; disabling writes the global value and clears the project value from every project document, so a
// project `true` cannot keep privacy mode on under a global `false`. The title follows the current state, and the write
// reloads the config, so the redaction applies or lifts without a restart.
import type { Plugin } from "@opencode/plugin/tui"
import { KiloSettingsRpc } from "@opencode/schema/kilocode/settings"
import { createSignal, onCleanup, onMount } from "solid-js"
import { errorMessage } from "../util/error"
import { isRecord } from "../util/record"
import { privacyMode } from "./pii"

// Registered by the Kilo command host (`kilocode.teams`) so `/privacy` shares that plugin's row. A separate builtin
// row would sort before `opencode.diffs` in the plugin list and push it out of the /plugins viewport, breaking the
// upstream session-panel test.
export function privacyLayer(context: Plugin.Context) {
  const settings = context.client.rpc(KiloSettingsRpc.Definition)
  // The location is resolved lazily: the default is not ready while the plugin sets up.
  const location = () => context.location ?? context.data.location.default()
  const options = () => ({ location: { directory: location().directory } })
  const [active, setActive] = createSignal(false)
  const [pending, setPending] = createSignal(false)
  // A privacy read started before a toggle must not replace the toggle's newer result.
  let generation = 0
  let inflight: AbortController | undefined

  const refresh = async () => {
    if (pending() || inflight) return
    const controller = new AbortController()
    inflight = controller
    const current = ++generation
    try {
      const enabled = await privacyMode(context.client, location(), controller.signal)
      if (current === generation) setActive(enabled)
    } finally {
      if (inflight === controller) inflight = undefined
    }
  }

  // The target revision guards the write against a concurrent edit. Every write re-reads it, so the retry after a
  // `conflict` starts from the current revision instead of overwriting a newer file.
  const guard = async (scope: "global" | "project") => {
    const target = await settings.target({ scope }, options())
    return target.exists && target.revision ? { path: target.path, revision: target.revision } : undefined
  }

  // Enabling only sets the global key; disabling also clears the project key from every project document that sets
  // it, so a project `true` cannot keep privacy mode on under the global `false`.
  const write = async (next: boolean) => {
    await settings.write({ scope: "global", set: { privacy_mode: next }, expected: await guard("global") }, options())
    if (!next) {
      await settings.write(
        { scope: "project", unset: [["privacy_mode"]], expected: await guard("project") },
        options(),
      )
    }
  }

  const toggle = async () => {
    if (pending()) return
    setPending(true)
    generation++
    inflight?.abort()
    const next = !active()
    try {
      try {
        await write(next)
      } catch (error) {
        // A concurrent edit moved the target or its revision; the retry re-reads it before writing.
        if (!(isRecord(error) && error.type === "conflict")) throw error
        await write(next)
      }
      setActive(next)
      context.ui.toast.show({ variant: "success", message: next ? "Privacy mode enabled" : "Privacy mode disabled" })
    } catch (error) {
      context.ui.toast.show({
        variant: "error",
        message: `Failed to update privacy mode (${errorMessage(error)})`,
      })
    } finally {
      setPending(false)
    }
  }

  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "kilo.privacy",
        title: active() ? "Disable privacy mode" : "Enable privacy mode",
        description: "Blur PII (balance, email, etc.) and confirm before showing profile",
        group: "Kilo",
        palette: true,
        slash: { name: "privacy" },
        enabled: !pending(),
        run: toggle,
      },
    ],
  }))
  onMount(() => void refresh())
  // The write triggers the config watcher, and a hand edit must move the title too.
  onCleanup(context.data.on("config.updated", () => void refresh()))
}
