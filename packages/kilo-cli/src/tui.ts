import { OpenCode } from "@opencode-ai/client"
import { Service, type Endpoint } from "@opencode-ai/client/effect/service"
import { run, type TuiInput } from "@opencode-ai/tui"
import { Global } from "@opencode-ai/util/global"
import { createCliRenderer } from "@opentui/core"
import { Effect } from "effect"
import path from "node:path"
import manifest from "../package.json"
import type { Layout } from "./paths"
import { createTuiConfig } from "./tui-config"
import { sessionEpilogue } from "./tui-plugin/epilogue"
import { createModelPicker } from "./model-picker"

const rendererListenerBudget = 32

export function runTui(
  input: Layout,
  endpoint: Endpoint,
  options: { args?: TuiInput["args"]; terminalHandoff?: TuiInput["terminalHandoff"] } = {},
) {
  const config = createTuiConfig(input, {
    plugins: [
      {
        package: "kilo.preview",
        options: {
          kiloHttp: { baseUrl: endpoint.url, headers: Object.fromEntries(new Headers(Service.headers(endpoint))) },
        },
      },
    ],
    session: { terminal: false },
    attention: { enabled: false },
    terminal: { title: false },
  })
  const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
  return Effect.gen(function* () {
    yield* Effect.promise((signal) =>
      client.plugin.awaitActivation({ location: { directory: process.cwd() } }, { signal }),
    )
    const handoff = options.terminalHandoff ? yield* Effect.promise(options.terminalHandoff) : undefined
    const terminal = handoff ?? (yield* nativeTerminal())
    const limit = terminal.renderer.getMaxListeners()
    if (limit > 0 && limit < rendererListenerBudget) terminal.renderer.setMaxListeners(rendererListenerBudget)
    yield* run({
      app: {
        name: "kilo2",
        version: manifest.version,
        channel: input.channel,
        sessionEpilogue,
        modelPicker: createModelPicker(client),
      },
      server: { endpoint },
      args: options.args ?? {},
      config,
      packages: {
        prepare: async (spec) => {
          if (spec !== "kilo.preview") throw new Error(`Unapproved preview UI package: ${spec}`)
          return { directory: path.join(import.meta.dir, "tui-plugin") }
        },
      },
      pluginDirectories: [],
      terminalHandoff: async () => terminal,
    })
  }).pipe(Effect.provide(Global.layerWith(input.paths)))
}

export function parseTuiArgs(args: string[]): {
  directory?: string
  sessionID?: string
  sandbox?: boolean
  swarm?: boolean
  projectConfig?: boolean
  indexingConfig?: string
} {
  if (args[0] === "--sandbox") return { ...parseTuiArgs(args.slice(1)), sandbox: true }
  if (args[0] === "--swarm") return { ...parseTuiArgs(args.slice(1)), swarm: true }
  if (args[0] === "--project-config") return { ...parseTuiArgs(args.slice(1)), projectConfig: true }
  if (args[0] === "--indexing-config") {
    if (!args[1]?.trim() || args[1].startsWith("-") || URL.canParse(args[1]))
      throw new Error("--indexing-config requires an explicit local configuration file")
    return { ...parseTuiArgs(args.slice(2)), indexingConfig: path.resolve(args[1]) }
  }
  if (!args.length) return {}
  if (args[0] === "-s" || args[0] === "--session") {
    if (args.length !== 2 || !args[1]) throw new Error("Usage: kilo2 [-s session-id] [project-directory]")
    return { sessionID: args[1] }
  }
  if (args.length === 1 && !args[0].startsWith("-")) return { directory: args[0] }
  throw new Error("Usage: kilo2 [-s session-id] [project-directory]")
}

function nativeTerminal() {
  return Effect.gen(function* () {
    const renderer = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () =>
          createCliRenderer({
            externalOutputMode: "passthrough",
            targetFps: 60,
            gatherStats: false,
            exitOnCtrlC: false,
            useKittyKeyboard: {},
            autoFocus: false,
            openConsoleOnError: false,
            consoleOptions: { keyBindings: [{ name: "y", ctrl: true, action: "copy-selection" }] },
          }),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
      (renderer) =>
        Effect.sync(() => {
          if (!renderer.isDestroyed) renderer.destroy()
        }),
    )
    const mode = (yield* Effect.promise(() => renderer.waitForThemeMode(1000))) ?? "dark"
    return { renderer, mode, complete() {} }
  })
}
