import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createCaffeinationDriver } from "@opencode-ai/core/kilocode/caffeination"
import { useKV } from "@tui/context/kv"
import { useSync } from "@tui/context/sync"
import { useBindings } from "@tui/keymap"
import { useDialog } from "@tui/ui/dialog"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { useToast } from "@tui/ui/toast"

type Run = { epoch: number; stopping: boolean }

export function useCaffeination() {
  const sync = useSync()
  const kv = useKV()
  const dialog = useDialog()
  const toast = useToast()
  const driver = createCaffeinationDriver()
  const [enabled, setEnabled] = createSignal(false)
  const [active, setActive] = createSignal(false)
  const [available, setAvailable] = createSignal(driver.available)
  const [error, setError] = createSignal<string | undefined>(driver.reason)
  const working = createMemo(() =>
    Object.values(sync.data.session_status).some((status) => status.type === "busy" || status.type === "retry"),
  )
  let work = Promise.resolve()
  let run: Run | undefined
  let epoch = 0
  let disposed = false
  let seenWorking = false
  let pending: Promise<void> | undefined

  const message = (value: unknown) => (value instanceof Error ? value.message : String(value))
  const resetAvailability = () => {
    setAvailable(driver.available)
    setError(driver.available ? undefined : driver.reason)
  }
  const stop = async () => {
    if (!run) return
    run.stopping = true
    await driver.stop()
    run = undefined
    setActive(false)
  }
  const fail = (value: unknown) => {
    const detail = message(value)
    setAvailable(false)
    setError(detail)
    toast.show({ variant: "error", message: `Keep Awake failed: ${detail}` })
  }
  const queue = () => {
    work = work.then(reconcile).catch(fail)
    return work
  }
  const reconcile = async () => {
    if (run && (!enabled() || !working() || !available() || run.epoch !== epoch)) await stop()
    if (run || !enabled() || !working() || !available() || disposed) return

    const next = { epoch, stopping: false }
    run = next
    try {
      await driver.start(process.pid, (value) => {
        if (run !== next || next.stopping) return
        setActive(false)
        setAvailable(false)
        setError(value?.message ?? "The keep-awake process exited unexpectedly")
        toast.show({ variant: "error", message: value?.message ?? "The keep-awake process exited unexpectedly" })
        if (!disposed) void queue()
      })
    } catch (value) {
      if (next.epoch === epoch && enabled() && working()) fail(value)
      await stop()
      return
    }
    if (run !== next || next.epoch !== epoch || !enabled() || !working() || !available()) {
      await stop()
      return
    }
    setActive(true)
    setError(undefined)
  }
  const setState = (value: boolean) => {
    epoch++
    resetAvailability()
    setEnabled(value)
    return queue()
  }
  const toggle = () => {
    if (pending) return pending
    pending = (async () => {
      if (enabled()) {
        await setState(false)
        dialog.clear()
        toast.show({ variant: "info", message: "Keep Awake disabled" })
        return
      }
      if (!available()) {
        toast.show({ variant: "error", message: error() ?? "Keep Awake is unavailable on this platform" })
        dialog.clear()
        return
      }
      if (kv.get("caffeination_confirmed", false) !== true) {
        const result = await DialogConfirm.show(
          dialog,
          "Keep this computer awake while Kilo agents work?",
          "Keep Awake prevents system sleep while Kilo sessions are running. It does not keep the display on or disable screen locking. Agents may continue to access files, network services, and available credentials while the computer is locked.",
          "cancel",
        )
        if (result !== true) return
        kv.set("caffeination_confirmed", true)
      }
      await setState(true)
      dialog.clear()
      toast.show({ variant: "info", message: "Keep Awake enabled" })
    })().finally(() => {
      pending = undefined
    })
    return pending
  }

  createEffect(() => {
    const next = working()
    if (next === seenWorking) return
    seenWorking = next
    void queue()
  })

  onCleanup(() => {
    disposed = true
    epoch++
    setEnabled(false)
    void work.then(stop).catch((value) => console.warn("[Kilo New] Keep Awake cleanup failed:", value))
  })

  useBindings(() => ({
    commands: [
      {
        namespace: "palette",
        name: "kilo.caffeinate",
        get title() {
          if (!available()) return "Keep Awake unavailable"
          if (!enabled()) return "Enable Keep Awake"
          return active() ? "Disable Keep Awake (active)" : "Disable Keep Awake"
        },
        desc: "Prevent system sleep while Kilo agents work",
        category: "System",
        slashName: "caffeinate",
        slashAliases: ["caffenate"],
        run: toggle,
      },
    ],
  }))
}
