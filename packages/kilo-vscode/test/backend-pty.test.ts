import { expect, test } from "bun:test"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import type { Layout } from "../../kilo-cli/src/paths"
import { launch } from "../../kilo-cli/src/interactive-server"
import { connectV2 } from "../src/connection"
import type { KiloClient } from "../src/backend/index"
import { createNativePtyMethods, createPtyMethods } from "../src/backend/pty"
import { ScriptTerminalManager, type ScriptTerminalView } from "../src/agent-manager/ScriptTerminalManager"

function makeLayout(root: string): Layout {
  const paths = {
    home: os.homedir(),
    data: path.join(root, "data"),
    config: path.join(root, "config"),
    cache: path.join(root, "cache"),
    state: path.join(root, "state"),
    tmp: path.join(root, "tmp"),
    bin: path.join(root, "cache", "bin"),
    log: path.join(root, "data", "log"),
    repos: path.join(root, "data", "repos"),
  }
  return {
    channel: "interactive",
    paths,
    roots: [paths.data, paths.cache, paths.config, paths.state, paths.tmp],
    database: path.join(paths.data, "kilo2.db"),
    config: path.join(paths.config, "kilo.jsonc"),
    tuiConfig: path.join(paths.config, "tui.json"),
    telemetryConfig: path.join(paths.config, "telemetry.json"),
    password: path.join(paths.state, "server.password"),
    pty: path.join(paths.tmp, "pty"),
  }
}

test("pty adapter maps original create/update/remove and mints scoped connect tickets", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "kilo-pty-adapter-"))
  const created = await mkdtemp(path.join(tmpdir(), "kilo2-vscode-pty-"))
  const [realProject, realRoot] = await Promise.all([realpath(project), realpath(created)])
  const layout = makeLayout(realRoot)
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, { models: false, recover: false })
          const verified = yield* Effect.promise(() => connectV2({ url: server.url, password: server.auth.password }))
          yield* Effect.promise(async () => {
            const pty = createPtyMethods(verified.client, realProject)
            const port = Number(new URL(server.url).port)

            const plain = await pty.create({ directory: realProject, title: "adapter-plain" }, { throwOnError: true })
            expect(plain.data!.id).toBeTruthy()
            expect(plain.data!.title).toBe("adapter-plain")
            expect(plain.data!.cwd).toBe(realProject)
            expect(plain.data!.status).toBe("running")
            expect(plain.data!.pid).toBeGreaterThan(0)

            // v1 callers size the terminal at create; the adapter must land the viewport.
            const sized = await pty.create(
              { directory: realProject, title: "adapter-sized", size: { cols: 120, rows: 40 } },
              { throwOnError: true },
            )
            expect(sized.data!.id).toBeTruthy()
            expect(sized.data!.id).not.toBe(plain.data!.id)

            const resized = await pty.update(
              { directory: realProject, ptyID: sized.data!.id, size: { cols: 80, rows: 24 } },
              { throwOnError: true },
            )
            expect(resized.data!.id).toBe(sized.data!.id)

            const token = await pty.connect.token(
              { directory: realProject, ptyID: sized.data!.id },
              { throwOnError: true },
            )
            expect(token.data!.ticket.length).toBeGreaterThan(0)
            expect(token.data!.expires_in).toBeGreaterThan(0)
            expect(token.data!.directory).toBe(realProject)

            // The ticket is single-use and scope-bound: the connect URL carries the same
            // location[directory] the token was minted with, or the server refuses it.
            const params = new URLSearchParams()
            params.set("ticket", token.data!.ticket)
            params.set("location[directory]", realProject)
            const wsUrl = `ws://127.0.0.1:${port}/api/pty/${encodeURIComponent(sized.data!.id)}/connect?${params}`
            const received: string[] = []
            const gotOutput = Promise.withResolvers<void>()
            const failed = Promise.withResolvers<never>()
            const ws = new WebSocket(wsUrl)
            ws.onmessage = (event) => {
              const text = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer)
              received.push(text)
              if (text.includes("kilo-pty-adapter-echo")) gotOutput.resolve()
            }
            ws.onerror = () => failed.reject(new Error("PTY websocket failed to connect"))
            const outputOrFailure = Promise.race([gotOutput.promise, failed.promise, Bun.sleep(15_000).then(() => {
              throw new Error(`PTY echo never arrived; received ${JSON.stringify(received).slice(0, 2000)}`)
            })])
            await new Promise<void>((resolveOpen, rejectOpen) => {
              ws.onopen = () => resolveOpen()
              ws.onerror = (error) => rejectOpen(error)
            })
            ws.send("echo kilo-pty-adapter-echo\n")
            await outputOrFailure
            ws.close()

            const removed = await pty.remove({ directory: realProject, ptyID: sized.data!.id }, { throwOnError: true })
            expect(removed.data).toBeUndefined()

            // A removed PTY mints no ticket: the native NotFound arrives as the error envelope.
            const gone = await pty.connect.token({ directory: realProject, ptyID: sized.data!.id })
            expect(gone.error).toBeDefined()
            expect(gone.data).toBeUndefined()
          })
        }),
      ),
    )
  } finally {
    await rm(created, { recursive: true, force: true })
    await rm(project, { recursive: true, force: true })
  }
})

test("sandboxed host refuses pty creates through the error envelope", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "kilo-pty-sandbox-"))
  const created = await mkdtemp(path.join(tmpdir(), "kilo2-vscode-pty-sandbox-"))
  const [realProject, realRoot] = await Promise.all([realpath(project), realpath(created)])
  const layout = makeLayout(realRoot)
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, {
            models: false,
            recover: false,
            sandbox: { enabled: true, root: realProject },
          })
          const verified = yield* Effect.promise(() => connectV2({ url: server.url, password: server.auth.password }))
          yield* Effect.promise(async () => {
            const pty = createPtyMethods(verified.client, realProject)
            const refused = await pty.create({ directory: realProject, title: "adapter-refused" })
            expect(refused.error).toBeDefined()
            expect(refused.data).toBeUndefined()
          })
        }),
      ),
    )
  } finally {
    await rm(created, { recursive: true, force: true })
    await rm(project, { recursive: true, force: true })
  }
})

test("native-shape factory preserves the Location response envelope for script callers", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "kilo-pty-native-"))
  const created = await mkdtemp(path.join(tmpdir(), "kilo2-vscode-pty-native-"))
  const [realProject, realRoot] = await Promise.all([realpath(project), realpath(created)])
  const layout = makeLayout(realRoot)
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, { models: false, recover: false })
          const verified = yield* Effect.promise(() => connectV2({ url: server.url, password: server.auth.password }))
          yield* Effect.promise(async () => {
            const pty = createNativePtyMethods(verified.client, realProject)

            const created = await pty.create(
              {
                location: { directory: realProject },
                command: "/bin/sh",
                args: ["-c", "echo kilo-native-shape; exit 7"],
                cwd: realProject,
                title: "script-7",
              },
              { throwOnError: true },
            )
            expect(created.data!.location.directory).toBe(realProject)
            expect(created.data!.data.title).toBe("script-7")
            expect(created.data!.data.cwd).toBe(realProject)
            expect(created.data!.data.status).toBe("running")
            const ptyID = created.data!.data.id

            const read = await pty.get({ ptyID, location: { directory: realProject } }, { throwOnError: true })
            expect(read.data!.data.id).toBe(ptyID)

            const resized = await pty.update(
              { ptyID, location: { directory: realProject }, size: { cols: 100, rows: 30 } },
              { throwOnError: true },
            )
            expect(resized.data!.data.id).toBe(ptyID)

            const removed = await pty.remove({ ptyID, location: { directory: realProject } }, { throwOnError: true })
            expect(removed.data).toBeUndefined()
            const gone = await pty.get({ ptyID, location: { directory: realProject } })
            expect(gone.error).toBeDefined()
            expect(gone.data).toBeUndefined()
          })
        }),
      ),
    )
  } finally {
    await rm(created, { recursive: true, force: true })
    await rm(project, { recursive: true, force: true })
  }
})

test("script terminal manager drives a real script execute/exit/get/remove lifecycle", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "kilo-pty-script-"))
  const created = await mkdtemp(path.join(tmpdir(), "kilo2-vscode-pty-script-"))
  const [realProject, realRoot] = await Promise.all([realpath(project), realpath(created)])
  const layout = makeLayout(realRoot)
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, { models: false, recover: false })
          const verified = yield* Effect.promise(() => connectV2({ url: server.url, password: server.auth.password }))
          const port = Number(new URL(server.url).port)
          yield* Effect.promise(async () => {
            const native = createNativePtyMethods(verified.client, realProject)
            const adapter = createPtyMethods(verified.client, realProject)
            const client = { v2: { pty: native } } as unknown as KiloClient

            const views: Array<ScriptTerminalView> = []
            const exits: Array<{ exitCode?: number; stopped?: boolean; error?: string }> = []
            let mintedPtyID = ""
            const manager = new ScriptTerminalManager({
              getClient: () => client,
              getClientAsync: async () => client,
              connection: {
                terminalUrl: async (ptyID, cwd) => {
                  mintedPtyID = ptyID
                  const minted = await adapter.connect.token({ directory: cwd, ptyID }, { throwOnError: true })
                  const params = new URLSearchParams()
                  params.set("ticket", minted.data!.ticket)
                  params.set("location[directory]", minted.data!.directory)
                  params.set("cursor", "0")
                  return `ws://127.0.0.1:${port}/api/pty/${encodeURIComponent(ptyID)}/connect?${params}`
                },
              },
              getTerminalFont: () => ({ fontFamily: "monospace", fontSize: 12 }),
              emit: (terminals) => views.push(...terminals),
              closed: () => {},
              log: () => {},
            })

            const exits$ = Promise.withResolvers<{ exitCode?: number; stopped?: boolean; error?: string }>()
            const handle = await manager.start(
              "run",
              { worktreeId: "local", command: "/bin/sh", args: [], cwd: realProject, env: {} },
              (exit) => {
                exits.push(exit)
                exits$.resolve(exit)
              },
            )
            const view = views.at(-1)!
            expect(view.state).toBe("running")
            expect(view.title).toBe("Run")
            expect(view.wsUrl).toContain("ticket=")
            expect(view.wsUrl).toContain(`location%5Bdirectory%5D=${encodeURIComponent(realProject)}`)
            expect(mintedPtyID).toBeTruthy()

            // Real WS attach over the minted ticket: the interactive shell streams output.
            const received: string[] = []
            const gotOutput = Promise.withResolvers<void>()
            const ws = new WebSocket(view.wsUrl)
            ws.onmessage = (event) => {
              const text =
                typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer)
              received.push(text)
              if (text.includes("kilo-script-terminal-exec")) gotOutput.resolve()
            }
            await new Promise<void>((resolveOpen, rejectOpen) => {
              ws.onopen = () => resolveOpen()
              ws.onerror = () => rejectOpen(new Error("script terminal websocket failed to connect"))
            })
            ws.send("echo kilo-script-terminal-exec\n")
            await Promise.race([
              gotOutput.promise,
              Bun.sleep(10_000).then(() => {
                throw new Error(`script output never arrived; received ${JSON.stringify(received).slice(0, 2000)}`)
              }),
            ])
            ws.send("exit 7\n")
            ws.close()

            // The shell exits: the native get observes the durable exit code, and the
            // manager's event path finishes the entry with it.
            const deadline = Date.now() + 10_000
            let exitCode: number | undefined
            while (Date.now() < deadline) {
              const state = await native.get({ ptyID: mintedPtyID, location: { directory: realProject } }, {
                throwOnError: true,
              })
              if (state.data!.data.status === "exited") {
                exitCode = state.data!.data.exitCode
                break
              }
              await Bun.sleep(200)
            }
            expect(exitCode).toBe(7)
            manager.exited(mintedPtyID, 7)
            const exit = await Promise.race([
              exits$.promise,
              Bun.sleep(5_000).then(() => {
                throw new Error("manager never reported the script exit")
              }),
            ])
            expect(exit.exitCode).toBe(7)
            expect(views.at(-1)!.state).toBe("exited")
            expect(handle).toBeDefined()

            // Forced close removes the retained record and the backend PTY.
            await manager.close(view.terminalId, true)
            const gone = await native.get({ ptyID: mintedPtyID, location: { directory: realProject } })
            expect(gone.error).toBeDefined()
          })
        }),
      ),
    )
  } finally {
    await rm(created, { recursive: true, force: true })
    await rm(project, { recursive: true, force: true })
  }
}, 30_000)
