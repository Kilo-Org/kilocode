import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../../../fixture/fixture"
import { resolveThreadDirectory } from "../../../../src/cli/cmd/tui"
import { KiloTuiThreadDaemon } from "../../../../src/kilocode/cli/cmd/tui/thread"
import { DaemonClient } from "../../../../src/kilocode/daemon/client"

afterEach(() => {
  mock.restore()
})

describe("kilo tui thread", () => {
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
