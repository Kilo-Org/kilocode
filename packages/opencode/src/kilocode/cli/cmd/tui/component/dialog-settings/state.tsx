import { createStore } from "solid-js/store"
import type { ConfigOverlayResponse, Provider, TuiConfigGetResponse, TuiConfigUpdateData } from "@kilocode/sdk/v2"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useToast } from "@tui/ui/toast"
import { errorMessage } from "@/util/error"
import { isAllowEverything } from "@/kilocode/cli/cmd/tui/util/permission"

export type Scope = "project" | "global"
export type TuiPatch = NonNullable<TuiConfigUpdateData["body"]>
type Warning = { path: string; message: string }

type Store = {
  overlay: ConfigOverlayResponse | undefined
  tui: Record<Scope, TuiConfigGetResponse>
  warnings: Warning[]
  disabledProviders: Provider[]
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
  tui: (key: keyof TuiConfigGetResponse, scope: Scope) => unknown
  currentScopeList: (scope: Scope) => unknown[]
  updateField: (scope: Scope, key: string, value: unknown, label: string) => Promise<boolean>
  unsetField: (scope: Scope, key: string, label: string) => Promise<boolean>
  updateTui: (scope: Scope, patch: TuiPatch, label: string) => Promise<boolean>
  disconnect: (id: string, label: string) => Promise<boolean>
  enableProvider: (id: string, label: string, scope: Scope) => Promise<boolean>
  disableProvider: (id: string, label: string, scope: Scope) => Promise<boolean>
  isHiddenInOtherScope: (id: string, scope: Scope) => boolean
  setAutoApprove: (enable: boolean) => Promise<boolean>
  isAutoApprove: () => boolean
}

export function createSettings(): SettingsState {
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const [store, setStore] = createStore<Store>({
    overlay: undefined,
    tui: { project: {}, global: {} },
    warnings: [],
    disabledProviders: [],
    loading: true,
    refreshing: false,
    busy: undefined,
    error: undefined,
    notice: undefined,
  })
  let pending: Promise<boolean> | undefined

  function reload(opts: { keepError?: boolean } = {}) {
    if (pending) return pending
    setStore("refreshing", true)
    // keepError=true is used by run()'s failure-path reload so the write
    // error set in catch stays visible inline. Normal reloads (manual refresh
    // or dialog reopen) clear any stale error so the user doesn't see a
    // permanent banner describing a problem that no longer exists.
    const prevError = opts.keepError ? store.error : undefined
    pending = (async () => {
      const [overlay, tuiProject, tuiGlobal, warnings, disabled] = await Promise.allSettled([
        deadline(sdk.client.config.overlay({ scope: "project" }), "Configuration"),
        deadline(sdk.client.tui.config.get({ scope: "project" }), "Terminal configuration"),
        deadline(sdk.client.tui.config.get({ scope: "global" }), "Terminal configuration"),
        deadline(sdk.client.config.warnings(), "Configuration warnings"),
        deadline(sdk.client.disabledProviders.list(), "Disabled providers"),
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

      const handleTui = (result: PromiseSettledResult<{ data?: TuiConfigGetResponse; error?: unknown }>, scope: Scope) => {
        if (result.status === "rejected") errors.push(errorMessage(result.reason))
        if (result.status === "fulfilled" && result.value.error) {
          errors.push(errorMessage(result.value.error))
        }
        if (result.status === "fulfilled" && !result.value.error) setStore("tui", scope, result.value.data ?? {})
      }
      handleTui(tuiProject, "project")
      handleTui(tuiGlobal, "global")

      if (warnings.status === "fulfilled" && !warnings.value.error) {
        setStore("warnings", warnings.value.data ?? [])
      }

      if (disabled.status === "rejected") errors.push(errorMessage(disabled.reason))
      if (disabled.status === "fulfilled" && disabled.value.error) {
        errors.push(errorMessage(disabled.value.error))
      }
      if (disabled.status === "fulfilled" && !disabled.value.error) {
        setStore("disabledProviders", disabled.value.data ?? [])
      }

      const fetched = errors.length ? errors.join(" · ") : undefined
      // On the failure path the write error already tells the user what went
      // wrong; layering fetch errors on top would duplicate on every retry and
      // grow the banner without bound. Keep prevError as-is.
      setStore("error", opts.keepError ? prevError : fetched)
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

  function tui(key: keyof TuiConfigGetResponse, scope: Scope) {
    return store.tui[scope][key]
  }

  // Read the raw disabled_providers list for the target scope. Using the
  // effective overlay value would merge project + global and write entries
  // that don't belong to the selected scope's file.
  function currentScopeList(scope: Scope): unknown[] {
    const overlay = store.overlay
    if (!overlay) return []
    if (scope === "global") {
      const raw = Object(overlay.global)["disabled_providers"]
      return Array.isArray(raw) ? (raw as unknown[]) : []
    }
    const raw = overlay.fields["disabled_providers"]?.local
    return Array.isArray(raw) ? (raw as unknown[]) : []
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
    let failed = false
    try {
      const result = await deadline(task(), label)
      if (result.error) throw new Error(errorMessage(result.error))
      await opts?.after?.()
      await reload()
      setStore("notice", opts?.notice ?? `${label} saved`)
      return true
    } catch (err) {
      failed = true
      const message = errorMessage(err)
      setStore("error", message)
      toast.show({ variant: "error", message: `${label}: ${message}` })
      return false
    } finally {
      // Reload only on failure: the success path already awaited reload()
      // above. On failure the reload reconciles partially-applied multi-step
      // writes (e.g. a cross-scope enable cascade) with disk while keeping the
      // just-set error in place so the user still sees it inline.
      if (failed) await reload({ keepError: true }).catch(() => {})
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

  function enableProvider(id: string, label: string, scope: Scope) {
    const list = currentScopeList(scope)
    if (!list.includes(id)) {
      const other = scope === "global" ? "project" : "global"
      toast.show({
        variant: "warning",
        message: `${label} is hidden in ${other} config; switch scope to re-enable it`,
      })
      return Promise.resolve(false)
    }
    // If the provider is also hidden in the other scope, remove it from both
    // so the dialog's "enabled" notice matches what the user actually sees.
    const otherScope: Scope = scope === "global" ? "project" : "global"
    const otherList = currentScopeList(otherScope)
    const cascade = otherList.includes(id)
    const next = list.filter((item) => item !== id)
    const nextOther = otherList.filter((item) => item !== id)
    return run(
      cascade ? `Enable ${label} in both scopes` : `Enable ${label}`,
      async () => {
        const target = await sdk.client.config.overlayUpdate({
          scope,
          ...(next.length
            ? { set: { disabled_providers: next } }
            : { unset: [["disabled_providers"]] }),
        })
        if (target.error) throw new Error(`${scope}: ${errorMessage(target.error)}`)
        if (!cascade) return target
        const other = await sdk.client.config.overlayUpdate({
          scope: otherScope,
          ...(nextOther.length
            ? { set: { disabled_providers: nextOther } }
            : { unset: [["disabled_providers"]] }),
        })
        if (other.error) throw new Error(`${otherScope}: ${errorMessage(other.error)}`)
        return other
      },
      {
        notice: cascade ? `${label} enabled in both scopes` : `${label} enabled`,
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

  function disableProvider(id: string, label: string, scope: Scope) {
    const list = currentScopeList(scope)
    if (list.includes(id)) {
      toast.show({ variant: "warning", message: `${label} is already hidden` })
      return Promise.resolve(false)
    }
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

  function isAutoApprove() {
    return isAllowEverything(sync.data.config.permission)
  }

  function isHiddenInOtherScope(id: string, scope: Scope) {
    const other: Scope = scope === "global" ? "project" : "global"
    return currentScopeList(other).includes(id)
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
    currentScopeList,
    updateField,
    unsetField,
    updateTui,
    disconnect,
    enableProvider,
    disableProvider,
    isHiddenInOtherScope,
    setAutoApprove,
    isAutoApprove,
  }
}

function deadline<T>(task: Promise<T>, label: string) {
  let handle: ReturnType<typeof setTimeout> | undefined
  const timer = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new Error(`${label} timed out`)), 8_000)
  })
  task.finally(() => clearTimeout(handle)).catch(() => {})
  timer.catch(() => {})
  return Promise.race([task, timer])
}
