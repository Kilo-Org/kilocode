import { expect, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import type { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { createCloudNavigation, type ChatRoute } from "../webview-ui/agent-manager/cloud/route"
import { createSessionPool } from "../webview-ui/agent-manager/cloud/session-pool"
import { createCloudStatus } from "../webview-ui/agent-manager/cloud/status"
import { projectActivity } from "../webview-ui/agent-manager/sidebar-search"

const source: ChatRoute = {
  kind: "session",
  projectID: "project",
  directory: "/fixture",
  scope: "private_scope",
  repository: "https://github.com/example/project",
  title: "Tracked chat",
  target: {
    providerID: "kilo-cloud",
    scope: "private_scope",
    workspaceID: "worktree_private",
    sessionID: "ses_same_as_local",
  },
}

test("observing pooled live activity is passive, deduplicated and clears with the authorized lease", async () => {
  const calls: string[] = []
  let read = Promise.withResolvers<Response>(),
    entered = Promise.withResolvers<void>()
  const api = OpenCode.make({
    baseUrl: "http://local.invalid",
    fetch: Object.assign(
      async (input: Request | URL | string, init?: RequestInit) => {
        const request = new Request(input, init),
          method = new URL(request.url).pathname.split("/").at(-1)!
        calls.push(method)
        if (method === "attach") return Response.json({ output: { attachmentID: "fixture_lease" } })
        if (method === "read") {
          entered.resolve()
          return read.promise
        }
        if (method === "detach") return Response.json({ output: {} })
        throw new Error("Unexpected RPC")
      },
      { preconnect: fetch.preconnect },
    ),
  })
  const nav = createCloudNavigation(),
    pool = createSessionPool(api)
  let enabled = true
  const status = createCloudStatus(nav, pool, () => enabled)
  nav.select(source)
  nav.select(source)
  expect(status.rows()).toEqual([])
  expect(calls).toEqual([])
  const attach = pool.acquire(source.directory, source.target)
  try {
    await entered.promise
    let revision = 0
    async function step(
      state: KiloHostedRpc.Snapshot["status"],
      connection: KiloHostedRpc.Snapshot["connection"] = "live",
      waiting = false,
    ) {
      const previous = read
      read = Promise.withResolvers<Response>()
      entered = Promise.withResolvers<void>()
      previous.resolve(
        Response.json({
          output: {
            revision: ++revision,
            snapshot: {
              status: state,
              connection,
              messages: [],
              permissions: [],
              questions: waiting ? [{ id: "question", questions: [] }] : [],
            },
          },
        }),
      )
      await entered.promise
    }
    await step("busy")
    const [row] = status.rows()
    expect(status.rows()).toHaveLength(1)
    expect(row!.state).toBe("busy")
    expect(JSON.stringify(row)).not.toMatch(/private_scope|worktree_private|ses_same_as_local/)
    await step("busy", "live", true)
    expect(status.rows()[0]?.state).toBe("waiting")
    await step("busy", "disconnected", true)
    expect(status.rows()[0]?.state).toBe("error")
    await step("retry")
    expect(status.rows()[0]?.state).toBe("retry")
    await step("idle")
    expect(status.rows()[0]?.state).toBe("idle")
    nav.leave()
    enabled = false
    status.select(row!.key)
    expect(nav.current()).toBeUndefined()
    expect(status.rows()).toEqual([])
    enabled = true
    status.select(row!.key)
    expect(nav.current()).toBe(source)
    pool.clear()
    nav.leave()
    status.select(row!.key)
    expect(nav.current()).toBeUndefined()
    expect(status.rows()).toEqual([])
    expect(calls.filter((c) => c === "attach")).toHaveLength(1)
  } finally {
    attach.release()
    pool.clear()
    read.resolve(Response.json({ output: { revision: 100 } }))
  }
})

test("project summary merges observed states without double counting or replacing local operation state", () => {
  const local = [
    { projectId: "one", state: "busy" },
    { projectId: "one", state: "busy" },
    { projectId: "two", state: "done" },
  ] as const
  expect([...projectActivity([...local, { projectId: "one", state: "waiting" }])]).toEqual([
    ["one", "waiting"],
    ["two", "done"],
  ])
  expect([...projectActivity([...local, { projectId: "one", state: "idle" }])]).toEqual([
    ["one", "busy"],
    ["two", "done"],
  ])
  expect([...projectActivity([{ projectId: "one", state: "idle" }])]).toEqual([])
})
