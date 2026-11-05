// The codebase indexing data of the v2 webviews: the `kilocode.indexing` RPC for status, config and warnings, and
// the host messages for machine-local consent, which lives in the extension's globalState. Config values are the
// `indexing` keys of the global and project config files, and a write replaces one of them.
import { KiloIndexingRpc } from "@opencode/schema/kilocode/indexing"
import { createContext, createEffect, createMemo, createSignal, on, onCleanup, onMount, useContext, type ParentComponent, type Accessor } from "solid-js"
import type { IndexingProject, IndexingSettings, ToHost, ToWebview } from "../../../src/protocol"
import { getVSCodeAPI, useVSCode } from "./vscode"
import { formatIndexingLabel, indexingButtonVisible, indexingEventSelected, indexingTone } from "./indexing-utils"
import { useV2 } from "../v2/client"
import { kiloSettings } from "../v2/kilo-settings"
import { indexingUpdate, type IndexingScope } from "../components/settings/indexing-tab-state"

type Status = KiloIndexingRpc.Status
type Config = KiloIndexingRpc.Config
type Settings = KiloIndexingRpc.Settings

const initial: Status = {
  state: "Disabled",
  message: "Indexing disabled.",
  processedFiles: 0,
  totalFiles: 0,
  percent: 0,
}

const empty: Settings = { global: {}, project: {}, kilo: false }

const emptySettings: IndexingSettings = {
  showButtonWhenDisabled: true,
  consent: false,
  projects: [],
}

export { formatIndexingLabel, indexingTone } from "./indexing-utils"
export type { IndexingProject, IndexingSettings }

interface IndexingContextValue {
  status: Accessor<Status>
  loading: Accessor<boolean>
  label: Accessor<string>
  tone: Accessor<"muted" | "warning" | "success" | "error">
  settings: Accessor<Settings>
  host: Accessor<IndexingSettings>
  globalConfig: Accessor<Config>
  projectConfig: Accessor<Config>
  project: Accessor<IndexingProject | undefined>
  projects: Accessor<IndexingProject[]>
  kiloAvailable: Accessor<boolean>
  showButtonWhenDisabled: Accessor<boolean>
  buttonVisible: Accessor<boolean>
  selectProject: (id: string) => void
  setShowButtonWhenDisabled: (value: boolean) => void
  setConsent: (enabled: boolean) => void
  update: (scope: IndexingScope, patch: Config) => Promise<void>
}

const IndexingContext = createContext<IndexingContextValue>()

export const IndexingProvider: ParentComponent = (props) => {
  const v2 = useV2()
  const vscode = useVSCode()
  const [status, setStatus] = createSignal<Status>(initial)
  const [loading, setLoading] = createSignal(true)
  const [settings, setSettings] = createSignal<Settings>(empty)
  const [host, setHost] = createSignal<IndexingSettings>(emptySettings)
  const [showButton, setShowButton] = createSignal<boolean | undefined>(undefined)
  // A failed read leaves the last known values in place, and an edit waits for a successful read because
  // `config.update` replaces the whole `indexing` key.
  const state = { loaded: false }

  const project = createMemo(() => host().projects.find((item) => item.id === host().projectId))
  const directory = () => project()?.directory
  const rpc = () => v2.api.rpc(KiloIndexingRpc.Definition)
  const location = () => (directory() ? { location: { directory: directory() } } : undefined)
  const post = (message: ToHost) => getVSCodeAPI().postMessage(message as never)

  const shown = () => showButton() ?? host().showButtonWhenDisabled
  const visible = createMemo(() =>
    indexingButtonVisible(shown(), settings().project, settings().global),
  )

  const projectId = () => host().projectId

  const readStatus = async () => {
    try {
      const next = await rpc().status({}, location())
      setStatus(next)
    } catch (error) {
      console.error("Indexing status read failed", error)
      setStatus(initial)
    } finally {
      setLoading(false)
    }
  }

  const readConfig = async () => {
    try {
      setSettings(await rpc().config({}, location()))
      state.loaded = true
    } catch (error) {
      console.error("Indexing config read failed", error)
    }
  }

  const refresh = () => {
    state.loaded = false
    setLoading(true)
    return Promise.all([readStatus(), readConfig()])
  }

  const unsubscribe = vscode.onMessage((raw) => {
    const message = raw as ToWebview
    if (message.type === "indexingSettingsLoaded") {
      setHost(message.settings)
      setShowButton(undefined)
      void refresh()
      return
    }
    if (message.type === "indexingStatusLoaded") {
      if (message.projectId && message.projectId !== projectId()) return
      setStatus(message.status)
      setLoading(false)
    }
  })
  onCleanup(unsubscribe)
  onMount(() => {
    post({ type: "requestIndexingSettings" })
    if (v2.connection.status() === "connected") void refresh()
  })
  // v1 refreshed the tab when the window regained focus, so config written elsewhere shows without a reload.
  const onFocus = () => {
    if (v2.connection.status() === "connected") void refresh()
  }
  window.addEventListener("focus", onFocus)
  onCleanup(() => window.removeEventListener("focus", onFocus))

  createEffect(
    on(v2.connection.status, (connection) => {
      if (connection !== "connected") return
      void refresh()
      const stop = rpc().events.on("status", (event) => {
        const location = event.location?.directory
        if (location && !indexingEventSelected(location, directory(), host().projects)) return
        setStatus(event.data.status)
        setLoading(false)
      })
      onCleanup(stop)
    }),
  )

  createEffect(
    on(projectId, () => {
      if (v2.connection.status() !== "connected") return
      void refresh()
    }),
  )

  // v1 settings are pushed to every view; a change applies at once and the host confirms it.
  createEffect(
    on(
      () => kiloSettings()["indexing.showButtonWhenDisabled"],
      (value) => {
        if (typeof value === "boolean") setShowButton(value)
      },
    ),
  )

  const update = async (scope: IndexingScope, patch: Config) => {
    if (!state.loaded) {
      await readConfig()
      if (!state.loaded) return
    }
    const current = scope === "global" ? settings().global : settings().project
    const next = indexingUpdate(scope, settings().global, settings().project, patch) as Config
    setSettings((prev) => ({ ...prev, [scope]: next }))
    try {
      await rpc()["config.update"]({ scope, config: next }, location())
    } catch {
      setSettings((prev) => ({ ...prev, [scope]: current }))
    }
    await readConfig()
  }

  const value: IndexingContextValue = {
    status,
    loading,
    label: createMemo(() => formatIndexingLabel(status())),
    tone: createMemo(() => indexingTone(status())),
    settings,
    host,
    globalConfig: () => settings().global,
    projectConfig: () => settings().project,
    project,
    projects: () => host().projects,
    kiloAvailable: () => settings().kilo,
    showButtonWhenDisabled: shown,
    buttonVisible: visible,
    selectProject: (id) => {
      post({ type: "requestIndexingSettings", projectId: id })
    },
    setShowButtonWhenDisabled: (value) => {
      setShowButton(value)
      post({ type: "updateVSCodeSettings", values: { "indexing.showButtonWhenDisabled": value } })
    },
    setConsent: (enabled) => {
      const id = projectId()
      if (id) post({ type: "setIndexingConsent", projectId: id, enabled })
    },
    update,
  }

  return <IndexingContext.Provider value={value}>{props.children}</IndexingContext.Provider>
}

// The Agent Manager mounts the shared session view without the indexing provider, so the hook answers an inert
// context there: the indexing action stays hidden instead of failing the whole webview.
const detached: IndexingContextValue = {
  status: () => initial,
  loading: () => false,
  label: () => formatIndexingLabel(initial),
  tone: () => indexingTone(initial),
  settings: () => empty,
  host: () => emptySettings,
  globalConfig: () => empty.global,
  projectConfig: () => empty.project,
  project: () => undefined,
  projects: () => [],
  kiloAvailable: () => false,
  showButtonWhenDisabled: () => false,
  buttonVisible: () => false,
  selectProject: () => {},
  setShowButtonWhenDisabled: () => {},
  setConsent: () => {},
  update: async () => {},
}

export function useIndexing(): IndexingContextValue {
  return useContext(IndexingContext) ?? detached
}
