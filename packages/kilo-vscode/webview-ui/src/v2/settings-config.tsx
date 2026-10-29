// The Settings data layer: live reads over the server config entries (`api.config.get`) and the raw target files the
// host read. Writes go straight to the host, which owns the files; the v2 server reloads a written file and emits
// `config.updated`, and `createData` resyncs the config resource, so `value(path)` reads the live merged config.
// A write keeps a short optimistic value for its path until the resync covers that path, so the control does not
// flicker while another write is still in flight.
//
// Commit timing for the tabs: switches and selects write on change, while text and number fields write on blur or
// Enter (not on every keystroke), so a partial value is never written.
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  useContext,
  type ParentComponent,
} from "solid-js"
import { parse as parseJsonc } from "jsonc-parser/lib/esm/main.js"
import { unwrap } from "solid-js/store"
import { showToast } from "@kilocode/kilo-ui/toast"
import type { ConfigEdit, ConfigFileContent, ToHost, ToWebview } from "../../../src/protocol"
import { aliasOf } from "../../../src/config-aliases"
import { getVSCodeAPI, useVSCode } from "../context/vscode"
import { useLanguage } from "../context/language"
import { useV2 } from "./client"
import { mergeConfigDocuments } from "./settings-merge"

export type SettingsScope = "global" | "project"

/** The i18n key of a Kilo VS Code setting is `kilo-code.v2.<key>`. */
export type KiloSettingKey = "fontSize" | "language" | "chat.shiftTabCyclesVariant" | "claudeCodeCompat" | "extraCaCerts"

type Json = Record<string, unknown>

interface Optimistic {
  scope: SettingsScope
  path: string[]
  value: unknown
}

function readPath(source: unknown, path: string[]): unknown {
  let current: unknown = source
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined
    current = (current as Json)[key]
  }
  return current
}

function pathKey(path: string[]): string {
  return JSON.stringify(path)
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/** A plain copy for `postMessage`: config values can be Solid store proxies, which structured clone rejects. */
function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(unwrap(value))) as T)
}

function parseJson(text: string | undefined): Json {
  if (!text || text.trim().length === 0) return {}
  const value: unknown = parseJsonc(text, [], { allowTrailingComma: true })
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {}
}

/** The values the host inlined into the page. */
function initialSettings(): Record<string, unknown> {
  const value = (window as unknown as { KILO_SETTINGS?: Record<string, unknown> }).KILO_SETTINGS
  return value && typeof value === "object" ? value : {}
}

export function createSettingsConfig() {
  const v2 = useV2()
  const vscode = useVSCode()
  const language = useLanguage()
  const post = (message: ToHost) => getVSCodeAPI().postMessage(message as never)

  const [files, setFiles] = createSignal<{ global?: ConfigFileContent; project?: ConfigFileContent }>({})
  const [settingsValues, setSettingsValues] = createSignal<Record<string, unknown>>(initialSettings())
  const [optimistic, setOptimistic] = createSignal<Optimistic[]>([])
  const [inflight, setInflight] = createSignal<{ path: string; token: number }[]>([])
  const writers = new Map<number, (result: { ok: boolean; error?: string }) => void>()
  let nextWrite = 1
  let nextToken = 1

  const toastError = (message: string) =>
    showToast({ variant: "error", title: language.t("settings.saveBar.saveFailed"), description: message })

  const unsubscribe = vscode.onMessage((raw) => {
    const message = raw as unknown as ToWebview
    if (message.type === "configLoaded") {
      if (message.error) toastError(message.error)
      setFiles({ global: message.global, project: message.project })
      // Drop only the optimistic values the new file content now covers, so an in-flight edit keeps its value.
      setOptimistic((list) =>
        list.filter((item) => {
          const text = item.scope === "project" ? message.project.text : message.global.text
          return !sameValue(readPath(parseJson(text), item.path), item.value)
        }),
      )
      return
    }
    if (message.type === "configWritten") {
      const resolve = writers.get(message.id)
      writers.delete(message.id)
      resolve?.({ ok: message.ok, error: message.error })
      return
    }
    if (message.type === "vscodeSettingsLoaded") setSettingsValues(message.values)
  })
  onCleanup(unsubscribe)

  createEffect(
    on(v2.connection.status, (status) => {
      if (status !== "connected") return
      void v2.data.location.config.sync().catch(v2.report)
    }),
  )
  post({ type: "requestVSCodeSettings" })

  const entries = () => v2.data.location.config.list() ?? []

  // The server reloads a written file on its own, then `config.updated` resyncs the config resource. Re-read the raw
  // files; the `configLoaded` reply drops the optimistic values the new content covers.
  createEffect(
    on(entries, () => post({ type: "configRead" }), { defer: true }),
  )

  const merged = createMemo(() => mergeConfigDocuments(entries()))

  const rawConfig = createMemo(() => ({
    global: parseJson(files()?.global?.text),
    project: parseJson(files()?.project?.text),
  }))

  const raw = (scope: SettingsScope) => rawConfig()[scope]

  /** The target file the host resolved for a scope, so the header can open it. */
  const path = (scope: SettingsScope) => files()?.[scope]?.path

  const source = (path: string[]): SettingsScope | undefined => {
    const aliases = aliasOf(path)
    const defined = (scope: SettingsScope) =>
      readPath(rawConfig()[scope], path) !== undefined ||
      aliases.some((alias) => readPath(rawConfig()[scope], alias) !== undefined)
    if (defined("project")) return "project"
    if (defined("global")) return "global"
    return undefined
  }

  const value = (path: string[]) => {
    const key = pathKey(path)
    const entry = [...optimistic()].toReversed().find((item) => pathKey(item.path) === key)
    if (entry) return entry.value
    return readPath(merged(), path)
  }

  /** True while a write for this path is in flight, so a caller can prefer `value()` over the raw file. */
  const pending = (path: string[]) => inflight().some((item) => item.path === pathKey(path))

  const write = (scope: SettingsScope, edits: ConfigEdit[]) =>
    new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const id = nextWrite++
      writers.set(id, resolve)
      post({ type: "configWrite", id, scope, edits })
    })

  /** Write a value immediately. A VS Code setting passes through `setSetting`. */
  const set = async (path: string[], value: unknown, scope: SettingsScope = "global") => {
    const key = pathKey(path)
    const writeValue = clone(value)
    setOptimistic((list) => [...list.filter((item) => pathKey(item.path) !== key), { scope, path, value: writeValue }])
    // A token per write keeps `pending` true until every write for the path settles, including both scopes.
    const token = nextToken++
    setInflight((list) => [...list, { path: key, token }])
    let result: { ok: boolean; error?: string }
    try {
      result = await write(scope, [{ path, value: writeValue }])
    } finally {
      setInflight((list) => list.filter((item) => item.token !== token))
    }
    if (!result.ok) {
      setOptimistic((list) => list.filter((item) => pathKey(item.path) !== key))
      toastError(result.error ?? language.t("settings.saveBar.saveFailed"))
    }
    return result.ok
  }

  const unset = (path: string[], scope: SettingsScope = "global") => set(path, undefined, scope)

  const setSetting = (key: KiloSettingKey, value: unknown) => {
    const writeValue = clone(value ?? null)
    setSettingsValues((current) => ({ ...current, [key]: writeValue }))
    post({ type: "updateVSCodeSettings", values: { [key]: writeValue } })
  }

  return {
    entries,
    merged,
    raw,
    path,
    source,
    value,
    pending,
    set,
    unset,
    setting: (key: KiloSettingKey) => settingsValues()[key],
    setSetting,
  }
}

export type SettingsConfig = ReturnType<typeof createSettingsConfig>

const Context = createContext<SettingsConfig>()

export const SettingsConfigProvider: ParentComponent = (props) => (
  <Context.Provider value={createSettingsConfig()}>{props.children}</Context.Provider>
)

export function useSettingsConfig() {
  const value = useContext(Context)
  if (!value) throw new Error("useSettingsConfig must be used inside SettingsConfigProvider")
  return value
}
