import { afterEach, describe, expect, mock, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../../../fixture/fixture"
import { resolveThreadDirectory } from "../../../../src/cli/cmd/tui/thread"

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
    mock.module("@/cli/cmd/tui/validate-session", () => ({
      validateSession: async (input: { sessionID?: string }) => {
        seen.push(input.sessionID ?? "")
      },
    }))
    mock.module("@/cli/cmd/tui/config/tui", () => ({
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
