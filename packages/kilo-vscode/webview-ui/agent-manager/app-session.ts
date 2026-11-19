/**
 * The session boundary of the Agent Manager.
 *
 * One panel relay serves every store. The sessions layer reads the root sessions of the active project's directories,
 * and the model, agent and provider catalogs come from the active project root. The New Worktree command catalog
 * follows the dialog's target instead. First prompts and model switches use the v2 client of the worktree's store.
 */
import type { AgentInfo, CommandInfo, ModelInfo, ProviderInfo } from "@opencode/client"
import { createEffect, createMemo, on, onCleanup, type Accessor } from "solid-js"
import type { AgentManagerSendInitialMessage } from "../src/types/messages/agent-manager"
import type { V2 } from "../src/v2/scope"
import type { VSCodeContext } from "./v2/bridge"
import type { AppDirectories } from "./app-directories"
import { createPanelData } from "./v2/panel-data"
import { createSessions } from "./v2/sessions"
import { dispatchInitialPrompt } from "./initial-message"
import { reloadRestoredDirectories } from "./restored-directories"

export function createAppSession(opts: {
  vscode: VSCodeContext
  directories: AppDirectories
  /** Root of the applied project, whose store holds the catalogs. */
  rootDirectory: Accessor<string | undefined>
  commandProject: Accessor<string | undefined>
}) {
  const panel = createPanelData({
    post: (message) => opts.vscode.postMessage(message),
    directories: opts.directories.sessionDirectories,
    home: opts.rootDirectory,
  })
  onCleanup(
    opts.vscode.onMessage((message) =>
      panel.receive(message as unknown as Parameters<typeof panel.receive>[0]),
    ),
  )
  const sessions = createSessions({
    panel,
    directories: opts.directories.sessionDirectories,
    directoryOf: opts.directories.directoryOf,
  })

  // Load session lists only for directories the panel shows; a worktree loads its list when it is selected.
  createEffect(() => panel.show(opts.directories.visibleDirectories()))

  const rootStore = createMemo(() => {
    const directory = opts.rootDirectory()
    return directory ? panel.store(directory) : undefined
  })

  // The catalogs follow the connection of the root store: a reconnect reloads them through createData.
  createEffect(
    on(
      () => [rootStore()?.directory, rootStore()?.connection.status()] as const,
      ([, status]) => {
        const store = rootStore()
        if (!store || status !== "connected") return
        void Promise.all([
          store.data.location.agent.sync(),
          store.data.location.model.sync(),
          store.data.location.provider.sync(),
          store.data.location.config.sync(),
        ]).catch(store.report)
      },
    ),
  )

  const commandStore = createMemo(() => {
    const directory = opts.directories.root(opts.commandProject())
    return directory ? panel.store(directory) : undefined
  })
  createEffect(
    on([commandStore, panel.connection.status], ([store, status]) => {
      if (store && status === "connected") void store.data.location.command.sync().catch(store.report)
    }),
  )

  createEffect(() => {
    const directory = commandStore()?.directory
    const retained = [...opts.directories.retained(), ...sessions.followed()]
    if (directory) retained.push(directory)
    panel.retain(retained)
  })

  // A restored worktree folder loads again; its store failed while the folder was gone.
  reloadRestoredDirectories(panel, opts.directories)

  const models = (): ModelInfo[] => rootStore()?.data.location.model.list() ?? []
  const providers = (): ProviderInfo[] => rootStore()?.data.location.provider.list() ?? []
  const agents = (): AgentInfo[] =>
    (rootStore()?.data.location.agent.list() ?? []).filter((agent) => agent.mode !== "subagent" && !agent.hidden)
  const commands = (): CommandInfo[] => commandStore()?.data.location.command.list() ?? []

  const storeFor = (directory: string | undefined): V2 | undefined => {
    if (directory) return panel.store(directory)
    return rootStore()
  }

  const switchModel = (sessionID: string, providerID: string, modelID: string) => {
    const store = sessions.scope(sessionID) ?? rootStore()
    if (!store) return Promise.resolve()
    return store.api.session
      .switchModel({ sessionID, model: { id: modelID, providerID } })
      .catch((error: unknown) => {
        store.report(error)
      })
  }

  const sendInitial = (ev: AgentManagerSendInitialMessage) => {
    const directory = ev.worktreeId
      ? opts.directories.worktreePathIn(ev.projectId, ev.worktreeId)
      : ev.projectId
        ? opts.directories.root(ev.projectId)
        : undefined
    const store = storeFor(directory ?? opts.directories.directoryOf(ev.sessionId))
    if (!store) return Promise.resolve()
    const startup = store.startup.start(ev.sessionId)
    return dispatchInitialPrompt(store, ev, startup.signal)
      .catch((error: unknown) => {
        if (!startup.signal.aborted) store.report(error)
      })
      .finally(startup.done)
  }

  return {
    panel,
    sessions,
    storeFor,
    rootStore,
    models,
    providers,
    agents,
    commands,
    switchModel,
    sendInitial,
  }
}
