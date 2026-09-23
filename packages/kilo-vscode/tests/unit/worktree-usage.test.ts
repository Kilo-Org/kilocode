import { afterEach, describe, expect, test } from "bun:test"
import { requestUsage, type UsageConnection } from "../../src/agent-manager/worktree-usage"

const servers: Array<ReturnType<typeof Bun.serve>> = []

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

describe("worktree usage HTTP requests", () => {
  test("connects and sends authenticated directory-scoped query params", async () => {
    const seen: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        expect(request.headers.get("authorization")).toBe(`Basic ${Buffer.from("kilo:secret").toString("base64")}`)
        expect(url.pathname).toBe("/kilocode/worktree/usage/timeline")
        expect(url.searchParams.get("directory")).toBe("/repo/task")
        expect(url.searchParams.get("limit")).toBe("120")
        return Response.json({ events: [{ id: "event-1" }] })
      },
    })
    servers.push(server)

    const connection: UsageConnection = {
      getClientAsync: async (dir) => {
        seen.push(dir ?? "")
      },
      getServerConfig: () => ({ baseUrl: `http://127.0.0.1:${server.port}`, password: "secret" }),
    }

    const result = await requestUsage<{ events: Array<{ id: string }> }>(
      connection,
      "/repo/task",
      "/kilocode/worktree/usage/timeline",
      { limit: "120" },
    )

    expect(seen).toEqual(["/repo/task"])
    expect(result.events).toEqual([{ id: "event-1" }])
  })

  test("throws the backend response when the endpoint fails", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("not found", { status: 404 }) })
    servers.push(server)
    const connection: UsageConnection = {
      getClientAsync: async () => {},
      getServerConfig: () => ({ baseUrl: `http://127.0.0.1:${server.port}`, password: "secret" }),
    }

    expect(requestUsage(connection, "/repo/task", "/kilocode/worktree/usage")).rejects.toThrow(
      "Worktree usage request failed (404): not found",
    )
  })
})
