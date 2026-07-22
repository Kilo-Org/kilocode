import { CodebaseSearchTool } from "../../tool/warpgrep"
import { RecallTool } from "../../tool/recall"
import { AgentManagerModelsTool } from "./agent-manager-models"
import { AgentManagerTool } from "./agent-manager"
import { BackgroundProcessTool } from "./background-process"
import { GenerateImageTool } from "./generate-image"
import { InteractiveTerminalTool } from "./interactive-terminal"
import { NotebookEditTool, NotebookExecuteTool, NotebookReadTool } from "./notebook-host"
import { MemoryRecallTool } from "./memory-recall"
import { MemorySaveTool } from "./memory-save"
import { NotifyUserTool } from "./notify-user"
import * as Tool from "../../tool/tool"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Effect } from "effect"
import { Notebook } from "@/kilocode/notebook/service"
import { AgentManager, HostError } from "@/kilocode/agent-manager/service"
import { KiloSessions } from "@/kilo-sessions/kilo-sessions"
import * as Log from "@opencode-ai/core/util/log"
import type { Config } from "@/config/config"
import { Agent } from "@/agent/agent"
import * as Truncate from "@/tool/truncate"
import { InstanceState } from "@/effect/instance-state"
import { KiloMemory } from "@kilocode/kilo-memory/effect"
import { MemoryPaths } from "@kilocode/kilo-memory/effect/paths"

const log = Log.create({ service: "kilocode-tool-registry" })
type Deps = { agent: Agent.Interface; truncate: Truncate.Interface; indexing?: boolean }
type Loaders = {
  indexing?: () => Promise<{ KiloIndexing: { ready: () => boolean } }>
  semantic?: () => Promise<Pick<typeof import("@/kilocode/tool/semantic-search"), "SemanticSearchTool">>
}

export namespace KiloToolRegistry {
  const hint =
    "- When you are doing an open-ended search where you do not know the exact symbol name, use the `semantic_search` tool first to narrow down the search scope, then follow up with `Grep` and/or `Read`"

  export function indexing(
    config: Pick<Config.Info, "indexing">,
    global?: Pick<Config.Info, "indexing">,
  ): boolean | undefined {
    return config.indexing?.enabled ?? global?.indexing?.enabled
  }

  export function usePatch(input: { modelID: string; family?: string }) {
    if (process.env["KILO_E2E_LLM_URL"]) return true

    const id = input.modelID.toLowerCase()
    const family = input.family?.toLowerCase()
    if (id.includes("gpt-4") || family?.startsWith("gpt-4")) return false
    if (id.includes("oss") || family?.includes("oss") || family === "gpt-image") return false
    if (id.includes("gpt-")) return true
    return family?.startsWith("gpt") ?? false
  }

  /** Resolve Kilo-specific tool Infos outside any InstanceState, so their Truncate/Agent deps are
   * satisfied at the outer registry scope instead of leaking into InstanceState's Effect. */
  const unavailable = AgentManager.Service.of({
    request: () =>
      Effect.fail(
        new HostError({ code: "disconnected", detail: "Agent Manager orchestration is unavailable in this runtime" }),
      ),
    list: () => Effect.succeed([]),
    reply: () => Effect.die(new Error("Agent Manager orchestration is unavailable in this runtime")),
    reject: () => Effect.die(new Error("Agent Manager orchestration is unavailable in this runtime")),
  })

  export function infos(host?: AgentManager.Interface, notebook?: Notebook.Interface) {
    return Effect.gen(function* () {
      const codebase = yield* CodebaseSearchTool
      const recall = yield* RecallTool
      const managerModels = yield* AgentManagerModelsTool
      const memory = yield* MemoryRecallTool
      const save = yield* MemorySaveTool
      const manager = yield* AgentManagerTool.pipe(Effect.provideService(AgentManager.Service, host ?? unavailable))
      const process = yield* BackgroundProcessTool
      const image = yield* GenerateImageTool
      const terminal = yield* InteractiveTerminalTool
      // The notify_user tool depends on KiloSessions.Service, which the tool-registry layer provides
      // via KiloSessions.defaultLayer (see src/tool/registry.ts). Grabs the service from the surrounding
      // context here and injects it into the tool's init Effect.
      const sessions = yield* KiloSessions.Service
      const notify = yield* NotifyUserTool.pipe(Effect.provideService(KiloSessions.Service, sessions))
      if (!notebook)
        return { codebase, recall, managerModels, memory, save, manager, process, image, terminal, notify }
      const tools = yield* Effect.all({
        notebookRead: NotebookReadTool,
        notebookEdit: NotebookEditTool,
        notebookExecute: NotebookExecuteTool,
      }).pipe(Effect.provideService(Notebook.Service, notebook))
      return { codebase, recall, managerModels, memory, save, manager, process, image, terminal, notify, ...tools }
    })
  }

  /** Finalize Kilo-specific tools into Tool.Defs. Call this inside the InstanceState state Effect —
   * it has no Service deps beyond what Tool.init itself needs. */
  export function build(
    tools: {
      codebase: Tool.Info
      recall: Tool.Info
      managerModels: Tool.Info
      memory: Tool.Info
      save: Tool.Info
      manager: Tool.Info
      process: Tool.Info
      image: Tool.Info
      terminal?: Tool.Info
      notify: Tool.Info
      notebookRead?: Tool.Info
      notebookEdit?: Tool.Info
      notebookExecute?: Tool.Info
    },
    deps: Deps,
    loaders: Loaders = {},
  ) {
    return Effect.gen(function* () {
      const base = yield* Effect.all({
        codebase: Tool.init(tools.codebase),
        recall: Tool.init(tools.recall),
        managerModels: Tool.init(tools.managerModels),
        memory: Tool.init(tools.memory),
        save: Tool.init(tools.save),
        manager: Tool.init(tools.manager),
        process: Tool.init(tools.process),
        image: Tool.init(tools.image),
        notify: Tool.init(tools.notify),
      })
      const terminal = tools.terminal ? yield* Tool.init(tools.terminal) : undefined
      const notebooks =
        tools.notebookRead && tools.notebookEdit && tools.notebookExecute
          ? yield* Effect.all({
              notebookRead: Tool.init(tools.notebookRead),
              notebookEdit: Tool.init(tools.notebookEdit),
              notebookExecute: Tool.init(tools.notebookExecute),
            })
          : {}
      const semantic = yield* semanticTool(deps, loaders)
      return { ...base, terminal, ...notebooks, semantic, notify: base.notify }
    })
  }

  function semanticTool(deps: Deps, loaders: Loaders) {
    return Effect.gen(function* () {
      const ready = yield* deps.indexing === undefined
        ? (() => {
            const indexing = loaders.indexing ?? (() => import("@/kilocode/indexing"))
            return Effect.tryPromise(() => indexing().then((mod) => mod.KiloIndexing.ready())).pipe(
              Effect.catch((err) =>
                Effect.sync(() => {
                  log.warn("semantic search unavailable", { err })
                  return false
                }),
              ),
            )
          })()
        : Effect.succeed(deps.indexing)
      if (!ready) return undefined

      const semantic = loaders.semantic ?? (() => import("@/kilocode/tool/semantic-search"))
      const mod = yield* Effect.tryPromise(() => semantic()).pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            log.warn("semantic search tool unavailable", { err })
            return undefined
          }),
        ),
      )
      if (!mod) return undefined

      const info = yield* mod.SemanticSearchTool.pipe(
        Effect.provideService(Agent.Service, deps.agent),
        Effect.provideService(Truncate.Service, deps.truncate),
      )
      if (!info) return undefined
      return yield* Tool.init(info)
    })
  }

  /** Hide human-driven tools from agents that cannot interact with the user directly. */
  export function available(tool: Tool.Def, agent: Agent.Info) {
    if (tool.id === "notify_user") return KiloSessions.remoteStatus().enabled
    if (tool.id !== "interactive_terminal") return true
    return agent.mode === "primary"
  }

  /** Kilo-specific tools to append to the builtin list */
  export function extra(
    tools: {
      codebase: Tool.Def
      semantic?: Tool.Def
      recall: Tool.Def
      managerModels: Tool.Def
      memory: Tool.Def
      save: Tool.Def
      manager: Tool.Def
      process: Tool.Def
      image: Tool.Def
      terminal?: Tool.Def
      notify: Tool.Def
      notebookRead?: Tool.Def
      notebookEdit?: Tool.Def
      notebookExecute?: Tool.Def
    },
    cfg: { experimental?: { codebase_search?: boolean; image_generation?: boolean; native_notebook_tools?: boolean } },
  ): Tool.Def[] {
    return [
      ...(cfg.experimental?.codebase_search === true ? [tools.codebase] : []),
      ...(cfg.experimental?.image_generation === true ? [tools.image] : []),
      ...(tools.semantic ? [tools.semantic] : []),
      tools.memory,
      tools.save,
      tools.recall,
      ...(Flag.KILO_CLIENT === "cli" || Flag.KILO_CLIENT === "vscode" ? [tools.process] : []),
      ...(Flag.KILO_CLIENT === "cli" && tools.terminal ? [tools.terminal] : []),
      // Agent Manager tools are useful only when the extension can create and display their sessions.
      ...(Flag.KILO_CLIENT === "vscode" ? [tools.managerModels, tools.manager] : []),
      ...(Flag.KILO_CLIENT === "vscode" &&
      cfg.experimental?.native_notebook_tools === true &&
      tools.notebookRead &&
      tools.notebookEdit &&
      tools.notebookExecute
        ? [tools.notebookRead, tools.notebookEdit, tools.notebookExecute]
        : []),
      tools.notify,
    ]
  }

  // Re-keyed to root string so invalidate() works across ctx identities.
  const memoryEnabledCache = new Map<string, { enabled: boolean; deadline: number }>()
  const MEMORY_ENABLED_CACHE_MAX = 512
  const MEMORY_ENABLED_TTL_MS = 5_000

  /** Drop the cached enabled flag for a root so the next probe re-reads fresh state.
   * Called by the MemoryEvents subscriber in bootstrap on every state mutation. */
  export function invalidateMemoryEnabled(root: string) {
    memoryEnabledCache.delete(root)
  }

  /** Per-turn cache of `KiloMemory.toolEnabled` keyed by root string, with a short TTL so the
   * step-loop coalesces probes inside a single turn. Cache is invalidated immediately on enable /
   * disable / purge / rebuild via the MemoryEvents bus (subscribed in kilocode/bootstrap.ts). */
  export function memoryToolsEnabled(input: { ctx: MemoryPaths.Ctx }) {
    return Effect.gen(function* () {
      const root = MemoryPaths.root({ ctx: input.ctx })
      const cached = memoryEnabledCache.get(root)
      if (cached && cached.deadline > Date.now()) return cached.enabled
      const enabled = yield* Effect.tryPromise({
        try: () => KiloMemory.toolEnabled({ ctx: input.ctx }),
        catch: (err) => err,
      }).pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            log.warn("memory tools unavailable", { error: String(err) })
            return false
          }),
        ),
      )
      memoryEnabledCache.set(root, { enabled, deadline: Date.now() + MEMORY_ENABLED_TTL_MS })
      if (memoryEnabledCache.size > MEMORY_ENABLED_CACHE_MAX) {
        const oldest = memoryEnabledCache.keys().next().value
        if (oldest !== undefined) memoryEnabledCache.delete(oldest)
      }
      return enabled
    })
  }
  /** Hide Kilo memory tools from the model when project memory is disabled. */
  export const applyVisibility = Effect.fn("KiloToolRegistry.applyVisibility")(function* (tools: Tool.Def[]) {
    const ctx = yield* InstanceState.context
    const memoryEnabled = yield* memoryToolsEnabled({ ctx })
    return tools.filter((tool) => {
      if (tool.id.startsWith("kilo_memory_")) return memoryEnabled
      return true
    })
  })

  export function describe(tools: Tool.Def[], extra: { semantic?: Tool.Def }): Tool.Def[] {
    if (!extra.semantic) return tools
    return tools.map((tool) => {
      if (tool.id !== "glob" && tool.id !== "grep") return tool
      return { ...tool, description: `${tool.description}\n${hint}` }
    })
  }
}
