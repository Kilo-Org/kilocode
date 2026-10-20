#!/usr/bin/env bun

// The Kilo host entry (U-E0-01, #15172). Mirror of packages/cli/src/index.ts (v2.0.30): the same layers and the
// upstream command handlers, with Kilo's composition added: KILO_* environment translation and the `kilo2` app
// directory (./env, imported first), Kilo's app name, and a serve handler (./serve) that gives the server the Kilo
// plugins and service overrides (./host). Every server the CLI starts (background service, standalone, stdio) runs this entry with `serve`.
// Keep it in step with the upstream file; the differences are marked "Kilo:".
import "./env"
import { ensurePluginRuntime } from "@opencode/plugin/runtime"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Cause, Effect } from "effect"
import { getErrorReported } from "effect/Runtime"
import { Commands } from "@opencode/cli/commands/commands"
import { Runtime } from "@opencode/cli/framework/runtime"
import { Observability } from "@opencode/util/observability"
import { Updater } from "@opencode/cli/services/updater"
import { OPENCODE_CHANNEL, OPENCODE_LOCAL, OPENCODE_VERSION } from "@opencode/cli/version"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { Config } from "@opencode/cli/config/index"
import { Npm } from "@opencode/util/npm"
import { EffectFlock } from "@opencode/util/effect-flock"
import { Heap } from "@opencode/cli/heap"
import { CpuProfile } from "@opencode/cli/cpu-profile"
import { KiloApp } from "./app"

ensurePluginRuntime()

if (process.env.OPENCODE_SSH_ASKPASS_PORT) {
  const { askpass } = await import("@opencode/cli/ssh-askpass")
  process.exit(await Effect.runPromise(askpass.pipe(Effect.provide(NodeServices.layer))))
}

const Handlers = Runtime.handlers(Commands, {
  $: () => import("@opencode/cli/commands/handlers/default"),
  upgrade: () => import("@opencode/cli/commands/handlers/upgrade"),
  uninstall: () => import("@opencode/cli/commands/handlers/uninstall"),
  acp: () => import("@opencode/cli/commands/handlers/acp"),
  api: () => import("@opencode/cli/commands/handlers/api"),
  auth: {
    list: () => import("@opencode/cli/commands/handlers/auth/list"),
    login: () => import("@opencode/cli/commands/handlers/auth/login"),
    logout: () => import("@opencode/cli/commands/handlers/auth/logout"),
    export: () => import("@opencode/cli/commands/handlers/auth/export"),
    import: () => import("@opencode/cli/commands/handlers/auth/import"),
    switch: () => import("@opencode/cli/commands/handlers/auth/switch"),
  },
  debug: {
    agents: () => import("@opencode/cli/commands/handlers/debug/agents"),
    config: () => import("@opencode/cli/commands/handlers/debug/config"),
    paths: () => import("@opencode/cli/commands/handlers/debug/paths"),
  },
  mcp: {
    list: () => import("@opencode/cli/commands/handlers/mcp/list"),
    add: () => import("@opencode/cli/commands/handlers/mcp/add"),
    auth: () => import("@opencode/cli/commands/handlers/mcp/auth"),
    logout: () => import("@opencode/cli/commands/handlers/mcp/logout"),
  },
  plugin: {
    list: () => import("@opencode/cli/commands/handlers/plugin/list"),
    add: () => import("@opencode/cli/commands/handlers/plugin/add"),
    check: () => import("@opencode/cli/commands/handlers/plugin/check"),
    update: () => import("@opencode/cli/commands/handlers/plugin/update"),
    remove: () => import("@opencode/cli/commands/handlers/plugin/remove"),
  },
  models: () => import("@opencode/cli/commands/handlers/models"),
  stats: () => import("@opencode/cli/commands/handlers/stats"),
  mini: () => import("@opencode/cli/commands/handlers/mini"),
  run: () => import("@opencode/cli/commands/handlers/run"),
  pair: () => import("@opencode/cli/commands/handlers/pair"),
  reload: () => import("@opencode/cli/commands/handlers/reload"),
  session: {
    list: () => import("@opencode/cli/commands/handlers/session/list"),
    delete: () => import("@opencode/cli/commands/handlers/session/delete"),
    export: () => import("@opencode/cli/commands/handlers/session/export"),
    import: () => import("@opencode/cli/commands/handlers/session/import"),
  },
  service: {
    start: () => import("@opencode/cli/commands/handlers/service/start"),
    restart: () => import("@opencode/cli/commands/handlers/service/restart"),
    status: () => import("@opencode/cli/commands/handlers/service/status"),
    stop: () => import("@opencode/cli/commands/handlers/service/stop"),
    get: () => import("@opencode/cli/commands/handlers/service/get"),
    set: () => import("@opencode/cli/commands/handlers/service/set"),
    unset: () => import("@opencode/cli/commands/handlers/service/unset"),
  },
  // Kilo: the server gets the Kilo plugins and service overrides.
  serve: () => import("./serve"),
})

Effect.gen(function* () {
  yield* Heap.listen
  yield* CpuProfile.listen
  const runFork = Effect.runForkWith(yield* Effect.context<never>())
  const uncaughtException = (cause: Error, origin: "uncaughtException" | "unhandledRejection") => {
    runFork(Effect.logError("uncaught exception", { cause, origin }))
  }
  const unhandledRejection = (cause: unknown) => {
    runFork(Effect.logError("unhandled rejection", { cause }))
  }
  process.on("uncaughtException", uncaughtException)
  process.on("unhandledRejection", unhandledRejection)
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      process.off("uncaughtException", uncaughtException)
      process.off("unhandledRejection", unhandledRejection)
    }),
  )
  yield* Effect.logInfo("cli starting", {
    version: OPENCODE_VERSION,
    channel: OPENCODE_CHANNEL,
    local: OPENCODE_LOCAL,
    args: process.argv.slice(2),
  })
  return yield* Runtime.run(Commands, Handlers, { version: OPENCODE_VERSION })
}).pipe(
  Effect.catchCause((cause) =>
    Effect.logError("cli process failed", {
      cause,
      args: process.argv.slice(2),
    }).pipe(Effect.andThen(Effect.failCause(cause))),
  ),
  Effect.annotateLogs({ role: "cli" }),
  Effect.provide(Config.layer),
  Effect.provide(Updater.layer),
  Effect.provide(
    LayerNode.compile(LayerNode.group([Global.node, AppProcess.node, Npm.node, EffectFlock.node]), {
      replacements: [
        // Kilo: KILO_CONFIG_DIR reaches OPENCODE_CONFIG_DIR through ./env, which also names Kilo's `kilo2` app
        // directory before the global paths load (U-E1-01).
        Global.node.replace(
          Global.layerWith(process.env.OPENCODE_CONFIG_DIR ? { config: process.env.OPENCODE_CONFIG_DIR } : {}),
        ),
      ],
    }),
  ),
  Effect.provide(
    Observability.layer({
      endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      headers: process.env.OTEL_EXPORTER_OTLP_HEADERS,
      // Kilo: Kilo's app name instead of the upstream artifact name.
      client: KiloApp.name,
      version: OPENCODE_VERSION,
      channel: OPENCODE_CHANNEL,
    }),
  ),
  Effect.provide(NodeServices.layer),
  Effect.scoped,
  Effect.tap(() => Effect.sync(() => process.exit(process.exitCode ?? 0))),
  // runMain's default reporter logs the fatal cause to stdout. Write it to stderr instead: the
  // desktop and `Service.ensure` only capture stderr from `serve --service`, so this is the only
  // channel through which a startup failure's reason reaches the user.
  Effect.tapCause((cause) =>
    Effect.sync(() => {
      if (Cause.hasInterruptsOnly(cause)) return
      if (!getErrorReported(Cause.squash(cause))) return
      process.stderr.write(Cause.pretty(cause) + "\n")
    }),
  ),
  NodeRuntime.runMain({ disableErrorReporting: true }),
)
