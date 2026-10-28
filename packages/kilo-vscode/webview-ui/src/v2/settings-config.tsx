// The Settings data layer: one draft over the server config entries (`api.config.get`), the raw target files the host
// read, and the `kilo-code.v2.*` settings. Config edits go to the host, which owns the files; VS Code setting edits go
// through `updateVSCodeSettings`. `save()` writes both, reloads the location and refetches the config.
import { createContext, createEffect, createMemo, createSignal, on, onCleanup, useContext, type ParentComponent } from "solid-js"
import { parse as parseJsonc } from "jsonc-parser"
import type { ConfigEdit, ConfigFileContent, ToHost, ToWebview } from "../../../src/protocol"
import { getVSCodeAPI, useVSCode } from "../context/vscode"
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
  const post = (message: ToHost) => getVSCodeAPI().postMessage(message as never)

  const [files, setFiles] = createSignal<{ global?: ConfigFileContent; project?: ConfigFileContent }>({})
  const [settingsValues, setSettingsValues] = createSignal<Record<string, unknown>>(initialSettings())
  const [edits, setEdits] = createSignal<{ scope: SettingsScope; edit: ConfigEdit }[]>([])
  const [settingEdits, setSettingEdits] = createSignal<{ key: string; value: unknown }[]>([])
  const writers: { resolve: (ok: boolean) => void }[] = []
  const resyncs: (() => void)[] = []

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

  // The server watches the config files and emits `config.updated`; `createData` resyncs the config resource, so this
  // effect re-reads the raw files from the host and releases any `save()` waiting for the new content.
  createEffect(
    on(
      entries,
      () => {
        post({ type: "configRead" })
        resyncs.splice(0).forEach((resolve) => resolve())
      },
      { defer: true },
    ),
  )

  // Core picks the last document that defines a key (`Config.latest`), so a later document replaces the whole
  // top-level value; the merge is one pass over the documents in priority order.
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
    const entry = edits()
      .toReversed()
      .find((item) => pathKey(item.edit.path) === pathKey(path))
    if (entry) return entry.edit.value
    return readPath(merged(), path)
  }

  const replace = (path: string[], value: unknown, scope: SettingsScope) => {
    const key = pathKey(path)
    setEdits((list) => [
      ...list.filter((item) => !(item.scope === scope && pathKey(item.edit.path) === key)),
      { scope, edit: { path, value } },
    ])
  }

  const set = (path: string[], value: unknown, scope: SettingsScope = "global") => replace(path, value, scope)
  const unset = (path: string[], scope: SettingsScope = "global") => replace(path, undefined, scope)

  const setting = (key: KiloSettingKey) => {
    const entry = settingEdits()
      .toReversed()
      .find((item) => item.key === key)
    return entry ? entry.value : settingsValues()[key]
  }

  const setSetting = (key: KiloSettingKey, value: unknown) =>
    setSettingEdits((list) => [...list.filter((item) => item.key !== key), { key, value }])

  const write = (scope: SettingsScope, scoped: ConfigEdit[]) =>
    new Promise<boolean>((resolve) => {
      writers.push({ resolve })
      post({ type: "configWrite", scope, edits: scoped })
    })

  /** The server reloads a written file on its own. Reload the location only when no resync arrives in time. */
  const waitForResync = () =>
    Promise.race([
      new Promise<void>((resolve) => resyncs.push(resolve)),
      new Promise<"timeout">((resolve) => window.setTimeout(() => resolve("timeout"), 3000)),
    ]).then(async (result) => {
      if (result !== "timeout") return
      await v2.api.location.reload().catch(v2.report)
      await v2.data.location.config.sync().catch(v2.report)
      post({ type: "configRead" })
    })

  const save = async () => {
    let ok = true
    for (const scope of ["global", "project"] as const) {
      const scoped = edits().filter((item) => item.scope === scope).map((item) => item.edit)
      if (scoped.length === 0) continue
      ok = (await write(scope, scoped)) && ok
    }
    if (!ok) return false
    const values = Object.fromEntries(settingEdits().map((item) => [item.key, item.value ?? null]))
    if (Object.keys(values).length > 0) post({ type: "updateVSCodeSettings", values })
    setEdits([])
    setSettingEdits([])
    await waitForResync()
    return true
  }

  const discard = () => {
    setEdits([])
    setSettingEdits([])
  }

  return {
    entries,
    merged,
    raw,
    path,
    source,
    value,
    set,
    unset,
    setting,
    setSetting,
    dirty: () => edits().length > 0 || settingEdits().length > 0,
    save,
    discard,
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
