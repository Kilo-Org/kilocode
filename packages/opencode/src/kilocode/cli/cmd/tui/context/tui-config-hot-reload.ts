/**
 * Hot-reload wiring for the reactive TUI config store.
 *
 * On a `global.config.updated` event we refetch the effective TUI config from the server
 * (`sdk.tui.config.get`) and reconcile it into the store via `KiloTuiConfig.useSet`. The
 * keymap and theme consumers read the store reactively, so new values take effect on the
 * next keypress / render.
 *
 * Kept separate from `tui-config.tsx` so the store factory has no SDK/event imports.
 */
import { onCleanup, onMount } from "solid-js"
import type { TuiConfig } from "@tui/config"
import { useSDK } from "@tui/context/sdk"
import { useEvent } from "@tui/context/event"
import { KiloTuiConfig } from "./tui-config"

/**
 * Subscribe to config-updated events and refetch the effective TUI config. Must be called
 * inside the App body (below SDKProvider and the TuiConfig provider).
 */
export function useTuiConfigHotReload() {
  const set = KiloTuiConfig.useSet()
  const sdk = useSDK()
  const event = useEvent()

  const state = { pending: false, again: false }
  async function reload() {
    if (state.pending) {
      state.again = true
      return
    }
    state.pending = true
    const result = await sdk.client.tui.config.get().catch(() => undefined)
    state.pending = false
    // The generated response type is structurally wider than TuiConfig.Info (looser unions, no
    // plugin_origins); reconcile only reads the known fields, so narrowing here is safe.
    if (result?.data) set(result.data as unknown as TuiConfig.Info)
    // Coalesce events that arrived mid-flight into a single follow-up fetch.
    if (state.again) {
      state.again = false
      void reload()
    }
  }

  onMount(() => {
    const unsub = event.on("global.config.updated", () => void reload())
    onCleanup(unsub)
  })
}
