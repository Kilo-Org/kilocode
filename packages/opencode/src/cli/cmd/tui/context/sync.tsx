import type {
  Message,
  Agent,
  Provider,
  Session,
  Part,
  Config,
  Todo,
  Command,
  PermissionRequest,
  QuestionRequest,
  SuggestionRequest, // kilocode_change
  SessionNetworkWait, // kilocode_change
  LspStatus,
  McpStatus,
  McpResource,
  FormatterStatus,
  SessionStatus,
  ProviderListResponse,
  ProviderAuthMethod,
  VcsInfo,
  BackgroundProcessInfo, // kilocode_change
  InteractiveTerminalSnapshot, // kilocode_change
} from "@kilocode/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { useProject } from "@tui/context/project"
import { useEvent } from "@tui/context/event"
import { useSDK } from "@tui/context/sdk"
import { Binary } from "@opencode-ai/core/util/binary"
import { createSimpleContext } from "./helper"
import type { Snapshot } from "@/snapshot"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { batch, createEffect, on, onMount } from "solid-js" // kilocode_change - add createEffect/on for workspace re-bootstrap
import { handleSuggestionEvent } from "@/kilocode/suggestion/tui/sync" // kilocode_change
import { appendTerminalOutput } from "@/kilocode/interactive-terminal/output" // kilocode_change
import { useToast } from "@tui/ui/toast" // kilocode_change
import * as Log from "@opencode-ai/core/util/log"
import { emptyConsoleState, type ConsoleState } from "@opencode-ai/core/v1/config/console-state"
import type { IndexingStatus } from "@kilocode/kilo-indexing/status" // kilocode_change
import path from "path"
import { useKV } from "./kv"
import { aggregateFailures } from "./aggregate-failures"

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      provider: Provider[]
      provider_default: Record<string, string>
      provider_next: ProviderListResponse
      console_state: ConsoleState
      provider_auth: Record<string, ProviderAuthMethod[]>
      agent: Agent[]
      command: Command[]
      permission: {
        [sessionID: string]: PermissionRequest[]
      }
      question: {
        [sessionID: string]: QuestionRequest[]
      }
      // kilocode_change start
      suggestion: {
        [sessionID: string]: SuggestionRequest[]
      }
      network: {
        [sessionID: string]: SessionNetworkWait[]
      }
      // kilocode_change end
      config: Config
      globalConfig: Config // kilocode_change
      session: Session[]
      session_status: {
        [sessionID: string]: SessionStatus
      }
      session_diff: {
        [sessionID: string]: Omit<Snapshot.FileDiff, "before" | "after">[] // kilocode_change
      }
      todo: {
        [sessionID: string]: Todo[]
      }
      // kilocode_change start
      background_process: {
        [sessionID: string]: BackgroundProcessInfo[]
      }
      interactive_terminal: {
        [sessionID: string]: InteractiveTerminalSnapshot[]
      }
      // kilocode_change end
      message: {
        [sessionID: string]: Message[]
      }
      part: {
        [messageID: string]: Part[]
      }
      lsp: LspStatus[]
      mcp: {
        [key: string]: McpStatus
      }
      mcp_resource: {
        [key: string]: McpResource
      }
      formatter: FormatterStatus[]
      vcs: VcsInfo | undefined
      indexing: IndexingStatus // kilocode_change
    }>({
      provider_next: {
        all: [],
        default: {},
        connected: [],
        failed: [], // kilocode_change
      },
      console_state: emptyConsoleState,
      provider_auth: {},
      config: {},
      globalConfig: {}, // kilocode_change
      status: "loading",
      agent: [],
      permission: {},
      question: {},
      // kilocode_change start
      suggestion: {},
      network: {},
      // kilocode_change end
      command: [],
      provider: [],
      provider_default: {},
      session: [],
      session_status: {},
      session_diff: {},
      todo: {},
      background_process: {}, // kilocode_change
      interactive_terminal: {}, // kilocode_change
      message: {},
      part: {},
      lsp: [],
      mcp: {},
      mcp_resource: {},
      formatter: [],
      vcs: undefined,
      indexing: { state: "Disabled", message: "Indexing disabled.", processedFiles: 0, totalFiles: 0, percent: 0 }, // kilocode_change
    })

    const event = useEvent()
    const project = useProject()
    const sdk = useSDK()
    const toast = useToast() // kilocode_change
    const kv = useKV()

    // kilocode_change start
    function processScope(scope: string) {
      const current = project.instance.path()
      return scope === current.directory || scope === current.worktree || scope === project.data.project.worktree
    }

    function evict(sessionID: string) {
      // Collect child session IDs so we can evict them too.
      const children = store.session.filter((s) => s.parentID === sessionID).map((s) => s.id)
      setStore(
        produce((draft) => {
          const messages = draft.message[sessionID]
          if (messages) {
            for (const msg of messages) delete draft.part[msg.id]
          }
          delete draft.message[sessionID]
          delete draft.session_diff[sessionID]
          delete draft.session_status[sessionID]
          delete draft.todo[sessionID]
          const processes = draft.background_process[sessionID]?.filter((item) => item.lifetime === "persistent")
          if (processes?.length) draft.background_process[sessionID] = processes
          else delete draft.background_process[sessionID]
          delete draft.interactive_terminal[sessionID] // kilocode_change
          delete draft.permission[sessionID]
          delete draft.question[sessionID]
          delete draft.suggestion[sessionID]
          delete draft.network[sessionID]
        }),
      )
      fullSyncedSessions.delete(sessionID)
      for (const child of children) evict(child)
    }

    // Strip summary.diffs from user messages — the TUI never reads them
    // and they can carry multi-MB before/after file content strings.
    function strip(msg: Message): Message {
      if (msg.role !== "user" || !msg.summary?.diffs) return msg
      return { ...msg, summary: { ...msg.summary, diffs: [] } } as Message
    }
    // kilocode_change end

    const fullSyncedSessions = new Set<string>()
    const deleted = new Set<string>() // kilocode_change
    const terminalDeleted = new Set<string>() // kilocode_change
    let syncedWorkspace = project.workspace.current()
    let vcsVersion = 0 // kilocode_change
    const syncingSessions = new Map<string, Promise<void>>()
    const hydratingSessions = new Map<string, { messages: Set<string>; parts: Set<string> }>()
    const touchMessage = (sessionID: string, messageID: string) => {
      hydratingSessions.get(sessionID)?.messages.add(messageID)
    }
    const touchPart = (sessionID: string, partID: string) => {
      hydratingSessions.get(sessionID)?.parts.add(partID)
    }

    function sessionListQuery(): { scope?: "project"; path?: string } {
    if (!kv.get("session_directory_filter_enabled", true)) return { scope: "project" }
    if (!project.data.instance.path.worktree || !project.data.instance.path.directory) return { scope: "project" }
    return {
      path: path
        .relative(path.resolve(project.data.instance.path.worktree), project.data.instance.path.directory)
        .replaceAll("\\", "/"),
    }
  }

    function listSessions() {
      return sdk.client.session
        .list({ start: Date.now() - 30 * 24 * 60 * 60 * 1000, ...sessionListQuery() })
        .then((x) => (x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id)))
    }

    event.subscribe((event, { workspace }) => {
      switch (event.type) {
        case "server.instance.disposed":
          // kilocode_change start
          deleted.clear()
          terminalDeleted.clear()
          setStore("background_process", {})
          setStore("interactive_terminal", {})
          // kilocode_change end
          void bootstrap()
          break
        case "permission.replied": {
          const requests = store.permission[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "permission",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "permission.asked": {
          const request = event.properties
          const requests = store.permission[request.sessionID]
          if (!requests) {
            setStore("permission", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("permission", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "permission",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "question.replied":
        case "question.rejected": {
          const requests = store.question[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "question",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "question.asked": {
          const request = event.properties
          const requests = store.question[request.sessionID]
          if (!requests) {
            setStore("question", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("question", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "question",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        } // kilocode_change

        // kilocode_change start
        case "session.network.replied":
        case "session.network.rejected": {
          const requests = store.network[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "network",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "suggestion.accepted":
        case "suggestion.dismissed":
        case "suggestion.shown": {
          handleSuggestionEvent(event, store, setStore)
          break
        }

        case "session.network.restored": {
          const requests = store.network[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (match.found) {
            setStore("network", event.properties.sessionID, match.index, "restored", true)
            setStore("network", event.properties.sessionID, match.index, "time", "restored", event.properties.time) // kilocode_change
          }
          break
        }

        case "session.network.asked": {
          const request = event.properties
          const requests = store.network[request.sessionID]
          if (!requests) {
            setStore("network", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("network", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "network",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }
        // kilocode_change end
        case "todo.updated":
          setStore("todo", event.properties.sessionID, event.properties.todos)
          break

        case "session.diff":
          setStore("session_diff", event.properties.sessionID, event.properties.diff)
          break

        case "session.next.moved": {
          const result = Binary.search(store.session, event.properties.sessionID, (s) => s.id)
          if (!result.found) break
          setStore(
            "session",
            result.index,
            produce((session) => {
              session.directory = event.properties.location.directory
              session.path = event.properties.subdirectory
              session.workspaceID = event.properties.location.workspaceID
              session.time.updated = event.properties.timestamp
            }),
          )
          break
        }

        // kilocode_change start
        case "session.status": {
          setStore("session_status", event.properties.sessionID, event.properties.status)
          break
        }
        // kilocode_change end

        // kilocode_change start
        case "background_process.updated": {
          if (!processScope(event.properties.scope)) break
          const info = event.properties.info
          deleted.delete(info.id)
          setStore(
            "background_process",
            produce((draft) => {
              for (const [sessionID, list] of Object.entries(draft)) {
                const index = list.findIndex((item) => item.id === info.id)
                if (index < 0) continue
                list.splice(index, 1)
                if (list.length === 0) delete draft[sessionID]
              }
              const list = draft[info.sessionID] ?? []
              const result = Binary.search(list, info.id, (item) => item.id)
              list.splice(result.index, 0, info)
              draft[info.sessionID] = list
            }),
          )
          break
        }

        case "background_process.deleted": {
          if (!processScope(event.properties.scope)) break
          deleted.add(event.properties.processID)
          setStore(
            "background_process",
            produce((draft) => {
              for (const [sessionID, list] of Object.entries(draft)) {
                const index = list.findIndex((item) => item.id === event.properties.processID)
                if (index < 0) continue
                list.splice(index, 1)
                if (list.length === 0) delete draft[sessionID]
              }
            }),
          )
          break
        }

        case "interactive_terminal.updated": {
          const info = event.properties.info
          terminalDeleted.delete(info.id)
          const list = store.interactive_terminal[info.sessionID]
          if (!list) {
            setStore("interactive_terminal", info.sessionID, [{ info, output: "", cursor: 0 }])
            break
          }
          const result = Binary.search(list, info.id, (item) => item.info.id)
          if (result.found) {
            setStore("interactive_terminal", info.sessionID, result.index, "info", reconcile(info))
            break
          }
          setStore(
            "interactive_terminal",
            info.sessionID,
            produce((draft) => {
              draft.splice(result.index, 0, { info, output: "", cursor: 0 })
            }),
          )
          break
        }

        case "interactive_terminal.data": {
          const list = store.interactive_terminal[event.properties.sessionID]
          if (!list) break
          const result = Binary.search(list, event.properties.terminalID, (item) => item.info.id)
          if (!result.found) break
          setStore(
            "interactive_terminal",
            event.properties.sessionID,
            result.index,
            produce((draft) => {
              draft.output = appendTerminalOutput(draft.output, event.properties.data)
              draft.cursor = event.properties.cursor
            }),
          )
          break
        }

        case "interactive_terminal.deleted": {
          terminalDeleted.add(event.properties.terminalID)
          const list = store.interactive_terminal[event.properties.sessionID]
          if (!list) break
          const result = Binary.search(list, event.properties.terminalID, (item) => item.info.id)
          if (!result.found) break
          setStore(
            "interactive_terminal",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(result.index, 1)
            }),
          )
          break
        }
        // kilocode_change end

        case "message.part.delta": {
          const parts = store.part[event.properties.messageID]
          if (!parts) break
          const result = Binary.search(parts, event.properties.partID, (p) => p.id)
          if (!result.found) break
          touchPart(event.properties.sessionID, event.properties.partID)
          setStore(
            "part",
            event.properties.messageID,
            produce((draft) => {
              const part = draft[result.index]
              const field = event.properties.field as keyof typeof part
              const existing = part[field] as string | undefined
              ;(part[field] as string) = (existing ?? "") + event.properties.delta
            }),
          )
          break
        }

        case "lsp.updated": {
          const workspace = project.workspace.current()
          void sdk.client.lsp.status({ workspace }).then((x) => setStore("lsp", x.data ?? []))
          break
        }

        case "vcs.branch.updated": {
          if (workspace === project.workspace.current()) {
            vcsVersion += 1
            setStore("vcs", { branch: event.properties.branch })
          }
          break
        }

        // kilocode_change start
        case "global.config.updated": {
          sdk.client.global.config.get().then((x) => {
            if (x.data) setStore("globalConfig", reconcile(x.data))
          })
          sdk.client.config.get().then((x) => {
            if (x.data) setStore("config", reconcile(x.data))
          })
          break
        }
        case "indexing.status": {
          setStore("indexing", reconcile(event.properties.status))
          break
        }
        // kilocode_change end
      }
    })

    event.sync((event) => {
      switch (event.name) {
        case "session.created.1": {
          const info = event.data.info
          const match = Binary.search(store.session, info.id, (s) => s.id)
          if (match.found) setStore("session", match.index, reconcile(info))
          if (!match.found) {
            setStore(
              "session",
              produce((draft) => {
                draft.splice(match.index, 0, info)
              }),
            )
          }
          break
        }
        case "session.updated.1": {
          const sid = event.data.sessionID
          const match = Binary.search(store.session, sid, (s) => s.id)
          if (!match.found) break
          setStore(
            "session",
            match.index,
            reconcile(event.data.info), // kilocode_change - session.updated carries a full snapshot, including omitted optional fields
          )
          break
        }
        case "session.deleted.1": {
          const sid = event.data.sessionID
          const match = Binary.search(store.session, sid, (s) => s.id)
          if (match.found) {
            setStore(
              "session",
              produce((draft) => {
                draft.splice(match.index, 1)
              }),
            )
          }
          evict(sid)
          break
        }
        case "message.updated.1": {
          touchMessage(event.data.info.sessionID, event.data.info.id) // kilocode_change - hydration tracker
          const info = strip(event.data.info)
          const messages = store.message[info.sessionID]
          if (!messages) {
            setStore("message", info.sessionID, [info])
            break
          }
          const match = Binary.search(messages, info.id, (m) => m.id)
          if (match.found) {
            setStore("message", info.sessionID, match.index, reconcile(info))
            break
          }
          setStore(
            "message",
            info.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, info)
            }),
          )
          const updated = store.message[info.sessionID]
          if (updated.length <= 100) break
          const oldest = updated[0]
          batch(() => {
            setStore(
              "message",
              info.sessionID,
              produce((draft) => {
                draft.shift()
              }),
            )
            setStore(
              "part",
              produce((draft) => {
                delete draft[oldest.id]
              }),
            )
          })
          break
        }
        case "message.removed.1": {
          touchMessage(event.data.sessionID, event.data.messageID) // kilocode_change - hydration tracker
          const messages = store.message[event.data.sessionID]
          if (!messages) break
          const match = Binary.search(messages, event.data.messageID, (m) => m.id)
          if (!match.found) break
          setStore(
            "message",
            event.data.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }
        case "message.part.updated.1": {
          touchPart(event.data.sessionID, event.data.part.id) // kilocode_change - hydration tracker
          const part = event.data.part
          const parts = store.part[part.messageID]
          if (!parts) {
            setStore("part", part.messageID, [part])
            break
          }
          const match = Binary.search(parts, part.id, (p) => p.id)
          if (match.found) {
            setStore("part", part.messageID, match.index, reconcile(part))
            break
          }
          setStore(
            "part",
            part.messageID,
            produce((draft) => {
              draft.splice(match.index, 0, part)
            }),
          )
          break
        }
        case "message.part.removed.1": {
          touchPart(event.data.sessionID, event.data.partID) // kilocode_change - hydration tracker
          const parts = store.part[event.data.messageID]
          if (!parts) break
          const match = Binary.search(parts, event.data.partID, (p) => p.id)
          if (!match.found) break
          setStore(
            "part",
            event.data.messageID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }
      }
    })

    const exit = useExit()
    const args = useArgs()

    async function bootstrap(input: { fatal?: boolean } = {}) {
      const fatal = input.fatal ?? true
      const workspace = project.workspace.current()
      if (workspace !== syncedWorkspace) {
        fullSyncedSessions.clear()
        // kilocode_change start
        deleted.clear()
        terminalDeleted.clear()
        setStore("background_process", {})
        setStore("interactive_terminal", {})
        // kilocode_change end
        syncedWorkspace = workspace
      }
      const projectPromise = project.sync()
      const sessionListPromise = projectPromise.then(() => listSessions())
      const version = vcsVersion // kilocode_change

      // blocking - include session.list when continuing a session
      const providersPromise = sdk.client.config.providers({ workspace }, { throwOnError: true })
      const providerListPromise = sdk.client.provider.list({ workspace }, { throwOnError: true })
      const consoleStatePromise = sdk.client.experimental.console
        .get({ workspace }, { throwOnError: true })
        .then((x) => x.data)
        .catch(() => emptyConsoleState)
      const agentsPromise = sdk.client.app.agents({ workspace }, { throwOnError: true })
      const configPromise = sdk.client.config.get({ workspace }, { throwOnError: true })
      const globalConfigPromise = sdk.client.global.config.get({ throwOnError: true }) // kilocode_change
      const blockingRequests: { name: string; promise: Promise<unknown> }[] = [
        { name: "config.providers", promise: providersPromise },
        { name: "provider.list", promise: providerListPromise },
        { name: "app.agents", promise: agentsPromise },
        { name: "config.get", promise: configPromise },
        { name: "global.config", promise: globalConfigPromise }, // kilocode_change
        { name: "project.sync", promise: projectPromise },
        ...(args.continue ? [{ name: "session.list", promise: sessionListPromise }] : []),
      ]

      await Promise.allSettled(blockingRequests.map((r) => r.promise))
        .then((settled) => {
          // Surface every failed endpoint in one labeled message instead of
          // letting the first rejection drown its siblings as unhandled
          // rejections.
          const failure = aggregateFailures(blockingRequests.map((r, i) => ({ name: r.name, result: settled[i] })))
          if (failure) throw failure
        })
        .then(async () => {
          const providersResponse = providersPromise.then((x) => x.data!)
          const providerListResponse = providerListPromise.then((x) => x.data!)
          const consoleStateResponse = consoleStatePromise
          const agentsResponse = agentsPromise.then((x) => x.data ?? [])
          const configResponse = configPromise.then((x) => x.data!)
          const globalConfigResponse = globalConfigPromise.then((x) => x.data!) // kilocode_change
          const sessionListResponse = args.continue ? sessionListPromise : undefined

          return Promise.all([
            providersResponse,
            providerListResponse,
            consoleStateResponse,
            agentsResponse,
            configResponse,
            globalConfigResponse, // kilocode_change
            ...(sessionListResponse ? [sessionListResponse] : []),
          ]).then((responses) => {
            const providers = responses[0]
            const providerList = responses[1]
            const consoleState = responses[2]
            const agents = responses[3]
            const config = responses[4]
            const globalConfig = responses[5] // kilocode_change
            const sessions = responses[6] // kilocode_change

            batch(() => {
              setStore("provider", reconcile(providers.providers))
              setStore("provider_default", reconcile(providers.default))
              setStore("provider_next", reconcile(providerList))
              setStore("console_state", reconcile(consoleState))
              setStore("agent", reconcile(agents))
              setStore("config", reconcile(config))
              setStore("globalConfig", reconcile(globalConfig)) // kilocode_change
              if (sessions !== undefined) setStore("session", reconcile(sessions))
            })
          })
        })
        .then(() => {
          if (store.status !== "complete") setStore("status", "partial")
          // non-blocking
          void Promise.all([
            ...(args.continue ? [] : [sessionListPromise.then((sessions) => setStore("session", reconcile(sessions)))]),
            consoleStatePromise.then((consoleState) => setStore("console_state", reconcile(consoleState))),
            sdk.client.command.list({ workspace }).then((x) => setStore("command", reconcile(x.data ?? []))),
            sdk.client.lsp.status({ workspace }).then((x) => setStore("lsp", reconcile(x.data ?? []))),
            sdk.client.mcp.status({ workspace }).then((x) => setStore("mcp", reconcile(x.data ?? {}))),
            // kilocode_change start
            sdk.client.experimental.resource
              .list({ workspace })
              .then((x) => setStore("mcp_resource", reconcile(x.data ?? {}))),
            // kilocode_change end
            sdk.client.formatter.status({ workspace }).then((x) => setStore("formatter", reconcile(x.data!))), // kilocode_change
            // kilocode_change start
            sdk.client.network.list().then((x) => {
              const next: Record<string, SessionNetworkWait[]> = {}
              for (const item of x.data ?? []) {
                if (!next[item.sessionID]) next[item.sessionID] = []
                next[item.sessionID].push(item)
              }
              setStore("network", reconcile(next))
            }),
            sdk.client.backgroundProcess.list({ workspace }).then((x) => {
              const next: Record<string, BackgroundProcessInfo[]> = {}
              for (const item of x.data ?? []) {
                if (!next[item.sessionID]) next[item.sessionID] = []
                next[item.sessionID].push(item)
              }
              for (const list of Object.values(next)) list.sort((a, b) => a.id.localeCompare(b.id))
              setStore(
                "background_process",
                produce((draft) => {
                  const items = new Map(
                    Object.values(draft)
                      .flat()
                      .map((item) => [item.id, item]),
                  )
                  for (const item of Object.values(next).flat()) {
                    if (deleted.has(item.id)) continue
                    const prev = items.get(item.id)
                    if (!prev || item.time.updated > prev.time.updated) items.set(item.id, item)
                  }
                  for (const sessionID of Object.keys(draft)) delete draft[sessionID]
                  for (const item of items.values()) {
                    if (!draft[item.sessionID]) draft[item.sessionID] = []
                    draft[item.sessionID].push(item)
                  }
                  for (const list of Object.values(draft)) list.sort((a, b) => a.id.localeCompare(b.id))
                }),
              )
            }),
            sdk.client.interactiveTerminal.list({ workspace }).then((x) => {
              const next: Record<string, InteractiveTerminalSnapshot[]> = {}
              for (const item of x.data ?? []) {
                if (terminalDeleted.has(item.info.id)) continue
                if (!next[item.info.sessionID]) next[item.info.sessionID] = []
                next[item.info.sessionID].push(item)
              }
              for (const list of Object.values(next)) list.sort((a, b) => a.info.id.localeCompare(b.info.id))
              setStore(
                "interactive_terminal",
                produce((draft) => {
                  for (const [sessionID, list] of Object.entries(next)) {
                    const items = new Map((draft[sessionID] ?? []).map((item) => [item.info.id, item]))
                    for (const item of list) {
                      if (!items.has(item.info.id)) items.set(item.info.id, item)
                    }
                    draft[sessionID] = Array.from(items.values()).toSorted((a, b) => a.info.id.localeCompare(b.info.id))
                  }
                }),
              )
            }),
            // kilocode_change end
            sdk.client.session.status({ workspace }).then((x) => {
              setStore("session_status", reconcile(x.data ?? {}))
            }),
            sdk.client.provider.auth({ workspace }).then((x) => setStore("provider_auth", reconcile(x.data ?? {}))),
            sdk.client.vcs.get({ workspace }).then((x) => {
              if (version === vcsVersion && workspace === project.workspace.current()) {
                setStore("vcs", reconcile(x.data))
              }
            }),
            project.workspace.sync(),
            // kilocode_change start - show config warnings as persistent toast
            sdk.client.config
              .warnings()
              .then((x) => {
                const list = x.data ?? []
                if (list.length === 0) return
                const first = list[0]
                const suffix = list.length > 1 ? ` (and ${list.length - 1} more)` : ""
                toast.show({
                  title: "Config Warning",
                  message: first.message + suffix,
                  variant: "warning",
                  duration: 0,
                })
              })
              .catch(() => {}),
            sdk.client.indexing
              .status({ workspace })
              .then((x) => setStore("indexing", reconcile(x.data ?? store.indexing))),
            // kilocode_change end
          ]).then(() => {
            setStore("status", "complete")
          })
        })
        .catch(async (e) => {
          Log.Default.error("tui bootstrap failed", {
            error: e instanceof Error ? e.message : String(e),
            name: e instanceof Error ? e.name : undefined,
            stack: e instanceof Error ? e.stack : undefined,
          })
          if (fatal) {
            await exit(e)
          } else {
            throw e
          }
        })
    }

    onMount(() => {
      void bootstrap()
    })

    // kilocode_change start - re-bootstrap when workspace changes (Agent Manager)
    createEffect(
      on(
        () => project.workspace.current(),
        () => {
          fullSyncedSessions.clear()
          void bootstrap()
        },
        { defer: true },
      ),
    )
    // kilocode_change end

    const result = {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        // return true // kilocode_change - upstream #23037 left this debug path enabled; keep it commented so future merges do not restore eager ready state.
        if (process.env.KILO_FAST_BOOT) return true
        return store.status !== "loading"
      },
      get path() {
        return project.instance.path()
      },
      session: {
        get(sessionID: string) {
          const match = Binary.search(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
        },
        query() {
          return sessionListQuery()
        },
        async refresh() {
          const list = await listSessions()
          setStore("session", reconcile(list))
        },
        status(sessionID: string) {
          const session = result.session.get(sessionID)
          if (!session) return "idle"
          if (session.time.compacting) return "compacting"
          const messages = store.message[sessionID] ?? []
          const last = messages.at(-1)
          if (!last) return "idle"
          if (last.role === "user") return "working"
          return last.time.completed ? "idle" : "working"
        },
        async sync(sessionID: string) {
          if (fullSyncedSessions.has(sessionID)) return
          const syncing = syncingSessions.get(sessionID)
          if (syncing) return syncing
          const tracker = { messages: new Set<string>(), parts: new Set<string>() }
          hydratingSessions.set(sessionID, tracker)
          const task = (async () => {
            const [session, messages, todo, diff] = await Promise.all([
              sdk.client.session.get({ sessionID }, { throwOnError: true }),
              sdk.client.session.messages({ sessionID, limit: 100 }),
              sdk.client.session.todo({ sessionID }),
              sdk.client.session.diff({ sessionID }),
            ])
            setStore(
              produce((draft) => {
                const match = Binary.search(draft.session, sessionID, (s) => s.id)
                if (match.found) draft.session[match.index] = session.data!
                if (!match.found) draft.session.splice(match.index, 0, session.data!)
                draft.todo[sessionID] = todo.data ?? []
                const currentMessages = draft.message[sessionID] ?? []
                const infos = (messages.data ?? []).flatMap((message) => {
                  if (!tracker.messages.has(message.info.id)) return [strip(message.info)] // kilocode_change
                  const current = currentMessages.find((item) => item.id === message.info.id)
                  return current ? [current] : []
                })
                infos.push(
                  ...currentMessages.filter(
                    (message) => tracker.messages.has(message.id) && !infos.some((item) => item.id === message.id),
                  ),
                )
                const removed = infos.slice(0, -100)
                const visible = infos.slice(-100)
                const visibleIDs = new Set(visible.map((message) => message.id))
                for (const message of messages.data ?? []) {
                  if (!visibleIDs.has(message.info.id)) {
                    delete draft.part[message.info.id]
                    continue
                  }
                  const currentParts = draft.part[message.info.id] ?? []
                  const parts = message.parts.flatMap((part) => {
                    const current = currentParts.find((item) => item.id === part.id)
                    if (tracker.parts.has(part.id)) return current ? [current] : []
                    if (
                      current &&
                      (part.type === "text" || part.type === "reasoning") &&
                      (current.type === "text" || current.type === "reasoning") &&
                      part.text.length === 0 &&
                      current.text.length > 0
                    ) {
                      return [current]
                    }
                    return [part]
                  })
                  parts.push(
                    ...currentParts.filter(
                      (part) => tracker.parts.has(part.id) && !parts.some((item) => item.id === part.id),
                    ),
                  )
                  draft.part[message.info.id] = parts
                }
                for (const message of removed) delete draft.part[message.id]
                draft.message[sessionID] = visible
                draft.session_diff[sessionID] = diff.data ?? []
              }),
            )
            fullSyncedSessions.add(sessionID)
          })().finally(() => {
            syncingSessions.delete(sessionID)
            hydratingSessions.delete(sessionID)
          })
          syncingSessions.set(sessionID, task)
          return task
        },
        evict, // kilocode_change
      },
      bootstrap,
    }
    return result
  },
})
