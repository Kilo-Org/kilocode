import path from "node:path"
import manifest from "../package.json"
import { requireRuntime } from "./runtime"

requireRuntime()

const { NodeHttpServer } = await import("@effect/platform-node")
const { Effect } = await import("effect")
const { launch } = await import("./interactive-server")
const { layout } = await import("./paths")
const { help, parseCommand, executeCommand } = await import("./commands")
const args = process.argv.slice(2)
if (args.length === 1 && args[0] === "--version") {
  console.log(`Kilo internal preview ${manifest.version}`)
  process.exit(0)
}
if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
  console.log(help)
  process.exit(0)
}
const command = parseCommand(args)
const { parseTuiArgs } = await import("./tui")
const options = command ? undefined : parseTuiArgs(args)
const directory = command && "directory" in command ? command.directory : options?.directory
if (directory) process.chdir(path.resolve(directory))

const controller = new AbortController()
const stop = (signal: string) => {
  if (command?.type === "run" || command?.type === "cloud") process.exitCode = signal === "SIGINT" ? 130 : 143
  controller.abort()
}
process.once("SIGINT", stop)
process.once("SIGTERM", stop)
try {
  // Resolve files and consume piped input before acquiring the store or creating a session.
  const prepared =
    command?.type === "run"
      ? await (async () => {
          const { prepareRunInput } = await import("./run-input")
          return prepareRunInput(command, process.stdin.isTTY ? undefined : Bun.stdin.stream(), controller.signal)
        })()
      : undefined
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const input = layout("interactive")
        if (command?.type === "external-sessions") {
          const { listExternalSessions } = yield* Effect.promise(() => import("./external-sessions"))
          console.log(JSON.stringify(yield* Effect.promise(() => listExternalSessions(command)), null, 2))
          return
        }
        if (command?.type === "telemetry") {
          const { configureTelemetry } = yield* Effect.promise(() => import("./telemetry-command"))
          console.log(JSON.stringify(yield* configureTelemetry(input, command), null, 2))
          return
        }
        const migration =
          command?.type === "import-v1"
            ? yield* Effect.promise(async () => {
                const { planV1Import } = await import("./import-v1-config")
                return planV1Import(command)
              })
            : undefined
        if (command?.type === "import-v1" && !command.apply && migration) {
          const { reportV1Import } = yield* Effect.promise(() => import("./import-v1-config"))
          console.log(JSON.stringify({ status: "preview", ...reportV1Import(migration) }, null, 2))
          return
        }
        if (command?.type === "service" || command?.type === "attach") {
          const daemon = yield* Effect.promise(() => import("./daemon"))
          if (command.type === "service") {
            if (command.action === "stop") {
              console.log(JSON.stringify(yield* Effect.promise(() => daemon.stop(input)), null, 2))
              return
            }
            if (command.action === "start") yield* Effect.promise(() => daemon.start(input))
            const state = yield* Effect.promise(() => daemon.status(input))
            // Endpoint credentials stay private even for machine-readable status output.
            console.log(
              JSON.stringify(
                state.state === "running"
                  ? {
                      state: state.state,
                      file: state.file,
                      pid: state.pid,
                      version: state.version,
                      url: state.endpoint.url,
                    }
                  : state,
                null,
                2,
              ),
            )
            return
          }
          const state = yield* Effect.promise(() => daemon.status(input))
          if (state.state !== "running") throw new Error("No healthy Kilo daemon; run kilo2 service start first")
          const { runTui } = yield* Effect.promise(() => import("./tui"))
          yield* runTui(input, state.endpoint, {
            args: command.sessionID ? { sessionID: command.sessionID } : undefined,
          })
          return
        }
        const endpoint = yield* launch(input, {
          gateway: { server: process.env.KILO_API_URL },
          persistedTelemetry: true,
          cloud: yield* Effect.promise(async () => {
            const agent = process.env.CLOUD_AGENT_NEXT_BASE_URL
            const web = process.env.KILO_WEB_APP_URL
            if (agent === undefined && web === undefined) return undefined
            const { DEFAULT_CLOUD_AGENT_ORIGIN, DEFAULT_WEB_APP_ORIGIN } = await import("./cloud/origin")
            return {
              agentOrigin: agent ?? DEFAULT_CLOUD_AGENT_ORIGIN,
              webAppOrigin: web ?? DEFAULT_WEB_APP_ORIGIN,
              allowHttpLoopback: true,
            }
          }),
          projectConfig: command && "projectConfig" in command ? command.projectConfig : options?.projectConfig,
          swarm: command && "swarm" in command ? command.swarm : options?.swarm,
          indexing: yield* Effect.promise(async () => {
            const file = command && "indexingConfig" in command ? command.indexingConfig : options?.indexingConfig
            if (!file) return undefined
            const { readIndexingConfig } = await import("./indexing-input")
            return readIndexingConfig(file)
          }),
          sandbox: (command && "sandbox" in command ? command.sandbox : options?.sandbox)
            ? { enabled: true, root: process.cwd() }
            : undefined,
          // One-shot commands must not resume unrelated interrupted work just by opening the store.
          recover: !command || command.type === "serve",
        })
        if (command) {
          if (command.type === "acp") {
            const { runAcp } = yield* Effect.promise(() => import("./acp"))
            process.exitCode = yield* Effect.uninterruptible(
              Effect.promise(() =>
                runAcp(endpoint, { signal: controller.signal, artifact: process.env.KILO_ACP_ARTIFACT }),
              ),
            )
            return
          }
          if (command.type === "serve") {
            console.log(`URL: ${endpoint.url}`)
            console.log(`Password file: ${input.password}`)
            yield* Effect.never
            return
          }
          const { OpenCode } = yield* Effect.promise(() => import("@opencode-ai/client"))
          const { Service } = yield* Effect.promise(() => import("@opencode-ai/client/effect/service"))
          const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
          if (command.type === "cloud") {
            const { executeCloudCommand } = yield* Effect.promise(() => import("./cloud-command"))
            const { createClient } = yield* Effect.promise(() => import("@kilocode/client"))
            const cloud = createClient({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
            const result = yield* Effect.promise(() => executeCloudCommand(cloud, command, controller.signal))
            console.log(JSON.stringify(result.output, null, result.stream ? undefined : 2))
            process.exitCode = result.exitCode
            if (result.stream) {
              yield* Effect.promise(async () => {
                try {
                  await result.stream?.((line) => console.log(line))
                } catch {
                  controller.signal.throwIfAborted()
                  // Never echo a transport exception: it can contain a ticket URL.
                  console.log(JSON.stringify({ streamEventType: "error", data: { message: "Cloud stream failed" } }))
                }
              })
            }
            return
          }
          if (command.type === "import-v1" && migration) {
            const { applyV1Import, reportV1Import } = yield* Effect.promise(() => import("./import-v1-config"))
            yield* Effect.promise(() => client.plugin.awaitActivation({ location: { directory: process.cwd() } }))
            const result = yield* Effect.promise(() =>
              applyV1Import({
                layout: input,
                client,
                plan: migration,
                location: { directory: process.cwd() },
                writeCredential: endpoint.importCredential,
              }),
            )
            console.log(JSON.stringify(reportV1Import(result), null, 2))
            if (result.status !== "applied") process.exitCode = 1
            return
          }
          if (command.type === "run") {
            // Let run interrupt its session before the enclosing scope closes the HTTP host.
            const { run } = yield* Effect.promise(() => import("./run"))
            const result = yield* Effect.uninterruptible(
              Effect.promise(() => run(client, { ...command, ...prepared, files: prepared?.files }, controller.signal)),
            )
            console.error(`Session: ${result.sessionID}`)
            if (command.format === "json") {
              console.log(JSON.stringify(result))
              return
            }
            process.stdout.write(result.text.endsWith("\n") ? result.text : `${result.text}\n`)
            return
          }
          const result = yield* Effect.promise(() => executeCommand(client, command, controller.signal))
          console.log(JSON.stringify(result, null, 2))
          return
        }
        const { runTui } = yield* Effect.promise(() => import("./tui"))
        yield* runTui(input, endpoint, { args: options?.sessionID ? { sessionID: options.sessionID } : undefined })
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerHttpServices)),
    { signal: controller.signal },
  )
} catch (error) {
  if (!controller.signal.aborted) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
} finally {
  process.removeListener("SIGINT", stop)
  process.removeListener("SIGTERM", stop)
}
