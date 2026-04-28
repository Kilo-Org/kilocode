import { afterEach, describe, expect, test } from "bun:test"
import { Log } from "../../src/util/log"
import { WorkspaceServer } from "../../src/control-plane/workspace-server/server"
import { parseSSE } from "../../src/control-plane/sse"
import { GlobalBus } from "../../src/bus/global"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

Log.init({ print: false })

describe("control-plane/workspace-server SSE", () => {
  test("streams GlobalBus events and parseSSE reads them", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = WorkspaceServer.App()
    const stop = new AbortController()
    const seen: unknown[] = []
    // devilcode_change start
    let stream: Promise<void> | undefined
    // devilcode_change end
    try {
      const response = await app.request("/event", {
        signal: stop.signal,
        headers: {
          "x-kilo-workspace": "wrk_test_workspace",
          "x-kilo-directory": tmp.path,
        },
      })

      expect(response.status).toBe(200)
      expect(response.body).toBeDefined()

      const done = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("timed out waiting for workspace.test event"))
        }, 3000)

        // devilcode_change start
        stream = parseSSE(response.body!, stop.signal, (event) => {
          seen.push(event)
          const next = event as { type?: string }
          if (next.type === "server.connected") {
            GlobalBus.emit("event", {
              payload: {
                type: "workspace.test",
                properties: { ok: true },
              },
            })
            return
          }
          if (next.type !== "workspace.test") return
          clearTimeout(timeout)
          resolve()
        }).catch((error) => {
          clearTimeout(timeout)
          reject(error)
        })
        // devilcode_change end
      })

      await done

      expect(seen.some((event) => (event as { type?: string }).type === "server.connected")).toBe(true)
      expect(seen).toContainEqual({
        type: "workspace.test",
        properties: { ok: true },
      })
    } finally {
      // devilcode_change start
      stop.abort()
      await stream?.catch(() => undefined)
      // stop.abort() resolves the client stream before Hono has always run
      // server-side abort cleanup, so Bun.sleep gives the SSE handler a brief
      // window to remove its GlobalBus listener before the temp dir is gone.
      await Bun.sleep(100)
      // devilcode_change end
    }
  })
})
