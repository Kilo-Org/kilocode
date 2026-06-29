// kilocode_change - new file
import { CodebaseSearchTool } from "../../tool/warpgrep"
import { RecallTool } from "../../tool/recall"
import { AgentManagerModelsTool } from "./agent-manager-models"
import { AgentManagerTool } from "./agent-manager"
import { BackgroundProcessTool } from "./background-process"
import { NotebookEditTool, NotebookExecuteTool, NotebookReadTool } from "./notebook-host"
import * as Tool from "../../tool/tool"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Effect } from "effect"
import { Notebook } from "@/kilocode/notebook/service"
import * as Log from "@opencode-ai/core/util/log"
import { Agent } from "@/agent/agent"
import * as Truncate from "@/tool/truncate"
import type { Config } from "@/config/config"

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

  /** Resolve Kilo-specific tool Infos outside any InstanceState, so their Truncate/Agent deps are
   * satisfied at the outer registry scope instead of leaking into InstanceState's Effect. */
  export function infos(notebook?: Notebook.Interface) {
    return Effect.gen(function* () {
      const codebase = yield* CodebaseSearchTool
      const recall = yield* RecallTool
      const managerModels = yield* AgentManagerModelsTool
      const manager = yield* AgentManagerTool
      const process = yield* BackgroundProcessTool
      if (!notebook) return { codebase, recall, managerModels, manager, process }
      const tools = yield* Effect.all({
        notebookRead: NotebookReadTool,
        notebookEdit: NotebookEditTool,
        notebookExecute: NotebookExecuteTool,
      }).pipe(Effect.provideService(Notebook.Service, notebook))
      return { codebase, recall, managerModels, manager, process, ...tools }
    })
  }

  /** Finalize Kilo-specific tools into Tool.Defs. Call this inside the InstanceState state Effect —
   * it has no Service deps beyond what Tool.init itself needs. */
  export function build(
    tools: {
      codebase: Tool.Info
      recall: Tool.Info
      managerModels: Tool.Info
      manager: Tool.Info
      process: Tool.Info
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
        manager: Tool.init(tools.manager),
        process: Tool.init(tools.process),
      })
      const notebooks =
        tools.notebookRead && tools.notebookEdit && tools.notebookExecute
          ? yield* Effect.all({
              notebookRead: Tool.init(tools.notebookRead),
              notebookEdit: Tool.init(tools.notebookEdit),
              notebookExecute: Tool.init(tools.notebookExecute),
            })
          : {}
      const semantic = yield* semanticTool(deps, loaders)
      return { ...base, ...notebooks, semantic }
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

  /** Kilo-specific tools to append to the builtin list */
  export function extra(
    tools: {
      codebase: Tool.Def
      semantic?: Tool.Def
      recall: Tool.Def
      managerModels: Tool.Def
      manager: Tool.Def
      process: Tool.Def
      notebookRead?: Tool.Def
      notebookEdit?: Tool.Def
      notebookExecute?: Tool.Def
    },
    cfg: { experimental?: { codebase_search?: boolean; native_notebook_tools?: boolean } },
  ): Tool.Def[] {
    return [
      ...(cfg.experimental?.codebase_search === true ? [tools.codebase] : []),
      ...(tools.semantic ? [tools.semantic] : []),
      tools.recall,
      ...(Flag.KILO_CLIENT === "cli" || Flag.KILO_CLIENT === "vscode" ? [tools.process] : []),
      // Agent Manager tools are useful only when the extension can create and display their sessions.
      ...(Flag.KILO_CLIENT === "vscode" ? [tools.managerModels, tools.manager] : []),
      ...(Flag.KILO_CLIENT === "vscode" &&
      cfg.experimental?.native_notebook_tools === true &&
      tools.notebookRead &&
      tools.notebookEdit &&
      tools.notebookExecute
        ? [tools.notebookRead, tools.notebookEdit, tools.notebookExecute]
        : []),
    ]
  }

  export function describe(tools: Tool.Def[], extra: { semantic?: Tool.Def }): Tool.Def[] {
    if (!extra.semantic) return tools
    return tools.map((tool) => {
      if (tool.id !== "glob" && tool.id !== "grep") return tool
      return { ...tool, description: `${tool.description}\n${hint}` }
    })
  }
}
