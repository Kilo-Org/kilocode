import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { spawn, type Exit } from "@opencode-ai/core/pty/driver"
import { sanitizedProcessEnv } from "@opencode-ai/core/util/opencode-process"
import { tmpdir } from "../../../fixture/fixture"
import {
  embeddedRemoteExitClient,
  resolveThreadDirectory,
  runEmbeddedRemoteExitBridge,
} from "../../../../src/cli/cmd/tui"
import { preload } from "../../../../src/kilocode/cli/cmd/tui"
import { KiloTuiThreadDaemon } from "../../../../src/kilocode/cli/cmd/tui/thread"
import { DaemonClient } from "../../../../src/kilocode/daemon/client"

afterEach(() => {
  mock.restore()
})

describe("kilo tui thread", () => {
  test("skips preload resolver invocation in compiled mode", () => {
    let calls = 0

    expect(
      preload(true, () => {
        calls++
        return "/resolved/preload"
      }),
    ).toEqual([])
    expect(calls).toBe(0)
  })

  test("resolves the preload once in source mode", () => {
    let calls = 0
    const path = "/resolved/preload"

    expect(
      preload(false, () => {
        calls++
        return path
      }),
    ).toEqual([path])
    expect(calls).toBe(1)
  })

  test(
    "starts the TUI from a directory without OpenTUI dependencies",
    async () => {
      await using root = await tmpdir()
      const state = { text: "", exit: undefined as Exit | undefined }
      const ready = Promise.withResolvers<void>()
      const stopped = Promise.withResolvers<void>()
      const proc = spawn(
        process.execPath,
        [
          "--conditions=browser",
          `--preload=${import.meta.resolve("@opentui/solid/preload")}`,
          path.resolve(import.meta.dir, "../../../../src/index.ts"),
        ],
        {
          name: "xterm-256color",
          cols: 120,
          rows: 40,
          cwd: root.path,
          env: sanitizedProcessEnv({
            HOME: root.path,
            XDG_CONFIG_HOME: path.join(root.path, ".config"),
            XDG_DATA_HOME: path.join(root.path, ".local/share"),
            XDG_STATE_HOME: path.join(root.path, ".local/state"),
            XDG_CACHE_HOME: path.join(root.path, ".cache"),
            KILO_TEST_HOME: root.path,
            KILO_CONFIG_CONTENT: "{}",
            KILO_AUTH_CONTENT: "{}",
            KILO_DISABLE_PROJECT_CONFIG: "1",
            KILO_DISABLE_AUTOUPDATE: "1",
            KILO_DISABLE_MODELS_FETCH: "1",
            KILO_DISABLE_TERMINAL_TITLE: "0",
            KILO_DEV_CWD: "",
            KILO_PURE: "1",
            KILO_NO_DAEMON: "1",
            TERM: "xterm-256color",
          }),
        },
      )
      const data = proc.onData((chunk) => {
        state.text = (state.text + chunk).slice(-20_000)
        if (state.text.includes("TUI worker error")) {
          ready.reject(new Error(`TUI worker failed during startup:\n${state.text}`))
          return
        }
        // The title is emitted only after the worker-backed TUI reaches its rendered app.
        if (state.text.includes("Kilo CLI")) ready.resolve()
      })
      const exit = proc.onExit((event) => {
        state.exit = event
        stopped.resolve()
        ready.reject(
          new Error(
            `TUI exited before rendering (code ${event.exitCode}, signal ${event.signal ?? "none"}):\n${state.text}`,
          ),
        )
      })
      const timer = setTimeout(() => {
        ready.reject(new Error(`Timed out waiting for the TUI to render:\n${state.text}`))
      }, 30_000)

      try {
        await ready.promise
        expect(state.text).toContain("Kilo CLI")
      } finally {
        clearTimeout(timer)
        data.dispose()
        if (!state.exit) proc.kill()
        await stopped.promise
        exit.dispose()
      }
    },
    45_000,
  )

  test("ignores stale PWD after cwd is changed by a process wrapper", async () => {
    await using root = await tmpdir()
    const pkg = path.join(root.path, "packages", "opencode")
    await fs.mkdir(pkg, { recursive: true })

    expect(resolveThreadDirectory(".", root.path, pkg)).toBe(pkg)
  })

  test("uses kilo-dev caller directory when running through package cwd", async () => {
    await using root = await tmpdir()
    const pkg = path.join(root.path, "packages", "opencode")
    await fs.mkdir(pkg, { recursive: true })

    const prev = process.env.KILO_DEV_CWD
    process.env.KILO_DEV_CWD = root.path
    try {
      expect(resolveThreadDirectory(".", root.path, pkg)).toBe(root.path)
      expect(resolveThreadDirectory(undefined, root.path, pkg)).toBe(root.path)
    } finally {
      if (prev === undefined) delete process.env.KILO_DEV_CWD
      else process.env.KILO_DEV_CWD = prev
    }
  })

  test("enables remote exit only for the embedded worker transport", () => {
    const client = { marker: "worker" }

    expect(embeddedRemoteExitClient(false, client)).toBe(client)
    expect(embeddedRemoteExitClient(true, client)).toBeUndefined()
    expect(embeddedRemoteExitClient(false, undefined)).toBeUndefined()
  })

  test("continues TUI startup when remote-exit readiness and cleanup never reply", async () => {
    const calls: string[] = []
    let handler: (() => void) | undefined
    let tuiContinued = false
    const done = Promise.resolve().then(() => {
      tuiContinued = true
    })

    await runEmbeddedRemoteExitBridge({
      client: {
        on(_event, next) {
          calls.push("subscribe")
          handler = next
          return () => {
            calls.push("unsubscribe")
            handler = undefined
          }
        },
        async call(method) {
          calls.push(method)
          await new Promise(() => {})
        },
      },
      exit: () => {},
      done,
      timeoutMs: 5,
    })

    expect(tuiContinued).toBe(true)
    expect(calls).toEqual(["subscribe", "tuiReady", "tuiGone", "unsubscribe"])
    expect(handler).toBeUndefined()
  })

  test("validates imported daemon session over HTTP after importing from cloud", async () => {
    await using root = await tmpdir()
    const cloud = "ses_cloud"
    const local = "ses_local"
    const calls: string[] = []
    const opened: Array<string | undefined> = []
    using server = Bun.serve({
      port: 0,
      fetch(request) {
        const route = `${request.method} ${new URL(request.url).pathname}`
        calls.push(route)
        if (route === "POST /kilo/cloud/session/import") return Response.json({ id: local })
        if (route === `GET /session/${local}`) return Response.json({ id: local })
        return new Response(null, { status: 404 })
      },
    })
    const url = new URL(server.url)
    const daemon = spyOn(DaemonClient, "maybe").mockResolvedValue({
      url: url.origin,
      headers: {},
      state: {
        pid: process.pid,
        hostname: url.hostname,
        port: Number(url.port),
        url: url.origin,
        username: "kilo",
        password: "test",
        token: "test",
        version: "test",
        startedAt: new Date().toISOString(),
        log: path.join(root.path, "daemon.log"),
      },
    })
    const args = { port: 0, hostname: "127.0.0.1", mdns: false, "mdns-domain": "kilo.local", cors: [] }
    const start: Parameters<typeof KiloTuiThreadDaemon.attach>[0]["start"] = async (input) => {
      opened.push(input.args.sessionID)
    }

    try {
      await KiloTuiThreadDaemon.attach({
        args: { ...args, session: cloud, cloudFork: true },
        cwd: root.path,
        input: async () => undefined,
        start,
      })

      expect(calls).toEqual(["POST /kilo/cloud/session/import", `GET /session/${local}`])
      expect(opened).toEqual([local])
    } finally {
      daemon.mockRestore()
    }
  })

  test("imports cloud fork before validating daemon session", async () => {
    const seen: string[] = []
    const started: string[] = []

    mock.module("@kilocode/sdk/v2", () => ({
      createKiloClient: () => ({
        kilo: {
          cloud: {
            session: {
              import: async (input: { sessionId: string }) => {
                expect(input.sessionId).toBe("ses_cloud")
                return { data: { id: "ses_local" } }
              },
            },
          },
        },
      }),
    }))
    mock.module("@/cli/tui/validate-session", () => ({
      validateSession: async (input: { sessionID?: string }) => {
        seen.push(input.sessionID ?? "")
      },
    }))
    mock.module("@/config/tui", () => ({
      TuiConfig: {
        get: async () => ({}),
      },
    }))
    mock.module("@/kilocode/daemon/client", () => ({
      DaemonClient: {
        maybe: async () => ({ url: "http://127.0.0.1:4096", headers: {} }),
      },
    }))
    mock.module("@/cli/ui", () => ({
      UI: {
        println: () => {},
        error: () => {},
      },
    }))

    const key = JSON.stringify({ time: Date.now(), rand: Math.random() })
    const mod = await import(`../../../../src/kilocode/cli/cmd/tui/thread?${key}`)

    const handled = await mod.KiloTuiThreadDaemon.attach({
      args: { session: "ses_cloud", cloudFork: true },
      cwd: "/tmp/project",
      input: async () => undefined,
      start: async (input: { args: { sessionID?: string } }) => {
        started.push(input.args.sessionID ?? "")
      },
    })

    expect(handled).toBe(true)
    expect(seen).toEqual(["ses_local"])
    expect(started).toEqual(["ses_local"])
  })
})
