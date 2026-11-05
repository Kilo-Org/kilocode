// The codebase indexing host: machine-local consent per project in globalState, re-sent to the server for the
// workspace project whenever the server starts, and the settings and status messages the webviews consume. The
// status itself comes from the `kilocode.indexing` RPC and its status events; this host only answers consent.
import { OpenCode } from "@opencode/client"
import { KiloIndexingRpc } from "@opencode/schema/kilocode/indexing"
import type { ExtensionContext } from "vscode"
import { local } from "../local"
import type { Manager } from "../server"
import type { IndexingProject as HostProject, ToWebview } from "../protocol"
import { buildIndexingSettingsMessage } from "../kilo-provider/indexing-settings"
import {
  IndexingConsentStore,
  indexingConsentStore,
  registeredProjects,
} from "./consent"

export interface IndexingRpc {
  status(directory: string | undefined): Promise<KiloIndexingRpc.Status>
  consent(enabled: boolean, directory: string | undefined): Promise<KiloIndexingRpc.Status>
}

export interface IndexingHost {
  attach(post: (message: ToWebview) => void): () => void
  requestSettings(projectId?: string): Promise<void>
  setConsent(projectId: string, enabled: boolean): Promise<void>
  sync(): Promise<void>
  dispose(): void
}

type Post = (message: ToWebview) => void

export function createIndexingHost(input: {
  context: ExtensionContext
  server: Pick<Manager, "get">
  directory: () => string | undefined
  /** Test seam: the RPC of the running server. */
  connect?: () => Promise<IndexingRpc>
  /** Test seam: the consent store, normally the extension globalState one. */
  store?: IndexingConsentStore
  /** Test seam: the additional Agent Manager projects. */
  extras?: () => Array<{ root: string; label?: string }>
  log?: (message: string, error: unknown) => void
}): IndexingHost {
  const store = input.store ?? indexingConsentStore(input.context)
  const extras = input.extras ?? (() => registeredProjects(input.context))
  const surfaces = new Set<Post>()
  const state = { projectId: undefined as string | undefined, settings: 0, status: 0, disposed: false }

  const broadcast = (message: ToWebview) => surfaces.forEach((post) => post(message))

  const rpc = async (): Promise<IndexingRpc> => {
    const server = await input.server.get()
    const client = OpenCode.make({
      baseUrl: server.url,
      headers: { authorization: server.authorization },
      fetch: local,
    }).rpc(KiloIndexingRpc.Definition)
    return {
      status: (directory) =>
        client.status({}, directory ? { location: { directory } } : undefined),
      consent: (enabled, directory) =>
        client.consent({ enabled }, directory ? { location: { directory } } : undefined),
    }
  }

  const connection = () => (input.connect ? input.connect() : rpc())

  const projects = async (): Promise<HostProject[]> => {
    const list = await store.list(input.directory(), extras())
    // The primary project is the server's own Location, so the RPC omits the location for it.
    const primary = input.directory() !== undefined
    return list.map((project, index) => ({
      ...project,
      directory: primary && index === 0 ? undefined : project.root,
    }))
  }

  const publishSettings = async (projectId?: string) => {
    const token = ++state.settings
    const list = await projects()
    if (state.disposed || token !== state.settings) return undefined
    const id = list.some((project) => project.id === projectId)
      ? projectId
      : list.some((project) => project.id === state.projectId)
        ? state.projectId
        : list[0]?.id
    state.projectId = id
    broadcast(buildIndexingSettingsMessage(id ? store.enabled(id) : false, list, id))
    return { list, project: list.find((item) => item.id === id) }
  }

  const readStatus = async (project: HostProject) => {
    const token = ++state.status
    const status = await (await connection()).status(project.directory)
    return { token, status }
  }

  const sendStatus = async (project: HostProject, status: KiloIndexingRpc.Status) => {
    if (state.disposed) return
    broadcast({ type: "indexingStatusLoaded", status, projectId: project.id })
  }

  const fetchStatus = async (projectId?: string) => {
    const found = await publishSettings(projectId)
    const project = found?.project
    if (!project) return
    try {
      const result = await readStatus(project)
      if (result.token !== state.status || state.disposed) return
      await sendStatus(project, result.status)
    } catch (error) {
      input.log?.("Failed to read indexing status", error)
    }
  }

  return {
    attach(post) {
      surfaces.add(post)
      return () => surfaces.delete(post)
    },
    requestSettings(projectId) {
      return fetchStatus(projectId)
    },
    async setConsent(projectId, enabled) {
      const list = await projects()
      const project = list.find((item) => item.id === projectId)
      if (!project) return
      await store.set(project.id, enabled)
      state.projectId = project.id
      state.settings++
      const token = ++state.status
      broadcast(buildIndexingSettingsMessage(store.enabled(project.id), list, project.id))
      try {
        const status = await (await connection()).consent(enabled, project.directory)
        if (state.disposed || token !== state.status) return
        await sendStatus(project, status)
      } catch (error) {
        input.log?.(`Failed to set indexing consent ${enabled ? "on" : "off"}`, error)
      }
    },
    async sync() {
      const project = (await projects())[0]
      if (!project) return
      state.projectId = project.id
      try {
        await (await connection()).consent(store.enabled(project.id), project.directory)
      } catch (error) {
        input.log?.("Failed to sync indexing consent", error)
      }
    },
    dispose() {
      state.disposed = true
      surfaces.clear()
    },
  }
}

const hosts = new WeakMap<ExtensionContext, IndexingHost>()

export function indexingHost(input: {
  context: ExtensionContext
  server: Pick<Manager, "get">
  directory: () => string | undefined
  log?: (message: string, error: unknown) => void
}): IndexingHost {
  const existing = hosts.get(input.context)
  if (existing) return existing
  const host = createIndexingHost(input)
  hosts.set(input.context, host)
  return host
}
