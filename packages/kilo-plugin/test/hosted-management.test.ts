import { expect, test } from "bun:test"
import { KiloAccount } from "@kilocode/gateway-core"
import { createManagement } from "../src/hosted/management"

const account = KiloAccount.resolve({ token: "issuer-fixture" }, {})
const target = { scope: "scope", providerID: "kilo-cloud", workspaceID: "worktree_q", sessionID: "ses_q" } as const
const control = "workspace_q"
const signal = new AbortController().signal
const envelope = (value: unknown) => Response.json({ result: { data: value } })

test("reads the official aggregate cost and confirms the actual renamed title, scoped to one account/repository/session", async () => {
  const calls: string[] = []
  let ack = "New title"
  const row = {
    session_id: target.sessionID,
    cloud_agent_session_id: control,
    cloud_agent_worktree_id: target.workspaceID,
    organization_id: account.organizationID,
    title: null,
    git_branch: "dev",
    total_cost_microdollars: 125000,
    runtimeState: { mode: "code", model: "model", private: "not shared" },
  }
  using issuer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      calls.push(`${req.method} ${url.pathname}`)
      expect(req.headers.get("authorization")).toBe(`Bearer ${account.token}`)
      if (req.method === "GET") {
        expect(JSON.parse(url.searchParams.get("input")!)).toEqual({ session_id: target.sessionID })
        return envelope(row)
      }
      expect(await req.json()).toEqual({ session_id: target.sessionID, title: "New title" })
      return envelope({ title: ack })
    },
  })
  const m = createManagement(
    account,
    issuer.url.origin,
    async (t) => {
      if (t.workspaceID !== target.workspaceID) throw new Error("not in workspace")
      return control
    },
    async () => {
      throw new Error("wrong service")
    },
  )
  expect(await m.info(target, signal)).toEqual({
    title: null,
    branch: "dev",
    totalCostMicrodollars: 125000,
    agent: "code",
    model: "model",
  })
  expect(await m.rename(target, "New title", signal)).toEqual({ title: "New title" })
  await expect(m.rename({ ...target, workspaceID: "other" }, "New title", signal)).rejects.toThrow("not in workspace")
  ack = "other"
  await expect(m.rename(target, "New title", signal)).rejects.toThrow("invalid response")
  row.cloud_agent_worktree_id = "wrong" as typeof target.workspaceID
  await expect(m.info(target, signal)).rejects.toThrow("invalid response")
  expect(calls).toEqual([
    "GET /api/trpc/cliSessionsV2.getWithRuntimeState",
    "POST /api/trpc/cliSessionsV2.rename",
    "POST /api/trpc/cliSessionsV2.rename",
    "GET /api/trpc/cliSessionsV2.getWithRuntimeState",
  ])
})

test("root-session conflict, access denial, wrong acknowledgements and pending cleanup stay single-session operations", async () => {
  const calls: string[] = []
  const key = crypto.randomUUID()
  const ok = { workspaceId: target.workspaceID, sessionId: control, success: true, cleanup: "pending" }
  const responses = [
    Response.json({ error: { message: "workspace_requires_root_session" } }, { status: 409 }),
    new Response(null, { status: 403 }),
    envelope({ ...ok, sessionId: "sibling" }),
    envelope(ok),
  ]
  const m = createManagement(
    account,
    "http://unused.invalid",
    async (t) => {
      expect(t).toEqual(target)
      return control
    },
    async (path, init) => {
      calls.push(path)
      expect(init.method).toBe("POST")
      expect(JSON.parse(String(init.body))).toEqual({
        workspaceId: target.workspaceID,
        sessionId: control,
        operationKey: key,
      })
      return responses.shift()!
    },
  )
  await expect(m.remove(target, key, signal)).rejects.toThrow("at least one session")
  await expect(m.remove(target, key, signal)).rejects.toThrow("denied access")
  await expect(m.remove(target, key, signal)).rejects.toThrow("invalid response")
  expect(await m.remove(target, key, signal)).toEqual({ cleanup: "pending" })
  expect(calls).toEqual(Array(4).fill("/trpc/deleteHostedWorkspaceSession"))
})
