import { createStore } from "solid-js/store"
import type { ConfigOverlayResponse, TuiConfigGetResponse, TuiConfigUpdateData } from "@kilocode/sdk/v2"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useToast } from "@tui/ui/toast"
import { errorMessage } from "@/util/error"

export type Scope = "project" | "global"
export type TuiPatch = NonNullable<TuiConfigUpdateData["body"]>
type Warning = { path: string; message: string }

type Store = {
  overlay: ConfigOverlayResponse | undefined
  tui: TuiConfigGetResponse
  warnings: Warning[]
  loading: boolean
  refreshing: boolean
  busy: string | undefined
  error: string | undefined
  notice: string | undefined
}

export type SettingsState = {
  store: Store
  reload: () => Promise<boolean>
  field: (key: string, scope: Scope) => unknown
  meta: (key: string, scope: Scope) => string | undefined
  tui: (key: keyof TuiConfigGetResponse) => unknown
  updateField: (scope: Scope, key: string, value: unknown, label: string) => Promise<boolean>
  unsetField: (scope: Scope, key: string, label: string) => Promise<boolean>
  updateTui: (scope: Scope, patch: TuiPatch, label: string) => Promise<boolean>
  disconnect: (id: string, label: string) => Promise<boolean>
  enableProvider: (id: string, label: string) => Promise<boolean>
  disableProvider: (id: string, label: string) => Promise<boolean>
  togglePlugin: (id: string, enabled: boolean, label: string) => Promise<boolean>
  setAutoApprove: (enable: boolean) => Promise<boolean>
  isAutoApprove: () => boolean
}

export function createSettings(): SettingsState {
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const [store, setStore] = createStore<Store>({
    overlay: undefined,
    tui: {},
    warnings: [],
    loading: true,
    refreshing: false,
    busy: undefined,
    error: undefined,
    notice: undefined,
  })
  let pending: Promise<boolean> | undefined

  function reload() {
    if (pending) return pending
    setStore("refreshing", true)
    setStore("error", undefined)
    pending = (async () => {
      const [overlay, tui, warnings] = await Promise.allSettled([
        deadline(sdk.client.config.overlay({ scope: "project" }), "Configuration"),
        deadline(sdk.client.tui.config.get(), "Terminal configuration"),
        deadline(sdk.client.config.warnings(), "Configuration warnings"),
      ])
      const errors: string[] = []

      if (overlay.status === "rejected") errors.push(errorMessage(overlay.reason))
      if (overlay.status === "fulfilled" && overlay.value.error) {
        errors.push(errorMessage(overlay.value.error))
      }
      if (overlay.status === "fulfilled" && !overlay.value.error) {
        if (overlay.value.data) setStore("overlay", overlay.value.data)
        else errors.push("Configuration returned no data")
      }

      if (tui.status === "rejected") errors.push(errorMessage(tui.reason))
      if (tui.status === "fulfilled" && tui.value.error) {
        errors.push(errorMessage(tui.value.error))
      }
      if (tui.status === "fulfilled" && !tui.value.error) setStore("tui", tui.value.data ?? {})

      if (warnings.status === "fulfilled" && !warnings.value.error) {
        setStore("warnings", warnings.value.data ?? [])
      }

      setStore("error", errors.length ? errors.join(" · ") : undefined)
      setStore("loading", false)
      setStore("refreshing", false)
      pending = undefined
      return errors.length === 0
    })()
    return pending
  }

  function field(key: string, scope: Scope) {
    const overlay = store.overlay
    if (!overlay) return undefined
    if (scope === "global") return Object(overlay.global)[key] as unknown
    return overlay.fields[key]?.value
  }

  function meta(key: string, scope: Scope) {
    const info = store.overlay?.fields[key]
    if (!info) return undefined
    if (scope === "global")
      return Object.prototype.hasOwnProperty.call(store.overlay?.global ?? {}, key) ? "global" : "default"
    if (info.source === "project") return "project"
    if (info.source === "global") return "inherited"
    return info.source
  }

  function tui(key: keyof TuiConfigGetResponse) {
    return store.tui[key]
  }

  async function run(
    label: string,
    task: () => Promise<{ error?: unknown }>,
    opts?: { after?: () => Promise<void>; notice?: string },
  ) {
    if (store.busy) return false
    setStore("busy", label)
    setStore("error", undefined)
    setStore("notice", undefined)
    try {
      const result = await deadline(task(), label)
      if (result.error) throw new Error(errorMessage(result.error))
      await opts?.after?.()
      await reload()
      setStore("notice", opts?.notice ?? `${label} saved`)
      return true
    } catch (err) {
      const message = errorMessage(err)
      setStore("error", message)
      toast.show({ variant: "error", message: `${label}: ${message}` })
      return false
    } finally {
      setStore("busy", undefined)
    }
  }

  function updateField(scope: Scope, key: string, value: unknown, label: string) {
    return run(label, () =>
      sdk.client.config.overlayUpdate({
        scope,
        set: { [key]: value },
      }),
    )
  }

  function unsetField(scope: Scope, key: string, label: string) {
    return run(label, () =>
      sdk.client.config.overlayUpdate({
        scope,
        unset: [[key]],
      }),
    )
  }

  function updateTui(scope: Scope, patch: TuiPatch, label: string) {
    return run(label, () => sdk.client.tui.config.update({ scope, ...patch }))
  }

  function disconnect(id: string, label: string) {
    return run(`Disconnect ${label}`, () => sdk.client.auth.remove({ providerID: id }), {
      notice: `${label} disconnected`,
      after: async () => {
        await deadline(sdk.client.instance.dispose(), "Provider cache refresh").catch((err) => {
          toast.show({ variant: "warning", message: `Provider cache refresh failed: ${errorMessage(err)}` })
        })
        await deadline(sync.bootstrap(), "Provider list refresh").catch((err) => {
          toast.show({ variant: "warning", message: `Provider list refresh failed: ${errorMessage(err)}` })
        })
      },
    })
  }

  function enableProvider(id: string, label: string) {
    const overlay = store.overlay
    const scope: Scope = overlay?.scope === "global" ? "global" : "project"
    const list = Array.isArray(overlay?.fields["disabled_providers"]?.value)
      ? (overlay.fields["disabled_providers"].value as unknown[])
      : []
    const next = list.filter((item) => item !== id)
    return run(`Enable ${label}`, () =>
      sdk.client.config.overlayUpdate({
        scope,
        ...(next.length ? { set: { disabled_providers: next } } : { unset: [["disabled_providers"]] }),
      }),
      {
        notice: `${label} enabled`,
        after: async () => {
          await deadline(sdk.client.instance.dispose(), "Provider cache refresh").catch((err) => {
            toast.show({ variant: "warning", message: `Provider cache refresh failed: ${errorMessage(err)}` })
          })
          await deadline(sync.bootstrap(), "Provider list refresh").catch((err) => {
            toast.show({ variant: "warning", message: `Provider list refresh failed: ${errorMessage(err)}` })
          })
        },
      },
    )
  }

  function disableProvider(id: string, label: string) {
    const overlay = store.overlay
    const scope: Scope = overlay?.scope === "global" ? "global" : "project"
    const list = Array.isArray(overlay?.fields["disabled_providers"]?.value)
      ? (overlay.fields["disabled_providers"].value as unknown[])
      : []
    if (list.includes(id)) return Promise.resolve(false)
    const next = [...list, id]
    return run(`Disable ${label}`, () =>
      sdk.client.config.overlayUpdate({
        scope,
        set: { disabled_providers: next },
      }),
      {
        notice: `${label} hidden`,
        after: async () => {
          await deadline(sdk.client.instance.dispose(), "Provider cache refresh").catch((err) => {
            toast.show({ variant: "warning", message: `Provider cache refresh failed: ${errorMessage(err)}` })
          })
          await deadline(sync.bootstrap(), "Provider list refresh").catch((err) => {
            toast.show({ variant: "warning", message: `Provider list refresh failed: ${errorMessage(err)}` })
          })
        },
      },
    )
  }

  function togglePlugin(id: string, enabled: boolean, label: string) {
    const current = (store.tui.plugin_enabled ?? {}) as Record<string, boolean>
    const next = { ...current, [id]: enabled }
    return updateTui("global", { plugin_enabled: next }, label)
  }

  function isAutoApprove() {
    const wildcard = (sync.data.config.permission as Record<string, unknown> | undefined)?.["*"]
    if (typeof wildcard === "string") return wildcard === "allow"
    if (wildcard && typeof wildcard === "object") {
      return Object(wildcard)["*"] === "allow"
    }
    return false
  }

  function setAutoApprove(enable: boolean) {
    return run(`Auto-approve ${enable ? "enabled" : "disabled"}`, () =>
      sdk.client.permission.allowEverything({ enable }),
    )
  }

  return {
    store,
    reload,
    field,
    meta,
    tui,
    updateField,
    unsetField,
    updateTui,
    disconnect,
    enableProvider,
    disableProvider,
    togglePlugin,
    setAutoApprove,
    isAutoApprove,
  }
}

function deadline<T>(task: Promise<T>, label: string) {
  let handle: ReturnType<typeof setTimeout> | undefined
  const timer = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new Error(`${label} timed out`)), 8_000)
  })
  task.finally(() => clearTimeout(handle))
  timer.catch(() => {})
  return Promise.race([task, timer])
}
