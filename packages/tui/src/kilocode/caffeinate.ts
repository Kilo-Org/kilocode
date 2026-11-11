// `/caffeinate` keeps the computer awake while Kilo agents work. The controller in `@kilocode/caffeination` holds one
// platform inhibitor; this command feeds it the session busy state and owns the confirmation and toasts.
import { CaffeinationController, type CaffeinationState } from "@kilocode/caffeination"
import type { Plugin } from "@opencode/plugin/tui"
import { createEffect, createRoot, createSignal, onCleanup } from "solid-js"
import { errorMessage } from "../util/error"

/**
 * An agent works while a session runs or a queued prompt waits for it. Parked synthetic context stays pending without
 * execution, so it does not count as work.
 */
export function busy(data: Plugin.Context["data"]) {
  return data.session.list().some((session) => {
    const id = session.id
    return (
      data.session.status(id) === "running" ||
      data.session.pending.list(id).some((item) => item.type !== "synthetic")
    )
  })
}

/**
 * Follows the data store reactively. A fixed event list misses the reconnect and startup hydration snapshots, which
 * add or clear running sessions in the store without a per-session event. Returns the disposer for the effect.
 */
export function trackBusy(data: Plugin.Context["data"], setBusy: (busy: boolean) => void) {
  let stop = () => {}
  createRoot((dispose) => {
    stop = dispose
    createEffect(() => setBusy(busy(data)))
  })
  return stop
}

// Registered by the Kilo command host (`kilocode.teams`) so `/caffeinate` shares that plugin's row. A separate builtin
// row would sort before `opencode.diffs` in the plugin list and push it out of the /plugins viewport.
export function caffeinateLayer(context: Plugin.Context) {
  const controller = new CaffeinationController()
  const [state, setState] = createSignal<CaffeinationState>(controller.getState())
  const [store, update] = context.storage.store("caffeinate", { initial: { confirmed: false } })
  let previous = controller.getState()
  controller.onChange((next) => {
    setState(next)
    if (previous.available && !next.available && next.error)
      context.ui.toast.show({ variant: "error", message: `Keep Awake failed: ${next.error}` })
    previous = next
  })
  const stopBusy = trackBusy(context.data, (value) => void controller.setBusy(value))
  onCleanup(() => {
    stopBusy()
    void controller.dispose().catch((error) => console.error("Failed to release Keep Awake", errorMessage(error)))
  })

  let pending: Promise<void> | undefined
  const toggle = () => {
    if (pending) return pending
    pending = (async () => {
      const current = state()
      if (current.enabled) {
        await controller.setEnabled(false)
        context.ui.dialog.clear()
        context.ui.toast.show({ variant: "info", message: "Keep Awake disabled" })
        return
      }
      if (!current.available) {
        context.ui.toast.show({
          variant: "error",
          message: current.error ?? "Keep Awake is unavailable on this platform",
        })
        context.ui.dialog.clear()
        return
      }
      if (!store.confirmed) {
        const confirmed = await context.ui.dialog.confirm({
          title: "Keep this computer awake while Kilo agents work?",
          message:
            "Keep Awake prevents system sleep while Kilo sessions are running. It does not keep the display on or disable screen locking. Agents may continue to access files, network services, and available credentials while the computer is locked.",
        })
        if (confirmed !== true) return
        await update((draft) => {
          draft.confirmed = true
        })
      }
      await controller.setEnabled(true)
      context.ui.dialog.clear()
      context.ui.toast.show({ variant: "info", message: "Keep Awake enabled" })
    })().finally(() => {
      pending = undefined
    })
    return pending
  }

  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "kilo.caffeinate",
        title: !state().available
          ? "Keep Awake unavailable"
          : !state().enabled
            ? "Enable Keep Awake"
            : state().active
              ? "Disable Keep Awake (active)"
              : "Disable Keep Awake",
        description: "Prevent system sleep while Kilo agents work",
        group: "System",
        palette: true,
        slash: { name: "caffeinate", aliases: ["caffenate"] },
        run: toggle,
      },
    ],
  }))
}
