#!/usr/bin/env bun

// kilo_mirror: packages/cli/src/index.ts
// The Kilo host entry (U-E0-01, #15172). Mirror of packages/cli/src/index.ts (v2.2.6): the same layers and the
// upstream command handlers, with Kilo's composition added: KILO_* environment translation and the `kilo2` app
// directory (./env, imported first), Kilo's app name, and a serve handler (./serve) that gives the server the Kilo
// plugins and service overrides (./host). Every server the CLI starts (background service, standalone, stdio) runs this entry with `serve`.
// Keep it in step with the upstream file; the differences are marked "Kilo:".
import { NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { Command } from "effect/cli"
import { Commands } from "@opencode/cli/commands/commands"
import { Runtime } from "@opencode/cli/framework/runtime"
import { KiloUpdater } from "./updater"
import { KiloPluginNpm } from "./plugin-npm"
import { OPENCODE_VERSION } from "@opencode/cli/version"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { KiloCliConfig } from "./cli-config"
import { Npm } from "@opencode/util/npm"
import { EffectFlock } from "@opencode/util/effect-flock"
import { AutoCommand } from "./auto/auto"
import { ImportCommand } from "./import/import"
import { SyncCommand } from "./sync/sync"
import { RemoteCommand } from "./remote/remote"
import { KiloServiceCommands } from "./service/service"
import { KiloBrowserCommands } from "./browser/commands"

import { ensurePluginRuntime } from "./index"
import { configureLocalNoProxy, runCliProcess } from "./process-main"

configureLocalNoProxy()

ensurePluginRuntime()

if (process.env.OPENCODE_SSH_ASKPASS_PORT) {
  const { askpass } = await import("@opencode/cli/ssh-askpass")
  process.exit(await Effect.runPromise(askpass.pipe(Effect.provide(NodeServices.layer))))
}

// Kilo-owned commands alongside the upstream commands.
const KiloCommands = {
  ...Commands,
  commands: {
    ...Commands.commands,
    // Kilo: `daemon` aliases the upstream `service` group, so `daemon status|stop|restart` manage the native service.
    service: {
      ...Commands.commands.service,
      spec: Commands.commands.service.spec.pipe(Command.withAlias("daemon")),
      // Kilo: `install` and `uninstall` manage the OS login unit that starts the background server.
      commands: { ...Commands.commands.service.commands, ...KiloServiceCommands },
    },
    auto: AutoCommand,
    // Kilo: the browser bridge hub, its native messaging host install, and the Chromium the bundled Playwright
    // backend drives.
    browser: KiloBrowserCommands,
    import: ImportCommand,
    sync: SyncCommand,
    remote: RemoteCommand,
  },
}

const Handlers = Runtime.handlers(KiloCommands, {
  $: () => import("@opencode/cli/commands/handlers/default"),
  upgrade: () => import("./upgrade"),
  // Kilo: the wrapper removes the login unit before the upstream uninstall.
  uninstall: () => import("./commands/uninstall"),
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
    "heap-dump": () => import("@opencode/cli/commands/handlers/debug/heap-dump"),
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
    // Kilo: the mirror adds the scheduled-wakeup status field. kilo_port(wakeup:9d6803e786ab)
    list: () => import("./commands/session-list"),
    delete: () => import("@opencode/cli/commands/handlers/session/delete"),
    export: () => import("@opencode/cli/commands/handlers/session/export"),
    import: () => import("@opencode/cli/commands/handlers/session/import"),
  },
  service: {
    start: () => import("@opencode/cli/commands/handlers/service/start"),
    restart: () => import("@opencode/cli/commands/handlers/service/restart"),
    // Kilo: the wrapper adds the login unit state.
    status: () => import("./service/status"),
    // Kilo: the wrapper stops the login unit first, so its restart policy cannot start the server again.
    stop: () => import("./service/stop"),
    get: () => import("@opencode/cli/commands/handlers/service/get"),
    set: () => import("@opencode/cli/commands/handlers/service/set"),
    unset: () => import("@opencode/cli/commands/handlers/service/unset"),
    // Kilo: the OS login unit.
    install: () => import("./service/install"),
    uninstall: () => import("./service/uninstall"),
  },
  // Kilo: the server gets the Kilo plugins and service overrides.
  serve: () => import("./serve"),
  // Kilo: private, long-lived remote host.
  remote: () => import("./remote/headless"),
  // Kilo: workspace session synchronization.
  sync: {
    enable: () => import("./sync/enable"),
    disable: () => import("./sync/disable"),
    status: () => import("./sync/status"),
    flush: () => import("./sync/flush"),
  },
  // Kilo: manual import of an earlier Kilo installation.
  import: {
    v1: () => import("./import/v1"),
  },
  // Kilo: the browser bridge hub (started by the browser or by a CLI), the native messaging host install, and the
  // Chromium the bundled Playwright backend drives.
  browser: {
    hub: () => import("./browser/hub-command"),
    "install-host": () => import("./browser/install-host-command"),
    "install-chromium": () => import("./browser/install-chromium"),
  },
  // Kilo: custom auto routers.
  auto: {
    router: {
      list: () => import("./auto/router-list"),
      add: () => import("./auto/router-add"),
      remove: () => import("./auto/router-remove"),
    },
    eval: () => import("./auto/eval"),
  },
})

runCliProcess(
  Runtime.run(KiloCommands, Handlers, { version: OPENCODE_VERSION }).pipe(
    Effect.provide(KiloCliConfig.layer),
    Effect.provide(KiloUpdater.layer),
    Effect.provide(
      LayerNode.compile(LayerNode.group([Global.node, AppProcess.node, Npm.node, EffectFlock.node]), {
        replacements: [
          // Kilo: KILO2_CONFIG_DIR reaches OPENCODE_CONFIG_DIR through ./env, which also names Kilo's `kilo2` app
          // directory before the global paths load (U-E1-01).
          Global.node.replace(
            Global.layerWith(process.env.OPENCODE_CONFIG_DIR ? { config: process.env.OPENCODE_CONFIG_DIR } : {}),
          ),
          // Kilo: the TUI resolves configured plugin targets itself, so a `git:` spec must not reach npm there.
          Npm.node.replace(KiloPluginNpm.node),
        ],
      }),
    ),
  ),
) // Kilo: with the Kilo commands
