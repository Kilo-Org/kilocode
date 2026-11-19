import { describe, expect, it } from "bun:test"
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { KiloAccount } from "@kilocode/gateway-core"
import { initGit } from "../../core/test/fixture/git"
import { KiloGatewayAccounts } from "../src/gateway/accounts"
import { hostedLocation } from "../src/hosted"
import { createCatalog } from "../src/hosted/catalog"
import { repository } from "../src/hosted/repository"
import { createTransport, deployment } from "../src/hosted/transport"

const account = KiloAccount.resolve({ token: "fixture-source" }, {})
const scope = "opaque"
const remote = "https://github.com/Owner/Repo"
const signal = new AbortController().signal
const target = { scope, providerID: "kilo-cloud" as const, workspaceID: "workspace_1", sessionID: "ses_1" }
const session = {
  workspaceId: target.workspaceID,
  kiloSessionId: target.sessionID,
  cloudAgentSessionId: "workspace_11111111-1111-4111-8111-111111111111",
  organizationId: null,
  title: "Root",
}
const row = {
  workspaceId: target.workspaceID,
  name: "Cloud",
  deletionState: "active",
  gitUrl: remote.toLowerCase() + ".git",
  gitBranch: "main",
  organizationId: null,
  nextSessionCursor: null,
  sessions: [session],
}
const create = { scope, operationKey: crypto.randomUUID(), agent: { mode: "code", model: "vendor/model" } }
const messageID = "msg_0123456789ab0123456789ABCD"
const envelope = (data: unknown) => Response.json({ result: { data } })

describe("hosted catalog", () => {
  it("finds the ready terminal owner only among authorized siblings and cancels only the named queued message", async () => {
    const controls: string[] = []
    const catalog = createCatalog(scope, remote, null, async (path, init) => {
      const url = new URL(path, "https://worker.invalid")
      if (url.pathname.endsWith("/getHostedWorkspace"))
        return envelope({
          ...row,
          sessions: [session, { ...session, kiloSessionId: "other", cloudAgentSessionId: "ready-control" }],
        })
      if (url.pathname.endsWith("/getSession")) {
        controls.push(JSON.parse(url.searchParams.get("input")!).cloudAgentSessionId)
        return envelope({ routeReady: true })
      }
      expect(url.pathname).toBe("/trpc/cancelQueuedMessage")
      expect(JSON.parse(String(init.body))).toEqual({ sessionId: session.cloudAgentSessionId, messageId: messageID })
      return envelope({ dropped: false })
    })
    expect(await catalog.readySibling(target, signal)).toBe("ready-control")
    expect(controls).toEqual(["ready-control"])
    expect(await catalog.cancelQueued(target, messageID, signal)).toEqual({ dropped: false })
  })
  it("waits for an acknowledged sibling to appear without granting access from the receipt", async () => {
    let listed = false
    const catalog = createCatalog(scope, remote, null, async (_path, init) =>
      init.method === "POST"
        ? envelope({ workspaceId: target.workspaceID, kiloSessionId: target.sessionID, messageId: messageID })
        : envelope({ ...row, sessions: listed ? [session] : [] }),
    )
    const ack = await catalog.start(
      { ...create, workspaceID: target.workspaceID, prompt: "new sibling", messageID },
      signal,
    )
    await expect(catalog.authorize(ack.target, signal)).rejects.toThrow("registering")
    await expect(catalog.authorize({ ...target, sessionID: "not-admitted" }, signal)).rejects.toThrow("does not belong")
    listed = true
    expect(await catalog.authorize(ack.target, signal)).toBe(session.cloudAgentSessionId)
    listed = false
    await expect(catalog.authorize(ack.target, signal)).rejects.toThrow("does not belong")
  })
  it("lists only this project and payer and follows the separate root-session cursor", async () => {
    const calls: { name: string; input: Record<string, unknown> }[] = []
    const catalog = createCatalog(scope, remote, null, async (path) => {
      const url = new URL(path, "https://worker.test")
      const input = JSON.parse(url.searchParams.get("input")!)
      calls.push({ name: url.pathname, input })
      if (url.pathname === "/trpc/listHostedWorkspaces")
        return envelope({
          items: [row, { ...row, organizationId: "other" }, { ...row, gitUrl: "https://github.com/other/repo" }],
          nextCursor: "workspaces-next",
        })
      return envelope(input.sessionCursor ? row : { ...row, sessions: [], nextSessionCursor: "roots-next" })
    })
    expect(await catalog.list({ cursor: "older" }, signal)).toEqual({
      items: [
        {
          workspaceID: target.workspaceID,
          name: "Cloud",
          branch: "main",
          deletionState: "active",
          sessions: [{ sessionID: target.sessionID, title: "Root" }],
        },
      ],
      cursor: "workspaces-next",
    })
    expect(await catalog.authorize(target, signal)).toBe(session.cloudAgentSessionId)
    expect(calls.map((c) => c.input)).toEqual([
      { repositoryUrl: remote, limit: 50, sessionLimit: 10, cursor: "older" },
      { workspaceId: target.workspaceID, sessionLimit: 100 },
      { workspaceId: target.workspaceID, sessionLimit: 100, sessionCursor: "roots-next" },
    ])
  })

  it("fails closed on mismatched detail, account, repository, nested session, deletion or missing membership", async () => {
    for (const wrong of [
      null,
      { ...row, workspaceId: "different" },
      { ...row, organizationId: "org" },
      { ...row, gitUrl: null },
      { ...row, gitUrl: "https://gitlab.com/Owner/Repo" },
      { ...row, sessions: [{ ...session, workspaceId: "different" }] },
      { ...row, sessions: [{ ...session, organizationId: "different" }] },
      { ...row, sessions: [] },
      { ...row, deletionState: "deleting" },
    ]) {
      const catalog = createCatalog(scope, remote, null, async () => envelope(wrong))
      await expect(catalog.authorize(target, signal)).rejects.toThrow()
    }
  })

  it("creates with stable operation and message IDs, keeps worker routing data private and rejects mismatched acknowledgements", async () => {
    const org = crypto.randomUUID()
    const calls: unknown[] = []
    const result = {
      workspaceId: target.workspaceID,
      kiloSessionId: target.sessionID,
      cloudAgentSessionId: "private",
      replayed: true,
    }
    let ack: object = result
    const catalog = createCatalog(scope, remote, org, async (path, init) => {
      if (init.method === "GET")
        return envelope({ ...row, organizationId: org, sessions: [{ ...session, organizationId: org }] })
      calls.push([path, JSON.parse(String(init.body))])
      return envelope(ack)
    })
    expect(await catalog.create(create, signal)).toEqual({ target, replayed: true })
    const profileID = crypto.randomUUID()
    ack = { ...result, messageId: messageID }
    await catalog.create({ ...create, branch: "release/v2", profileID, prompt: "go", messageID }, signal)
    await catalog.start({ ...create, workspaceID: target.workspaceID, prompt: "next", messageID }, signal)
    expect(calls).toEqual([
      [
        "/trpc/createHostedWorkspace",
        {
          operationKey: create.operationKey,
          agent: create.agent,
          clientProvenance: "agent-manager",
          repository: { type: "github", repo: "Owner/Repo" },
          options: { kilocodeOrganizationId: org },
        },
      ],
      [
        "/trpc/createHostedWorkspace",
        {
          operationKey: create.operationKey,
          agent: create.agent,
          clientProvenance: "agent-manager",
          repository: { type: "github", repo: "Owner/Repo", branch: "release/v2" },
          profile: { id: profileID },
          message: { id: messageID, prompt: "go" },
          options: { kilocodeOrganizationId: org },
        },
      ],
      [
        "/trpc/createHostedWorkspaceSession",
        {
          operationKey: create.operationKey,
          agent: create.agent,
          clientProvenance: "agent-manager",
          workspaceId: target.workspaceID,
          message: { id: messageID, prompt: "next" },
          kilocodeOrganizationId: org,
        },
      ],
    ])
    ack = { ...result, messageId: "other" }
    await expect(catalog.create({ ...create, prompt: "go", messageID }, signal)).rejects.toThrow("invalid response")
    ack = { ...result, messageId: messageID, workspaceId: "other" }
    await expect(
      catalog.start({ ...create, workspaceID: target.workspaceID, prompt: "next", messageID }, signal),
    ).rejects.toThrow("invalid response")
  })

  it("exposes safe profile choices and the effective Cloud default", async () => {
    const org = crypto.randomUUID()
    const profile = { id: crypto.randomUUID(), name: "CI", ownerType: "organization", envVars: { SECRET: "redacted" } }
    const catalog = createCatalog(scope, remote, org, async (path) => {
      expect(JSON.parse(new URL(path, "https://cloud.test").searchParams.get("input")!)).toEqual({
        kilocodeOrganizationId: org,
      })
      return envelope({ personalProfiles: [], organizationProfiles: [profile], effectiveDefaultProfileId: profile.id })
    })
    expect(await catalog.profiles(signal)).toEqual({
      items: [{ id: profile.id, name: "CI", owner: "organization" }],
      effectiveDefaultProfileID: profile.id,
    })
  })
})

describe("hosted credentials and scope", () => {
  it("rejects non-origin overrides and refuses to use an enterprise credential with public Cloud", () => {
    for (const url of [
      "https://example.org/path",
      "file:///etc",
      "http://example.org",
      "https://user@example.org",
      "https://example.org?ref=1",
      "https://example.org.",
    ]) {
      expect(deployment(account, { KILO_WEB_APP_URL: url })).toBeUndefined()
    }
    expect(deployment({ ...account, server: "https://enterprise.test" }, {})).toBeUndefined()
    expect(deployment({ ...account, token: "https://enterprise.test:token" }, {})).toBeUndefined()
    expect(deployment(account, {})).toEqual({
      issuer: "https://kilo.ai",
      worker: "https://cloud-agent-next.kilosessions.ai",
    })
  })

  it("separates source/worker credentials, refuses redirects and never retries a mutation", async () => {
    const issuerCalls: unknown[] = []
    const workerCalls: unknown[] = []
    const org = crypto.randomUUID()
    const issuer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        issuerCalls.push([req.method, new URL(req.url).pathname, req.headers.get("authorization"), await req.json()])
        return Response.json({ token: "control", expiresAt: new Date(Date.now() + 300_000).toISOString() })
      },
    })
    const worker = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        workerCalls.push([req.method, req.headers.get("authorization"), req.headers.get("x-kilocode-organizationid")])
        return new URL(req.url).pathname === "/trpc/redirect"
          ? Response.redirect(issuer.url, 307)
          : new Response(null, { status: 204 })
      },
    })
    try {
      const request = createTransport(
        { ...account, organizationID: org },
        { issuer: issuer.url.origin, worker: worker.url.origin },
        "test",
        signal,
      )
      await request("/trpc/list", { signal })
      await expect(request("/trpc/redirect", { method: "POST", signal })).rejects.toThrow()
      await expect(request(`${issuer.url}kilo/other`, { method: "GET", signal })).rejects.toThrow(
        "Invalid Kilo Cloud route",
      )
      expect(issuerCalls).toEqual([
        ["POST", "/api/cloud-agent-next/token", "Bearer fixture-source", { organizationId: org }],
      ])
      expect(workerCalls).toEqual([
        ["GET", "Bearer control", org],
        ["POST", "Bearer control", org],
      ])
    } finally {
      await Promise.all([issuer.stop(true), worker.stop(true)])
    }
  })

  it("does not publish in-flight results across a credential or git remote change", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hosted-scope-"))
    let active: KiloAccount.Info | undefined = account
    const unregister = KiloGatewayAccounts.register(dir, () => active)
    const host = hostedLocation(dir, "test")
    try {
      await initGit(dir)
      expect(await host.status(signal)).toEqual({ state: "no_repository" })
      const file = join(dir, ".git/config")
      await appendFile(file, `\n[remote "origin"]\n url = https://user:secret@github.com/Owner/Repo.git?token=secret\n`)
      const first = await host.status(signal)
      expect(first).toMatchObject({ state: "ready", repository: remote })
      expect(host.changed()).toBe(false)
      const pending = Promise.withResolvers<void>()
      const entered = Promise.withResolvers<void>()
      const result = host.scoped(first.scope!, signal, async () => {
        entered.resolve()
        await pending.promise
        return "old transcript"
      })
      await entered.promise
      active = { ...account, token: "replacement" }
      expect(host.changed()).toBe(true)
      pending.resolve()
      await expect(result).rejects.toThrow("changed")
      const second = await host.status(signal)
      expect(second.scope).not.toBe(first.scope)
      await writeFile(file, `[remote "origin"]\n url = https://github.com/other/project\n`)
      await expect(host.scoped(second.scope!, signal, async () => "old transcript")).rejects.toThrow("changed")
      active = undefined
      expect(host.changed()).toBe(true)
      expect(await host.status(signal)).toEqual({ state: "signed_out" })
    } finally {
      host.close()
      unregister()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("normalizes SSH and strips credentials, fragments and local paths", () => {
    expect(repository("git@github.com:Owner/Repo.git")).toBe(remote)
    expect(repository("ssh://git@github.com/Owner/Repo")).toBe(remote)
    expect(repository("https://token@github.com/Owner/Repo.git#token")).toBe(remote)
    expect(repository("file:///home/me/src")).toBeUndefined()
    expect(repository("../local")).toBeUndefined()
    expect(repository("https://github.com/Owner/Repo/extra")).toBeUndefined()
  })
})
