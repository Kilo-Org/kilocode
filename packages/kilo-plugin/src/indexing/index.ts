import path from "path"
import { KiloModels, KiloServer } from "@kilocode/gateway-core"
import type { IndexingConfig } from "@kilocode/kilo-indexing/config"
import { EMPTY_KILO_EMBEDDING_MODEL_CATALOG } from "@kilocode/kilo-indexing/embedding-models"
import { Config } from "@opencode/core/config"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { define } from "@opencode/plugin/effect/plugin"
import { KiloIndexingRpc } from "@opencode/schema/kilocode/indexing"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Npm } from "@opencode/util/npm"
import { Effect, Option, Stream, type Scope } from "effect"
import { KiloGatewayAccounts } from "../gateway/accounts"
import { hasKiloIndexingAuth, resolveKiloIndexingAuth } from "./indexing-auth"
import { ensure } from "./lancedb"
import { primaryWorktree } from "./primary-worktree"
import { IndexingRuntime } from "./runtime"
import { hint, semanticSearch } from "./semantic-search"
import { make as settingsFiles } from "./settings"
import { wasmDirectory } from "./tree-sitter"

// The codebase indexing plugin: one engine per Location in the indexing worker, the
// `kilocode.indexing` RPC (status, warnings, VS Code consent, status and warning events) and the `semantic_search`
// tool. The `indexing` config key comes from the Location config; the `kilo` embedder uses the Gateway account.
export const KiloIndexingPlugin = define<FSUtil.Service | Global.Service | Scope.Scope>({
  id: "kilocode.indexing",
  effect: Effect.fn("KiloIndexingPlugin")(function* (ctx) {
    const global = yield* Global.Service
    const config = yield* Effect.serviceOption(Config.Service)
    const npm = yield* Effect.serviceOption(Npm.Service)
    const run = Effect.runForkWith(yield* Effect.context<never>())
    const directory = ctx.location.directory
    const platform = process.env.KILO_PLATFORM
    const emit: { status?: (status: KiloIndexingRpc.Status) => Promise<void>; warning?: (w: KiloIndexingRpc.Warning) => void } = {}
    const state = { enabled: undefined as boolean | undefined, visible: false, key: "" }

    const indexing = Effect.fn("KiloIndexingPlugin.indexing")(function* () {
      if (Option.isNone(config)) return undefined
      return KiloConfigPolicy.indexingConfig(yield* config.value.entries()) as IndexingConfig | undefined
    })

    // The Gateway plugin registers the account reader after its first catalog load; wait for it on a cold start.
    const account = async () => {
      const deadline = Date.now() + 30_000
      while (!KiloGatewayAccounts.registered(directory) && Date.now() < deadline) await Bun.sleep(50)
      return KiloGatewayAccounts.get(directory)
    }

    const log = (level: "debug" | "info" | "warn" | "error", message: string, extra?: Record<string, unknown>) => {
      const effect =
        level === "error"
          ? Effect.logError(message)
          : level === "warn"
            ? Effect.logWarning(message)
            : level === "info"
              ? Effect.logInfo(message)
              : Effect.logDebug(message)
      run(effect.pipe(Effect.annotateLogs({ service: "kilocode-indexing", ...extra })))
    }

    const visible = () => (platform === "vscode" ? runtime.consented() : (state.enabled ?? runtime.ready()))
    const refreshTools = () => {
      const next = visible()
      if (next === state.visible) return
      state.visible = next
      run(ctx.tool.reload())
    }

    // The indexing worker reads the grammar directory from the environment when it starts.
    const wasm = wasmDirectory()
    if (wasm) process.env.KILO_TREE_SITTER_WASM_DIR = wasm

    const files = yield* settingsFiles({ global: global.config, project: directory })
    const accountAuth = (current: Awaited<ReturnType<typeof account>>) =>
      current ? { type: "oauth", access: current.token, accountId: current.organizationID ?? undefined } : undefined

    const runtime = new IndexingRuntime.Runtime({
      directory,
      home: global.home,
      root: path.join(global.state, "indexing"),
      config: async () => {
        const cfg = await Effect.runPromise(indexing())
        state.enabled = cfg?.enabled
        return cfg
      },
      auth: async () => {
        const [cfg, current] = await Promise.all([Effect.runPromise(indexing()), account()])
        const auth = resolveKiloIndexingAuth({ config: { indexing: cfg }, auth: accountAuth(current), env: {} })
        return { ...auth, baseUrl: auth.baseUrl ?? (current ? current.server : undefined) }
      },
      catalog: (auth) =>
        Effect.runPromise(
          KiloModels.embeddingModels({
            server: auth.baseUrl ?? KiloGatewayAccounts.get(directory)?.baseURL ?? KiloServer.aiGatewayFromEnv(),
            version: ctx.app.version,
          }).pipe(
            Effect.map((catalog) => ({
              defaultModel: catalog.defaultModel,
              models: catalog.models.map((item) => ({ ...item })),
              aliases: { ...catalog.aliases },
            })),
            Effect.orElseSucceed(() => EMPTY_KILO_EMBEDDING_MODEL_CATALOG),
          ),
        ),
      lancedb: (store) => Effect.runPromise(ensure(store, Option.getOrUndefined(npm))),
      primary: (dir) => Effect.runPromise(primaryWorktree(dir)),
      publish: async (status) => {
        refreshTools()
        await emit.status?.(status)
      },
      warning: (item) => emit.warning?.(item),
      log,
    })

    const registration = yield* ctx.rpc
      .register(KiloIndexingRpc.Definition, {
        status: () => Effect.promise(() => runtime.current()),
        warnings: () => Effect.promise(() => runtime.warnings()),
        consent: (input) =>
          Effect.promise(async () => {
            await runtime.consent(input.enabled)
            refreshTools()
            return runtime.current()
          }),
        config: () =>
          Effect.gen(function* () {
            const effective = yield* indexing()
            return {
              global: yield* files.read("global").pipe(Effect.orElseSucceed(() => ({}))),
              project: yield* files.read("project").pipe(Effect.orElseSucceed(() => ({}))),
              kilo: hasKiloIndexingAuth({
                config: { indexing: effective },
                auth: accountAuth(KiloGatewayAccounts.get(directory)),
                env: {},
              }),
            }
          }),
        "config.update": (input, context) =>
          files
            .write(input.scope, input.config)
            .pipe(Effect.as({}), Effect.mapError((error) => context.error("write_failed", error.message))),
      })
      .pipe(Effect.orDie)
    emit.status = (status) => Effect.runPromise(registration.events.emit("status", { status }).pipe(Effect.ignore))
    emit.warning = (item) => run(registration.events.emit("warning", item).pipe(Effect.ignore))

    const tool = semanticSearch({
      directory,
      assert: (input) => ctx.permission.assert(input),
      search: (query, prefix) => runtime.search(query, prefix),
      current: () => runtime.current(),
    })
    const initial = yield* indexing()
    state.key = JSON.stringify(initial)
    state.enabled = initial?.enabled
    state.visible = visible()
    // The tool is offered while indexing is enabled for the Location (VS Code: while
    // the project has consent), and glob and grep then point to it.
    yield* ctx.tool.transform((editor) => {
      if (!state.visible) return
      editor.add(tool)
      for (const id of ["glob", "grep"])
        editor.update(id, (item) => {
          item.description = `${item.description}\n${hint}`
        })
    })

    yield* Effect.addFinalizer(() => Effect.promise(() => runtime.dispose()))

    yield* Effect.promise(() => runtime.init()).pipe(Effect.forkScoped)

    // A changed `indexing` key restarts the engine with the new settings.
    yield* ctx.event.subscribe({ types: ["config.updated"] }).pipe(
      Stream.runForEach(() =>
        Effect.gen(function* () {
          const key = JSON.stringify(yield* indexing())
          if (key === state.key) return
          state.key = key
          yield* Effect.promise(() => runtime.restart())
          refreshTools()
        }),
      ),
      Effect.ignore,
      Effect.forkScoped,
    )
  }),
})
