/**
 * The session boundary of the Agent Manager.
 *
 * One panel relay serves every store. The sessions layer reads the root sessions of the active project's directories,
 * and the model, agent, provider and command catalogs come from the store of the project root. First prompts and model
 * switches of host-created worktree sessions are written through the v2 client of that worktree's store.
 */
import type { AgentInfo, CommandInfo, ModelInfo, ProviderInfo } from "@opencode/client"
import { createEffect, createMemo, on, onCleanup, type Accessor } from "solid-js"
import type { AgentManagerSendInitialMessage } from "../src/types/messages/agent-manager"
import type { SessionSearchItem } from "../src/utils/prompt-mention-drop"
import type { V2 } from "../src/v2/scope"
import type { VSCodeContext } from "./v2/vscode"
import type { AppDirectories } from "./app-directories"
import { createPanelData } from "./v2/panel-data"
import { createSessions } from "./v2/sessions"
import { dispatchInitialPrompt } from "./initial-message"

export function createAppSession(opts: {
  vscode: VSCodeContext
  directories: AppDirectories
  /** Root of the applied project, whose store holds the catalogs. */
  rootDirectory: Accessor<string | undefined>
}) {
  const panel = createPanelData({ post: (message) => opts.vscode.postMessage(message) })
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
          store.data.location.command.sync(),
        ]).catch(store.report)
      },
    ),
  )

  createEffect(() => panel.retain(opts.directories.retained()))

  const models = (): ModelInfo[] => rootStore()?.data.location.model.list() ?? []
  const providers = (): ProviderInfo[] => rootStore()?.data.location.provider.list() ?? []
  const agents = (): AgentInfo[] =>
    (rootStore()?.data.location.agent.list() ?? []).filter((agent) => agent.mode !== "subagent" && !agent.hidden)
  const commands = (): CommandInfo[] => rootStore()?.data.location.command.list() ?? []

  /** Sessions the panel already loaded, offered as past-chat mentions of the New Worktree dialog. */
  const mentionSessions = (): SessionSearchItem[] =>
    sessions
      .sessions()
      .map((info) => ({ id: info.id, title: info.title ?? "", updated: info.time.updated }))
      .filter((item) => item.title.length > 0)

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
    return dispatchInitialPrompt(store, ev).catch((error: unknown) => {
      store.report(error)
    })
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
    mentionSessions,
    switchModel,
    sendInitial,
  }
}

export type AppSession = ReturnType<typeof createAppSession>
