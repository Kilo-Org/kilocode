// Kilo `/privacy`: toggles the `privacy_mode` config key through the `kilocode.settings` RPC. Enabling writes the
// global value; disabling writes the global value and clears the project value from every project document, so a
// project `true` cannot keep privacy mode on under a global `false`. The title follows the current state, and the write
// reloads the config, so the redaction applies or lifts without a restart.
import { Plugin } from "@opencode/plugin/tui"
import { KiloSettingsRpc } from "@opencode/schema/kilocode/settings"
import { createSignal, onCleanup, onMount } from "solid-js"
import { errorMessage } from "../util/error"
import { isRecord } from "../util/record"
import { privacyMode } from "./pii"

export default Plugin.define({
  id: "kilocode.privacy",
  setup(context) {
    const settings = context.client.rpc(KiloSettingsRpc.Definition)
    // The location is resolved lazily: the default is not ready while the plugin sets up.
    const location = () => context.location ?? context.data.location.default()
    const options = () => ({ location: { directory: location().directory } })
    const [active, setActive] = createSignal(false)
    const [pending, setPending] = createSignal(false)

    const refresh = () => privacyMode(context.client, location()).then(setActive)

    // Enabling only sets the global key; disabling also clears the project key from every project document that sets
    // it, so a project `true` cannot keep privacy mode on under the global `false`.
    const write = async (next: boolean) => {
      await settings.write({ scope: "global", set: { privacy_mode: next } }, options())
      if (!next) await settings.write({ scope: "project", unset: [["privacy_mode"]] }, options())
    }

    const toggle = async () => {
      if (pending()) return
      setPending(true)
      const next = !active()
      try {
        try {
          await write(next)
        } catch (error) {
          // A concurrent external edit can move the target between the write steps; re-read and retry once.
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

    context.ui.slot({
      append: "app",
      render() {
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
        return null
      },
    })
  },
})
