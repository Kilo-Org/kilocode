import { expect, test } from "bun:test"
import { KiloAccount } from "@kilocode/gateway-core"
import { createCatalog } from "../src/hosted/catalog"
import { createForkShare } from "../src/hosted/fork-share"

const remote = "https://github.com/test/source"
const source = {
  scope: "bound",
  providerID: "kilo-cloud",
  workspaceID: "worktree_source",
  sessionID: "ses_source",
} as const
const destination = { ...source, workspaceID: "worktree_destination", sessionID: "ses_destination" }
const control = "workspace_source",
  newControl = "workspace_destination"
const orgID = "11111111-1111-4111-8111-111111111111"
const signal = new AbortController().signal

function fixture(org: string | null = null) {
  const calls: { method: string; path: string; input: Record<string, unknown> }[] = []
  const page = {
    kind: "success",
    info: { id: source.sessionID },
    messages: [],
    source: { version: "v1" },
    nextCursor: null,
    updateCursor: 0,
    omittedItemCount: 0,
  }
  const runtime = {
    sessionId: control,
    worktreeId: source.workspaceID,
    kiloSessionId: source.sessionID,
    mode: "code",
    model: "test/model",
    variant: "high",
    platform: "github",
    githubRepo: "test/source",
  }
  const metadata = {
    session_id: source.sessionID,
    cloud_agent_session_id: control,
    cloud_agent_worktree_id: source.workspaceID,
    organization_id: org,
    git_url: remote,
    runtimeState: runtime,
  }
  const clone = {
    sourceKiloSessionId: source.sessionID,
    kiloSessionId: destination.sessionID,
    cloudAgentSessionId: newControl,
  }
  const receipt = {
    workspaceId: destination.workspaceID,
    activeKiloSessionId: destination.sessionID,
    sessions: [clone],
  }
  const state = {
    history: page as unknown,
    readError: false,
    shareError: false,
    allowSource: true,
    destOrg: org,
    destPublished: true,
    returnControl: newControl,
    claimOverride: {} as Record<string, unknown>,
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname
      const input = req.method === "GET" ? JSON.parse(url.searchParams.get("input")!) : await req.json()
      calls.push({ method: req.method, path, input })
      const reply = (data: unknown) => Response.json({ result: { data } })
      if (path === "/trpc/getHostedWorkspace") {
        const dst = input.workspaceId === destination.workspaceID
        if (dst ? !state.destPublished : !state.allowSource) return reply(null)
        const target = dst ? destination : source
        const payer = dst ? state.destOrg : org
        return reply({
          workspaceId: target.workspaceID,
          organizationId: payer,
          gitUrl: remote,
          name: null,
          gitBranch: null,
          deletionState: "active",
          nextSessionCursor: null,
          sessions: [
            {
              workspaceId: target.workspaceID,
              organizationId: payer,
              title: null,
              kiloSessionId: target.sessionID,
              cloudAgentSessionId: dst ? state.returnControl : control,
            },
          ],
        })
      }
      if (path === "/trpc/continueHostedWorkspace") return reply(receipt)
      if (path === "/api/trpc/cliSessionsV2.getWithRuntimeState") return reply(metadata)
      if (path.endsWith(".getSessionMessagesPage"))
        return state.readError ? new Response(null, { status: 503 }) : reply(state.history)
      if (path === "/api/trpc/cliSessionsV2.share") {
        if (state.shareError) return new Response(null, { status: 503 })
        const iat = Math.floor(Date.now() / 1000),
          jti = crypto.randomUUID()
        const payload = {
          sub: source.sessionID,
          version: 2,
          iss: "kilo-session-ingest",
          aud: "kilo-session-share",
          duration: "7d",
          include_new_messages: false,
          iat,
          exp: iat + 7 * 86400,
          jti,
          ...state.claimOverride,
        }
        return reply({
          public_id: jti,
          share_token: `fixture.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.fixture`,
        })
      }
      return new Response(null, { status: 404 })
    },
  })
  const worker = (path: string, init: RequestInit) => fetch(new URL(path, server.url), init)
  const catalog = createCatalog(source.scope, remote, org, worker)
  const actions = createForkShare(
    { ...KiloAccount.resolve({ token: "fixture" }, {}), organizationID: org },
    server.url.origin,
    remote,
    catalog.authorize,
    worker,
  )
  return {
    server,
    calls,
    state,
    actions,
    metadata,
    runtime,
    page,
    clone,
    receipt,
    posts: () => calls.filter((c) => c.method === "POST"),
    async offer() {
      const result = await actions.snapshotOptions(source, signal)
      if (!result.available) throw Error("No offer")
      return result.confirmation
    },
  }
}

test("fork replays the original payload across late catalog registration and checks the destination control id", async () => {
  const f = fixture(orgID)
  using _ = f.server
  const operationKey = crypto.randomUUID()
  f.state.destPublished = false
  await expect(f.actions.fork(source, operationKey, signal)).rejects.toThrow("not found")
  f.runtime.mode = "plan"
  f.state.destPublished = true
  f.state.returnControl = "workspace_unexpected"
  await expect(f.actions.fork(source, operationKey, signal)).rejects.toThrow("invalid response")
  f.state.returnControl = newControl
  expect((await f.actions.fork(source, operationKey, signal)).target).toEqual(destination)
  const body = {
    operationKey,
    clientProvenance: "agent-manager",
    repository: { type: "github", repo: "test/source" },
    activeSourceKiloSessionId: source.sessionID,
    sessions: [
      { sourceKiloSessionId: source.sessionID, agent: { mode: "code", model: "test/model", variant: "high" } },
    ],
  }
  expect(f.posts().map((c) => [c.path, c.input])).toEqual(Array(3).fill(["/trpc/continueHostedWorkspace", body]))
})

test("wrong source repository, account, runtime or denied source never forks", async () => {
  const f = fixture(orgID)
  using _ = f.server
  const fork = () => f.actions.fork(source, crypto.randomUUID(), signal)
  f.metadata.git_url = "https://github.com/test/other"
  await expect(fork()).rejects.toThrow()
  f.metadata.git_url = remote
  f.metadata.organization_id = null
  await expect(fork()).rejects.toThrow()
  f.metadata.organization_id = orgID
  f.runtime.sessionId = newControl
  await expect(fork()).rejects.toThrow()
  f.runtime.sessionId = control
  f.runtime.githubRepo = "test/other"
  await expect(fork()).rejects.toThrow()
  f.runtime.githubRepo = "test/source"
  f.state.allowSource = false
  await expect(fork()).rejects.toThrow()
  expect(f.posts()).toHaveLength(0)
})

test("fork refuses another destination tenant, another source mapping, or a reused destination session", async () => {
  const f = fixture(orgID)
  using _ = f.server
  const fork = () => f.actions.fork(source, crypto.randomUUID(), signal)
  f.state.destOrg = null
  await expect(fork()).rejects.toThrow("account")
  f.state.destOrg = orgID
  f.clone.sourceKiloSessionId = "ses_other" as typeof source.sessionID
  await expect(fork()).rejects.toThrow("invalid response")
  f.clone.sourceKiloSessionId = source.sessionID
  f.receipt.activeKiloSessionId = source.sessionID
  await expect(fork()).rejects.toThrow("invalid response")
})

test.each([null, orgID])(
  "share availability is a read; exact one-use publication returns only the trusted issuer link",
  async (org) => {
    const f = fixture(org)
    using _ = f.server
    if (!org) f.state.history = null
    const canceled = await f.offer()
    expect(f.posts()).toHaveLength(0)
    const confirmed = await f.offer()
    await expect(f.actions.publishSnapshot(source, canceled, signal)).rejects.toThrow("confirm")
    await expect(f.actions.publishSnapshot(destination, confirmed, signal)).rejects.toThrow("confirm")
    const output = await f.actions.publishSnapshot(source, confirmed, signal)
    await expect(f.actions.publishSnapshot(source, confirmed, signal)).rejects.toThrow("confirm")
    expect(output.url.startsWith(f.server.url.origin + "/s/")).toBe(true)
    expect(f.posts()).toEqual([
      {
        method: "POST",
        path: "/api/trpc/cliSessionsV2.share",
        input: { session_id: source.sessionID, duration: "7d", include_new_messages: false },
      },
    ])
    expect(f.calls.filter((c) => c.path.endsWith(".getSessionMessagesPage"))).toEqual(
      Array(3).fill({
        method: "GET",
        path: `/api/trpc/${org ? "organizations." : ""}cloudAgentNext.getSessionMessagesPage`,
        input: { sessionId: control, kiloSessionId: source.sessionID, limit: 1, ...(org && { organizationId: org }) },
      }),
    )
  },
)

test("sharing refuses v2, wrong sessions, unreadable histories and stale permissions before publication", async () => {
  const f = fixture()
  using _ = f.server
  const confirmation = await f.offer()
  f.page.source.version = "v2"
  await expect(f.actions.publishSnapshot(source, confirmation, signal)).rejects.toThrow("unavailable")
  expect(await f.actions.snapshotOptions(source, signal)).toEqual({ available: false })
  for (const history of [
    { ...f.page, info: { id: "other" } },
    { ...f.page, source: { version: "future" } },
    { source: { version: "v1" } },
    { ...f.page, source: undefined, messages: [{ message: {} }] },
  ]) {
    f.state.history = history
    await expect(f.offer()).rejects.toThrow("invalid response")
  }
  f.state.readError = true
  await expect(f.offer()).rejects.toThrow()
  f.state.readError = false
  f.state.history = null
  const fresh = await f.offer()
  f.state.allowSource = false
  await expect(f.actions.publishSnapshot(source, fresh, signal)).rejects.toThrow()
  expect(f.posts()).toHaveLength(0)
})

test("ambiguous or over-broad share grants do not retry or yield a capability", async () => {
  const f = fixture()
  using _ = f.server
  const key = await f.offer()
  f.state.shareError = true
  await expect(f.actions.publishSnapshot(source, key, signal)).rejects.toThrow()
  await expect(f.actions.publishSnapshot(source, key, signal)).rejects.toThrow("confirm")
  expect(f.posts()).toHaveLength(1)
  f.state.shareError = false
  for (const override of [{ include_new_messages: true }, { sub: "other" }, { duration: "never" }, { exp: 0 }]) {
    f.state.claimOverride = override
    await expect(f.actions.publishSnapshot(source, await f.offer(), signal)).rejects.toThrow("invalid response")
  }
})
