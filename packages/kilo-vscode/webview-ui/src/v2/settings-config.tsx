// The Settings data layer: live reads over the server config entries (`api.config.get`) and the raw target files the
// host read. Writes go straight to the host, which owns the files; the v2 server reloads a written file and emits
// `config.updated`, and `createData` resyncs the config resource, so `value(path)` reads the live merged config.
// A write keeps a short optimistic value for its path until the resync arrives, so the control does not flicker.
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
import { showToast } from "@kilocode/kilo-ui/toast"
import type { ConfigEdit, ConfigFileContent, ToHost, ToWebview } from "../../../src/protocol"
import { getVSCodeAPI, useVSCode } from "../context/vscode"
import { useLanguage } from "../context/language"
import { useV2 } from "./client"
import { mergeConfigDocuments } from "./settings-merge"

export type SettingsScope = "global" | "project"

/** The i18n key of a Kilo VS Code setting is `kilo-code.v2.<key>`. */
export type KiloSettingKey = "fontSize" | "language" | "chat.shiftTabCyclesVariant" | "claudeCodeCompat" | "extraCaCerts"

type Json = Record<string, unknown>

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
  const [optimistic, setOptimistic] = createSignal<{ path: string[]; value: unknown }[]>([])
  const writers: { resolve: (ok: boolean) => void }[] = []

  const unsubscribe = vscode.onMessage((raw) => {
    const message = raw as unknown as ToWebview
    if (message.type === "configLoaded") {
      setFiles({ global: message.global, project: message.project })
      return
    }
    if (message.type === "configWritten") {
      writers.shift()?.resolve(message.ok)
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
  // files and drop the optimistic values: the resync now carries the written value.
  createEffect(
    on(
      entries,
      () => {
        post({ type: "configRead" })
        setOptimistic([])
      },
      { defer: true },
    ),
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
    if (readPath(rawConfig().project, path) !== undefined) return "project"
    if (readPath(rawConfig().global, path) !== undefined) return "global"
    return undefined
  }

  const value = (path: string[]) => {
    const key = pathKey(path)
    const pending = [...optimistic()].toReversed().find((item) => pathKey(item.path) === key)
    if (pending) return pending.value
    return readPath(merged(), path)
  }

  const write = (scope: SettingsScope, edits: ConfigEdit[]) =>
    new Promise<boolean>((resolve) => {
      writers.push({ resolve })
      post({ type: "configWrite", scope, edits })
    })

  const fail = (error: unknown) =>
    showToast({
      variant: "error",
      title: language.t("settings.saveBar.saveFailed"),
      description: error instanceof Error ? error.message : String(error),
    })

  /** Write a value immediately. A VS Code setting passes through `setSetting`. */
  const set = async (path: string[], value: unknown, scope: SettingsScope = "global") => {
    const key = pathKey(path)
    setOptimistic((list) => [...list.filter((item) => pathKey(item.path) !== key), { path, value }])
    const ok = await write(scope, [{ path, value }])
    if (!ok) {
      setOptimistic((list) => list.filter((item) => pathKey(item.path) !== key))
      fail(new Error(language.t("settings.saveBar.saveFailed")))
    }
    return ok
  }

  const unset = (path: string[], scope: SettingsScope = "global") => set(path, undefined, scope)

  const setSetting = (key: KiloSettingKey, value: unknown) => {
    setSettingsValues((current) => ({ ...current, [key]: value }))
    post({ type: "updateVSCodeSettings", values: { [key]: value ?? null } })
  }

  return { entries, merged, raw, path, source, value, set, unset, setting: (key: KiloSettingKey) => settingsValues()[key], setSetting }
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
