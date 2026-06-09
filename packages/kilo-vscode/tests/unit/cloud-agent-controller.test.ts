import { describe, expect, it } from "bun:test"
import type { GlobalEvent, KiloClient, Session } from "@kilocode/sdk/v2/client"
import { CloudAgentController, cloudDirectory } from "../../src/agent-manager/cloud-agent/controller"
import { CloudAgentStartError, type CloudAgentStartResult } from "../../src/agent-manager/cloud-agent/start"
import { createCloudSessionState } from "../../webview-ui/agent-manager/cloud-agent/session-state"
import type { ExtensionMessage, SessionInfo } from "../../webview-ui/src/types/messages"

function session(id = "ses_cloud"): Session {
  return {
    id,
    slug: id,
    projectID: "cloud",
    directory: cloudDirectory(id),
    title: "Cloud run",
    version: "1",
    time: { created: 1_700_000_000_000, updated: 1_700_000_100_000 },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function pending() {
  return (async function* () {
    await new Promise<void>(() => {})
  })()
}

function abortPending(signal?: AbortSignal) {
  return (async function* () {
    await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }))
  })()
}

function local(token = "secret", currentOrgId: string | null = null): KiloClient {
  return {
    kilo: {
      profile: async () => ({
        data: {
          profile: {
            email: "coder@example.com",
            name: "Cloud Coder",
            organizations: [{ id: "org_1", name: "Kilo Org", role: "member" }],
          },
          balance: { balance: 100 },
          currentOrgId,
        },
      }),
      cloudAgent: {
        credentials: async () => ({
          data: {
            token,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            kiloFacadeUrl: "https://cloud.example/kilo",
            cloudAgentUrl: "https://cloud.example",
          },
        }),
      },
    },
  } as unknown as KiloClient
}

function remote(extra: Record<string, unknown> = {}): KiloClient {
  return {
    session: {
      list: async () => ({ data: [] }),
      get: async () => ({ data: session() }),
      messages: async () => ({ data: [] }),
      status: async () => ({ data: {} }),
      abort: async () => ({ data: true }),
      promptAsync: async () => ({ data: undefined }),
      ...((extra.session as Record<string, unknown>) ?? {}),
    },
    global: {
      event: async () => ({ stream: pending() }),
      ...((extra.global as Record<string, unknown>) ?? {}),
    },
    command: {
      list: async () => ({ data: [] }),
      ...((extra.command as Record<string, unknown>) ?? {}),
    },
  } as unknown as KiloClient
}

function controller(client: KiloClient, posts: unknown[], extra: Record<string, unknown> = {}) {
  return new CloudAgentController({
    getLocalClient: local,
    getRoot: () => "/workspace",
    remoteUrl: async () => "git@github.com:Kilo-Org/kilocode.git",
    post: (message) => posts.push(message),
    log: () => {},
    createClient: (() => client) as never,
    listSessions: async () => (await client.session.list({ limit: 100 }, { throwOnError: true })).data ?? [],
    confirmation: 0,
    ...extra,
  })
}

function started(extra: Partial<CloudAgentStartResult> = {}): CloudAgentStartResult {
  return {
    cloudAgentSessionId: "cloud_1",
    kiloSessionId: "ses_created",
    messageId: "msg_1",
    delivery: "queued",
    ...extra,
  }
}

function create(cloud: CloudAgentController) {
  return cloud.handle({
    type: "agentManager.createCloudSession",
    prompt: " Fix it ",
    mode: " code ",
    model: " kilo-auto ",
  })
}

function type(item: unknown) {
  return (item as { type?: string }).type
}

describe("CloudAgentController", () => {
  it("opens only Cloud Agent sessions admitted by repository discovery", async () => {
    const posts: unknown[] = []
    const cloud = controller(remote({ session: { list: async () => ({ data: [session("ses_listed")] }) } }), posts)
    cloud.attach()

    expect(cloud.handle({ type: "agentManager.openCloudSession", sessionId: "ses_unlisted" })).toBe(true)
    expect(cloud.owns("ses_unlisted")).toBe(false)

    cloud.requestList()
    await Bun.sleep(0)
    cloud.handle({ type: "agentManager.openCloudSession", sessionId: "ses_listed" })

    expect(cloud.owns("ses_listed")).toBe(true)
    cloud.dispose()
  })

  it("posts sanitized repository and personal account labels for Cloud Agent creation", async () => {
    const posts: unknown[] = []
    const cloud = controller(remote(), posts)
    cloud.attach()

    expect(cloud.handle({ type: "agentManager.requestCloudCreateContext" })).toBe(true)
    await Bun.sleep(0)

    expect(posts).toEqual([
      {
        type: "agentManager.cloudCreateContext",
        status: "ready",
        repository: "github.com/Kilo-Org/kilocode",
        account: "Cloud Coder",
      },
    ])
  })

  it("posts a sanitized organization label for Cloud Agent creation", async () => {
    const posts: unknown[] = []
    const cloud = controller(remote(), posts, { getLocalClient: () => local("secret", "org_1") })
    cloud.attach()

    cloud.handle({ type: "agentManager.requestCloudCreateContext" })
    await Bun.sleep(0)

    expect(posts).toEqual([
      {
        type: "agentManager.cloudCreateContext",
        status: "ready",
        repository: "github.com/Kilo-Org/kilocode",
        account: "Kilo Org",
      },
    ])
  })

  it("starts a personal Cloud Agent with the exact worker request and no branch or organization", async () => {
    const posts: unknown[] = []
    const calls: unknown[] = []
    const cloud = controller(remote(), posts, {
      startAgent: async (opts: unknown) => {
        calls.push(opts)
        return started()
      },
    })
    cloud.attach()

    expect(create(cloud)).toBe(true)
    await Bun.sleep(0)

    expect(calls).toEqual([
      {
        url: "https://cloud.example",
        token: "secret",
        input: {
          message: { prompt: "Fix it" },
          agent: { mode: "code", model: "kilo-auto" },
          repository: { type: "github", repo: "Kilo-Org/kilocode" },
          options: { createdOnPlatform: "agent-manager" },
        },
      },
    ])
    expect(JSON.stringify(calls)).not.toContain("branch")
  })

  it("starts an organization Cloud Agent with the active organization", async () => {
    const posts: unknown[] = []
    const calls: Array<{ input: { options: unknown } }> = []
    const cloud = controller(remote(), posts, {
      getLocalClient: () => local("secret", "org_1"),
      startAgent: async (opts: { input: { options: unknown } }) => {
        calls.push(opts)
        return started()
      },
    })
    cloud.attach()

    create(cloud)
    await Bun.sleep(0)

    expect(calls[0]?.input.options).toEqual({
      createdOnPlatform: "agent-manager",
      kilocodeOrganizationId: "org_1",
    })
  })

  it("claims the Kilo session before posting created and never owns the worker control-plane session", async () => {
    const posts: unknown[] = []
    let cloud!: CloudAgentController
    cloud = controller(remote(), posts, {
      startAgent: async () => started(),
      post: (message: unknown) => {
        if (type(message) === "agentManager.cloudSessionCreated") {
          expect(cloud.owns("ses_created")).toBe(true)
          expect(cloud.owns("cloud_1")).toBe(false)
        }
        posts.push(message)
      },
    })
    cloud.attach()

    create(cloud)
    await Bun.sleep(0)

    expect(posts.find((item) => type(item) === "agentManager.cloudSessionCreated")).toMatchObject({
      type: "agentManager.cloudSessionCreated",
      session: { id: "ses_created" },
    })
  })

  it("refreshes wanted discovery in the background after successful creation", async () => {
    const posts: unknown[] = []
    let lists = 0
    const cloud = controller(
      remote({
        session: {
          list: async () => {
            lists += 1
            return { data: [] }
          },
        },
      }),
      posts,
      { startAgent: async () => started() },
    )
    cloud.attach()
    cloud.requestList()
    await Bun.sleep(0)

    create(cloud)
    await Bun.sleep(0)

    expect(lists).toBe(2)
  })

  it("replays start once only after an explicit unauthorized result", async () => {
    const posts: unknown[] = []
    const tokens: string[] = []
    let auth = 0
    let calls = 0
    const cloud = controller(remote(), posts, {
      getLocalClient: () => local(`secret-${++auth}`),
      startAgent: async (opts: { token: string }) => {
        calls += 1
        tokens.push(opts.token)
        if (calls === 1) throw new CloudAgentStartError("unauthorized", "unauthorized")
        return started()
      },
    })
    cloud.attach()

    create(cloud)
    await Bun.sleep(0)

    expect(tokens).toEqual(["secret-2", "secret-3"])
    expect(posts).toContainEqual(expect.objectContaining({ type: "agentManager.cloudSessionCreated" }))
  })

  it("pauses after repeated unauthorized start and posts a rejected creation failure", async () => {
    const posts: unknown[] = []
    let starts = 0
    const cloud = controller(remote(), posts, {
      startAgent: async () => {
        starts += 1
        throw new CloudAgentStartError("unauthorized", "raw worker error")
      },
    })
    cloud.attach()

    create(cloud)
    await Bun.sleep(0)
    create(cloud)
    await Bun.sleep(0)

    expect(starts).toBe(2)
    expect(posts.filter((item) => type(item) === "agentManager.cloudSessionCreateFailed")).toEqual([
      {
        type: "agentManager.cloudSessionCreateFailed",
        kind: "rejected",
        error: "Cloud Agent authentication could not be refreshed. Retry after signing in again.",
      },
      {
        type: "agentManager.cloudSessionCreateFailed",
        kind: "rejected",
        error: "Cloud Agent authentication could not be refreshed. Retry after signing in again.",
      },
    ])
  })

  it("refreshes wanted discovery without replaying an indeterminate start outcome", async () => {
    const posts: unknown[] = []
    let lists = 0
    let starts = 0
    const cloud = controller(
      remote({
        session: {
          list: async () => {
            lists += 1
            return { data: [] }
          },
        },
      }),
      posts,
      {
        startAgent: async () => {
          starts += 1
          throw new CloudAgentStartError("indeterminate", "Creation may already have succeeded")
        },
      },
    )
    cloud.attach()
    cloud.requestList()
    await Bun.sleep(0)

    create(cloud)
    await Bun.sleep(0)

    expect(starts).toBe(1)
    expect(lists).toBe(2)
    expect(posts).toContainEqual({
      type: "agentManager.cloudSessionCreateFailed",
      kind: "indeterminate",
      error: "Creation may already have succeeded",
    })
  })

  it("consumes invalid Cloud Agent creation without calling the worker", async () => {
    const posts: unknown[] = []
    let starts = 0
    const cloud = controller(remote(), posts, {
      startAgent: async () => {
        starts += 1
        return started()
      },
    })
    cloud.attach()

    expect(
      cloud.handle({ type: "agentManager.createCloudSession", prompt: " ", mode: "code", model: "kilo-auto" }),
    ).toBe(true)
    await Bun.sleep(0)

    expect(starts).toBe(0)
    expect(posts).toContainEqual({
      type: "agentManager.cloudSessionCreateFailed",
      kind: "rejected",
      error: "Cloud Agent creation requires a prompt, mode, and model",
    })
  })

  it("silently consumes a same-panel duplicate while one Cloud Agent creation is in flight", async () => {
    const posts: unknown[] = []
    const gate = deferred<CloudAgentStartResult>()
    let starts = 0
    const cloud = controller(remote(), posts, {
      startAgent: () => {
        starts += 1
        return gate.promise
      },
    })
    cloud.attach()

    create(cloud)
    expect(create(cloud)).toBe(true)
    await Bun.sleep(0)
    expect(starts).toBe(1)
    expect(posts.filter((item) => type(item) === "agentManager.cloudSessionCreateFailed")).toEqual([])

    gate.resolve(started())
    await Bun.sleep(0)
  })

  it("fails closed when active profile context is unavailable", async () => {
    const posts: unknown[] = []
    let starts = 0
    const cloud = controller(remote(), posts, {
      getLocalClient: () =>
        ({
          kilo: { profile: async () => ({ data: { profile: { email: "coder@example.com" } } }) },
        }) as unknown as KiloClient,
      startAgent: async () => {
        starts += 1
        return started()
      },
    })
    cloud.attach()

    create(cloud)
    await Bun.sleep(0)

    expect(starts).toBe(0)
    expect(posts).toContainEqual({
      type: "agentManager.cloudSessionCreateFailed",
      kind: "rejected",
      error: "Cloud Agent creation context is unavailable. Retry after reconnecting or signing in again.",
    })
  })

  for (const field of ["prompt", "mode", "model"] as const) {
    for (const value of [undefined, null, 42, " "]) {
      it(`consumes invalid ${field} value ${String(value)} without calling the worker`, async () => {
        const posts: unknown[] = []
        let starts = 0
        const input: Record<string, unknown> = {
          type: "agentManager.createCloudSession",
          prompt: "Fix it",
          mode: "code",
          model: "kilo-auto",
          [field]: value,
        }
        const cloud = controller(remote(), posts, {
          startAgent: async () => {
            starts += 1
            return started()
          },
        })
        cloud.attach()

        expect(cloud.handle(input)).toBe(true)
        await Bun.sleep(0)

        expect(starts).toBe(0)
        expect(posts).toContainEqual({
          type: "agentManager.cloudSessionCreateFailed",
          kind: "rejected",
          error: "Cloud Agent creation requires a prompt, mode, and model",
        })
      })
    }
  }

  it("suppresses stale auth failure after detach", async () => {
    const posts: unknown[] = []
    const gate = deferred<never>()
    let starts = 0
    const cloud = controller(remote(), posts, {
      startAgent: async () => {
        starts += 1
        if (starts === 1) throw new CloudAgentStartError("unauthorized", "unauthorized")
        return gate.promise
      },
    })
    cloud.attach()

    create(cloud)
    await Bun.sleep(0)
    cloud.detach()
    gate.reject(new CloudAgentStartError("unauthorized", "unauthorized"))
    await Bun.sleep(0)

    expect(posts.filter((item) => type(item) === "agentManager.cloudSessionCreateFailed")).toEqual([])
  })

  it("suppresses stale creation success after detach", async () => {
    const posts: unknown[] = []
    const gate = deferred<CloudAgentStartResult>()
    const cloud = controller(remote(), posts, { startAgent: () => gate.promise })
    cloud.attach()

    create(cloud)
    await Bun.sleep(0)
    cloud.detach()
    gate.resolve(started())
    await Bun.sleep(0)

    expect(cloud.owns("ses_created")).toBe(false)
    expect(posts.filter((item) => type(item) === "agentManager.cloudSessionCreated")).toEqual([])
  })

  for (const action of ["localDisconnected", "authChanged"] as const) {
    it(`${action} unlocks an active creation without retransmitting before settlement`, async () => {
      const posts: unknown[] = []
      const first = deferred<CloudAgentStartResult>()
      const second = deferred<CloudAgentStartResult>()
      let starts = 0
      const cloud = controller(remote(), posts, {
        startAgent: () => (++starts === 1 ? first.promise : second.promise),
      })
      cloud.attach()

      create(cloud)
      await Bun.sleep(0)
      cloud[action]()
      create(cloud)
      await Bun.sleep(0)

      expect(starts).toBe(1)
      expect(posts.filter((item) => type(item) === "agentManager.cloudSessionCreateFailed")).toContainEqual({
        type: "agentManager.cloudSessionCreateFailed",
        kind: "indeterminate",
        error:
          "Cloud Agent session creation may already have succeeded. Check Cloud Agents before starting another session.",
      })
      first.resolve(started({ kiloSessionId: "ses_stale" }))
      await Bun.sleep(0)
      create(cloud)
      await Bun.sleep(0)
      expect(starts).toBe(2)
      second.resolve(started({ kiloSessionId: "ses_new" }))
      await Bun.sleep(0)
    })
  }

  it("detach suppresses stale completion and blocks a new panel start until settlement", async () => {
    const posts: unknown[] = []
    const first = deferred<CloudAgentStartResult>()
    const second = deferred<CloudAgentStartResult>()
    let starts = 0
    const cloud = controller(remote(), posts, {
      startAgent: () => (++starts === 1 ? first.promise : second.promise),
    })
    cloud.attach()
    create(cloud)
    await Bun.sleep(0)

    cloud.detach()
    cloud.attach()
    create(cloud)
    await Bun.sleep(0)
    expect(starts).toBe(1)
    expect(posts).toContainEqual({
      type: "agentManager.cloudSessionCreateFailed",
      kind: "indeterminate",
      error:
        "Cloud Agent session creation may already have succeeded. Check Cloud Agents before starting another session.",
    })

    first.resolve(started({ kiloSessionId: "ses_old" }))
    await Bun.sleep(0)
    create(cloud)
    await Bun.sleep(0)
    expect(starts).toBe(2)
    second.resolve(started({ kiloSessionId: "ses_new" }))
    await Bun.sleep(0)

    expect(posts.filter((item) => type(item) === "agentManager.cloudSessionCreated")).toEqual([
      expect.objectContaining({ session: expect.objectContaining({ id: "ses_new" }) }),
    ])
    expect(cloud.owns("ses_new")).toBe(true)
    expect(cloud.owns("ses_old")).toBe(false)
  })

  it("posts only the latest overlapping create-context completion", async () => {
    const posts: unknown[] = []
    const first = deferred<string | undefined>()
    let calls = 0
    const cloud = controller(remote(), posts, {
      remoteUrl: () => (++calls === 1 ? first.promise : Promise.resolve("git@github.com:Kilo-Org/new.git")),
    })
    cloud.attach()

    cloud.handle({ type: "agentManager.requestCloudCreateContext" })
    cloud.handle({ type: "agentManager.requestCloudCreateContext" })
    await Bun.sleep(0)
    first.resolve("git@github.com:Kilo-Org/old.git")
    await Bun.sleep(0)

    expect(posts).toEqual([
      {
        type: "agentManager.cloudCreateContext",
        status: "ready",
        repository: "github.com/Kilo-Org/new",
        account: "Cloud Coder",
      },
    ])
  })

  it("posts signed-out create context while auth is paused", async () => {
    const posts: unknown[] = []
    const cloud = controller(remote(), posts, {
      startAgent: async () => {
        throw new CloudAgentStartError("unauthorized", "raw worker error")
      },
    })
    cloud.attach()
    create(cloud)
    await Bun.sleep(0)

    cloud.handle({ type: "agentManager.requestCloudCreateContext" })
    await Bun.sleep(0)

    expect(posts.at(-1)).toEqual({ type: "agentManager.cloudCreateContext", status: "signed-out" })
  })

  it("posts signed-out create context for unauthorized profile lookup", async () => {
    const posts: unknown[] = []
    const cloud = controller(remote(), posts, {
      getLocalClient: () =>
        ({
          kilo: {
            profile: async () => {
              throw { status: 401 }
            },
          },
        }) as unknown as KiloClient,
    })
    cloud.attach()

    cloud.handle({ type: "agentManager.requestCloudCreateContext" })
    await Bun.sleep(0)

    expect(posts).toEqual([{ type: "agentManager.cloudCreateContext", status: "signed-out" }])
  })

  it("sanitizes unavailable create-context repository failures", async () => {
    const posts: unknown[] = []
    const cloud = controller(remote(), posts, {
      remoteUrl: async () => {
        throw new Error("token=secret origin=https://user:password@example.com /Users/private/workspace")
      },
    })
    cloud.attach()

    cloud.handle({ type: "agentManager.requestCloudCreateContext" })
    await Bun.sleep(0)

    expect(posts).toEqual([
      {
        type: "agentManager.cloudCreateContext",
        status: "unavailable",
        error: "Cloud Agent creation context is unavailable. Retry after reconnecting or signing in again.",
      },
    ])
  })

  for (const source of ["repository", "profile", "token"] as const) {
    it(`sanitizes secret-bearing ${source} preflight failures`, async () => {
      const posts: unknown[] = []
      const secret = "token=secret origin=https://user:password@example.com /Users/private/workspace"
      const extra =
        source === "repository"
          ? {
              remoteUrl: async () => {
                throw new Error(secret)
              },
            }
          : source === "profile"
            ? {
                getLocalClient: () =>
                  ({
                    kilo: {
                      profile: async () => {
                        throw new Error(secret)
                      },
                    },
                  }) as unknown as KiloClient,
              }
            : {
                getLocalClient: () =>
                  ({
                    kilo: {
                      profile: local().kilo.profile,
                      cloudAgent: {
                        credentials: async () => {
                          throw new Error(secret)
                        },
                      },
                    },
                  }) as unknown as KiloClient,
              }
      const cloud = controller(remote(), posts, extra)
      cloud.attach()

      create(cloud)
      await Bun.sleep(0)

      expect(posts).toContainEqual({
        type: "agentManager.cloudSessionCreateFailed",
        kind: "rejected",
        error: "Cloud Agent creation context is unavailable. Retry after reconnecting or signing in again.",
      })
      expect(JSON.stringify(posts)).not.toContain("secret")
      expect(JSON.stringify(posts)).not.toContain("/Users/private")
    })
  }

  it("re-resolves authoritative repository between context preview and submit", async () => {
    const posts: unknown[] = []
    const calls: unknown[] = []
    let remotes = 0
    const cloud = controller(remote(), posts, {
      remoteUrl: async () =>
        ++remotes === 1 ? "git@github.com:Kilo-Org/preview.git" : "git@github.com:Kilo-Org/submit.git",
      startAgent: async (opts: unknown) => {
        calls.push(opts)
        return started()
      },
    })
    cloud.attach()

    cloud.handle({ type: "agentManager.requestCloudCreateContext" })
    await Bun.sleep(0)
    create(cloud)
    await Bun.sleep(0)

    expect(posts).toContainEqual({
      type: "agentManager.cloudCreateContext",
      status: "ready",
      repository: "github.com/Kilo-Org/preview",
      account: "Cloud Coder",
    })
    expect(calls).toContainEqual(
      expect.objectContaining({
        input: expect.objectContaining({ repository: { type: "github", repo: "Kilo-Org/submit" } }),
      }),
    )
  })

  it("does not admit the initial prompt through promptAsync", async () => {
    const posts: unknown[] = []
    let prompts = 0
    const cloud = controller(
      remote({
        session: {
          promptAsync: async () => {
            prompts += 1
            return { data: undefined }
          },
        },
      }),
      posts,
      {
        startAgent: async () => started(),
      },
    )
    cloud.attach()

    create(cloud)
    await Bun.sleep(0)

    expect(prompts).toBe(0)
  })

  it("hydrates a created chat when its successful snapshot is idle", async () => {
    const posts: unknown[] = []
    let retries = 0
    const cloud = controller(
      remote({
        session: {
          messages: async () => ({
            data: [
              {
                info: {
                  id: "msg_1",
                  sessionID: "ses_created",
                  role: "user",
                  time: { created: 1_700_000_000_000 },
                  agent: "code",
                  model: { providerID: "kilo", modelID: "kilo-auto" },
                },
                parts: [],
              },
            ],
          }),
          status: async () => ({ data: {} }),
        },
        global: {
          event: async (opts: { signal?: AbortSignal; onSseEvent?: () => void }) => {
            opts.onSseEvent?.()
            return { stream: abortPending(opts.signal) }
          },
        },
      }),
      posts,
      {
        startAgent: async () => started(),
        wait: async () => {
          retries += 1
          await Bun.sleep(0)
        },
      },
    )
    cloud.attach()

    create(cloud)
    await Bun.sleep(0)
    await Bun.sleep(0)
    cloud.dispose()

    expect(retries).toBe(0)
    expect(posts).toContainEqual({ type: "sessionStatus", sessionID: "ses_created", status: "idle" })
    expect(posts).toContainEqual({
      type: "messagesLoaded",
      sessionID: "ses_created",
      messages: [expect.objectContaining({ id: "msg_1", role: "user" })],
      mode: "replace",
      hasMore: false,
    })
    expect(posts.filter((item) => type(item) === "error")).toEqual([])
  })

  it("keeps the created startup stream attached while transient hydration failures retry", async () => {
    const posts: unknown[] = []
    const progress = deferred<void>()
    const reconciled = deferred<void>()
    let streams = 0
    let details = 0
    let statuses = 0
    let retries = 0
    const event = (step: string, type = "preparing") => ({
      directory: cloudDirectory("ses_created"),
      payload: {
        type: "cloud.status",
        properties: { sessionID: "ses_created", cloudStatus: { type, ...(step ? { step } : {}) } },
      },
    })
    const cloud = controller(
      remote({
        session: {
          get: async () => {
            details += 1
            if (details === 1) throw new Error("facade unavailable")
            return { data: session("ses_created") }
          },
          status: async () => {
            statuses += 1
            if (statuses === 2) reconciled.resolve(undefined)
            return { data: {} }
          },
        },
        global: {
          event: async (opts: { signal?: AbortSignal; onSseEvent?: () => void }) => {
            streams += 1
            opts.onSseEvent?.()
            if (streams > 1) return { stream: pending() }
            return {
              stream: (async function* () {
                await progress.promise
                if (opts.signal?.aborted) return
                yield event("disk_check")
                yield event("workspace_setup")
                yield event("cloning")
                yield event("", "ready")
                yield* abortPending(opts.signal)
              })(),
            }
          },
        },
      }),
      posts,
      {
        startAgent: async () => started(),
        wait: async () => {
          retries += 1
          progress.resolve(undefined)
          await Bun.sleep(0)
        },
      },
    )
    cloud.attach()

    create(cloud)
    await reconciled.promise
    await Bun.sleep(0)

    expect(streams).toBe(1)
    expect(retries).toBe(1)
    expect(posts.filter((item) => type(item) === "agentManager.cloudStatus")).toEqual([
      {
        type: "agentManager.cloudStatus",
        sessionID: "ses_created",
        cloudStatus: { type: "preparing", step: "disk_check" },
      },
      {
        type: "agentManager.cloudStatus",
        sessionID: "ses_created",
        cloudStatus: { type: "preparing", step: "workspace_setup" },
      },
      {
        type: "agentManager.cloudStatus",
        sessionID: "ses_created",
        cloudStatus: { type: "preparing", step: "cloning" },
      },
      { type: "agentManager.cloudStatus", sessionID: "ses_created", cloudStatus: { type: "ready" } },
    ])
    expect(posts).toContainEqual({ type: "sessionStatus", sessionID: "ses_created", status: "idle" })
    expect(posts.filter((item) => type(item) === "error")).toEqual([])
    cloud.dispose()
  })

  it("retries only startup-pending sessions after stable sessions hydrate", async () => {
    const posts: unknown[] = []
    const ready = deferred<void>()
    const calls = new Map<string, number>()
    const cloud = controller(
      remote({
        session: {
          get: async (input: { sessionID: string }) => {
            const count = (calls.get(input.sessionID) ?? 0) + 1
            calls.set(input.sessionID, count)
            if (input.sessionID === "ses_created" && count === 1) throw new Error("facade unavailable")
            if (input.sessionID === "ses_created") ready.resolve(undefined)
            return { data: session(input.sessionID) }
          },
          status: async (input: { directory: string }) => {
            const id = input.directory.split("/").at(-1)!
            return { data: { [id]: { type: "idle" } } }
          },
        },
        global: {
          event: async (opts: { signal?: AbortSignal; onSseEvent?: () => void }) => {
            opts.onSseEvent?.()
            return { stream: abortPending(opts.signal) }
          },
        },
      }),
      posts,
      { startAgent: async () => started(), wait: async () => Bun.sleep(0) },
    )
    cloud.attach()
    cloud.open("ses_stable")
    await Bun.sleep(0)

    create(cloud)
    await ready.promise
    await Bun.sleep(0)

    expect(calls.get("ses_stable")).toBe(1)
    expect(calls.get("ses_created")).toBe(2)
    expect(
      posts.filter(
        (item) => type(item) === "messagesLoaded" && (item as { sessionID?: string }).sessionID === "ses_stable",
      ),
    ).toHaveLength(1)
    cloud.dispose()
  })

  it("clears stale startup progress before reconnecting a failed stream", async () => {
    const posts: unknown[] = []
    const waiting = deferred<void>()
    const stopped = deferred<void>()
    const event = {
      directory: cloudDirectory("ses_created"),
      payload: {
        type: "cloud.status",
        properties: { sessionID: "ses_created", cloudStatus: { type: "preparing", step: "disk_check" } },
      },
    }
    const cloud = controller(
      remote({
        session: { status: async () => new Promise<never>(() => {}) },
        global: {
          event: async (opts: { onSseEvent?: () => void }) => {
            opts.onSseEvent?.()
            return {
              stream: (async function* () {
                yield event
                throw new Error("stream failed")
              })(),
            }
          },
        },
      }),
      posts,
      {
        startAgent: async () => started(),
        wait: async () => {
          waiting.resolve(undefined)
          await stopped.promise
        },
      },
    )
    cloud.attach()

    create(cloud)
    await waiting.promise
    await Bun.sleep(0)

    expect(
      posts.filter((item) => ["agentManager.cloudStatus", "agentManager.cloudSessionsPending"].includes(type(item))),
    ).toEqual([
      {
        type: "agentManager.cloudStatus",
        sessionID: "ses_created",
        cloudStatus: { type: "preparing", step: "disk_check" },
      },
      { type: "agentManager.cloudSessionsPending", sessionIDs: ["ses_created"] },
    ])
    cloud.dispose()
    stopped.resolve(undefined)
  })

  it("buffers created startup stream events until authoritative hydration", async () => {
    const posts: unknown[] = []
    const hydrate = deferred<{ data: Record<string, { type: "busy" }> }>()
    const event = {
      directory: cloudDirectory("ses_created"),
      payload: {
        id: "evt_part",
        type: "message.part.updated",
        properties: {
          part: { id: "part_1", sessionID: "ses_created", messageID: "msg_1", type: "text", text: "delta" },
        },
      },
    }
    const cloud = controller(
      remote({
        session: { status: () => hydrate.promise },
        global: {
          event: async (opts: { onSseEvent?: () => void }) => {
            opts.onSseEvent?.()
            return {
              stream: (async function* () {
                yield event
                await new Promise<void>(() => {})
              })(),
            }
          },
        },
      }),
      posts,
      { startAgent: async () => started() },
    )
    cloud.attach()

    create(cloud)
    await Bun.sleep(0)
    expect(posts.map(type)).toEqual(["agentManager.cloudSessionCreated"])

    hydrate.resolve({ data: { ses_created: { type: "busy" } } })
    await Bun.sleep(0)
    expect(posts.map(type)).toEqual([
      "agentManager.cloudSessionCreated",
      "sessionStatus",
      "sessionUpdated",
      "messagesLoaded",
      "partUpdated",
    ])
    cloud.dispose()
  })

  it("restarts a retained stream to reconcile a newly created Cloud Agent", async () => {
    const posts: unknown[] = []
    const signals: AbortSignal[] = []
    const hydrated: string[] = []
    let streams = 0
    const cloud = controller(
      remote({
        session: {
          get: async (input: { sessionID: string }) => {
            hydrated.push(input.sessionID)
            return { data: session(input.sessionID) }
          },
          status: async (input: { directory: string }) => {
            const id = input.directory.split("/").at(-1)!
            return { data: { [id]: { type: "busy" } } }
          },
        },
        global: {
          event: async (opts: { signal?: AbortSignal; onSseEvent?: () => void }) => {
            streams += 1
            signals.push(opts.signal!)
            if (streams > 1) opts.onSseEvent?.()
            return { stream: abortPending(opts.signal) }
          },
        },
      }),
      posts,
      { startAgent: async () => started({ kiloSessionId: "ses_created" }) },
    )
    cloud.attach()
    cloud.open("ses_existing")
    await Bun.sleep(0)

    create(cloud)
    await Bun.sleep(0)

    expect(streams).toBe(2)
    expect(signals[0]?.aborted).toBe(true)
    expect(hydrated).toContain("ses_created")
    expect(posts).toContainEqual({ type: "sessionStatus", sessionID: "ses_created", status: "busy" })
    cloud.dispose()
  })

  it("context disconnect posts unavailable and recover re-resolves demanded context", async () => {
    const posts: unknown[] = []
    const cloud = controller(remote(), posts)
    cloud.attach()
    cloud.handle({ type: "agentManager.requestCloudCreateContext" })
    await Bun.sleep(0)

    cloud.localDisconnected()
    cloud.recover()
    await Bun.sleep(0)

    expect(posts).toContainEqual({
      type: "agentManager.cloudCreateContext",
      status: "unavailable",
      error: "Cloud Agent creation context is unavailable. Retry after reconnecting or signing in again.",
    })
    expect(posts.filter((item) => type(item) === "agentManager.cloudCreateContext").at(-1)).toMatchObject({
      status: "ready",
    })
  })

  it("authChanged re-resolves demanded create context", async () => {
    const posts: unknown[] = []
    let profiles = 0
    const client = local()
    const cloud = controller(remote(), posts, {
      getLocalClient: () =>
        ({
          ...client,
          kilo: {
            ...client.kilo,
            profile: async () => {
              profiles += 1
              return client.kilo.profile()
            },
          },
        }) as KiloClient,
    })
    cloud.attach()
    cloud.handle({ type: "agentManager.requestCloudCreateContext" })
    await Bun.sleep(0)

    cloud.authChanged()
    await Bun.sleep(0)

    expect(profiles).toBe(2)
    expect(posts.filter((item) => type(item) === "agentManager.cloudCreateContext")).toHaveLength(2)
  })

  it("facade pause invalidates a transmitted create once and blocks retransmit until settlement", async () => {
    const posts: unknown[] = []
    const gate = deferred<CloudAgentStartResult>()
    const second = deferred<CloudAgentStartResult>()
    let starts = 0
    const cloud = controller(
      remote({
        session: {
          list: async () => {
            throw { status: 401 }
          },
        },
      }),
      posts,
      { startAgent: () => (++starts === 1 ? gate.promise : second.promise) },
    )
    cloud.attach()
    create(cloud)
    await Bun.sleep(0)

    cloud.requestList()
    await Bun.sleep(0)
    create(cloud)
    await Bun.sleep(0)

    expect(starts).toBe(1)
    expect(posts.filter((item) => type(item) === "agentManager.cloudSessionCreateFailed")).toEqual([
      {
        type: "agentManager.cloudSessionCreateFailed",
        kind: "indeterminate",
        error:
          "Cloud Agent session creation may already have succeeded. Check Cloud Agents before starting another session.",
      },
      {
        type: "agentManager.cloudSessionCreateFailed",
        kind: "indeterminate",
        error:
          "Cloud Agent session creation may already have succeeded. Check Cloud Agents before starting another session.",
      },
    ])
    gate.resolve(started({ kiloSessionId: "ses_stale" }))
    await Bun.sleep(0)
    cloud.retryList()
    create(cloud)
    await Bun.sleep(0)
    expect(starts).toBe(2)
    second.resolve(started({ kiloSessionId: "ses_new" }))
    await Bun.sleep(0)
  })

  it("credential readiness invalidates a transmitted create once and blocks retransmit until settlement", async () => {
    const posts: unknown[] = []
    const gate = deferred<CloudAgentStartResult>()
    const second = deferred<CloudAgentStartResult>()
    const client = local()
    let credentials = 0
    let signedOut = true
    let starts = 0
    const cloud = controller(
      remote({
        session: {
          list: async () => {
            throw { status: 401 }
          },
        },
      }),
      posts,
      {
        startAgent: () => (++starts === 1 ? gate.promise : second.promise),
        getLocalClient: () =>
          ({
            ...client,
            kilo: {
              ...client.kilo,
              cloudAgent: {
                credentials: async () => {
                  credentials += 1
                  if (credentials > 1 && signedOut) return { error: { status: 401 } }
                  return client.kilo.cloudAgent.credentials()
                },
              },
            },
          }) as KiloClient,
      },
    )
    cloud.attach()
    create(cloud)
    await Bun.sleep(0)

    cloud.requestList()
    await Bun.sleep(0)
    create(cloud)
    await Bun.sleep(0)

    expect(starts).toBe(1)
    expect(posts.filter((item) => type(item) === "agentManager.cloudSessionCreateFailed")).toEqual([
      {
        type: "agentManager.cloudSessionCreateFailed",
        kind: "indeterminate",
        error:
          "Cloud Agent session creation may already have succeeded. Check Cloud Agents before starting another session.",
      },
      {
        type: "agentManager.cloudSessionCreateFailed",
        kind: "indeterminate",
        error:
          "Cloud Agent session creation may already have succeeded. Check Cloud Agents before starting another session.",
      },
    ])
    gate.resolve(started({ kiloSessionId: "ses_stale" }))
    await Bun.sleep(0)
    signedOut = false
    cloud.authChanged()
    create(cloud)
    await Bun.sleep(0)
    expect(starts).toBe(2)
    second.resolve(started({ kiloSessionId: "ses_new" }))
    await Bun.sleep(0)
  })

  it("facade pause replaces pending create context with signed-out state", async () => {
    const posts: unknown[] = []
    const origin = deferred<string | undefined>()
    let origins = 0
    const cloud = controller(
      remote({
        session: {
          list: async () => {
            throw { status: 401 }
          },
        },
      }),
      posts,
      {
        remoteUrl: () => (++origins === 1 ? origin.promise : Promise.resolve("git@github.com:Kilo-Org/kilocode.git")),
      },
    )
    cloud.attach()
    cloud.handle({ type: "agentManager.requestCloudCreateContext" })
    cloud.requestList()
    await Bun.sleep(0)

    expect(posts).toContainEqual({ type: "agentManager.cloudCreateContext", status: "signed-out" })
    origin.resolve("git@github.com:Kilo-Org/stale.git")
    await Bun.sleep(0)
    expect(posts.filter((item) => type(item) === "agentManager.cloudCreateContext")).toEqual([
      { type: "agentManager.cloudCreateContext", status: "signed-out" },
    ])
  })

  for (const state of ["signed-out", "unavailable"] as const) {
    it(`readiness replaces pending create context with ${state} state`, async () => {
      const posts: unknown[] = []
      const origin = deferred<string | undefined>()
      const localClient = local()
      let origins = 0
      const cloud = controller(remote(), posts, {
        remoteUrl: () => (++origins === 1 ? origin.promise : Promise.resolve("git@github.com:Kilo-Org/kilocode.git")),
        getLocalClient: () =>
          state === "signed-out"
            ? ({
                ...localClient,
                kilo: { ...localClient.kilo, cloudAgent: { credentials: async () => ({ error: { status: 401 } }) } },
              } as KiloClient)
            : null,
      })
      cloud.attach()
      cloud.handle({ type: "agentManager.requestCloudCreateContext" })
      cloud.requestList()
      await Bun.sleep(0)

      expect(posts).toContainEqual(
        state === "signed-out"
          ? { type: "agentManager.cloudCreateContext", status: "signed-out" }
          : {
              type: "agentManager.cloudCreateContext",
              status: "unavailable",
              error: "Cloud Agent creation context is unavailable. Retry after reconnecting or signing in again.",
            },
      )
      origin.resolve("git@github.com:Kilo-Org/stale.git")
      await Bun.sleep(0)
      expect(posts.filter((item) => type(item) === "agentManager.cloudCreateContext")).toHaveLength(1)
    })
  }

  it("keeps one facade stream for repository discovery and subsequently opened sessions", async () => {
    const posts: unknown[] = []
    const signals: AbortSignal[] = []
    let reads = 0
    const cloud = controller(
      remote({
        session: {
          get: async () => {
            reads += 1
            return { data: session() }
          },
          messages: async () => {
            reads += 1
            return { data: [] }
          },
          status: async () => {
            reads += 1
            return { data: {} }
          },
        },
        global: {
          event: async (opts: { signal?: AbortSignal }) => {
            signals.push(opts.signal!)
            return { stream: abortPending(opts.signal) }
          },
        },
      }),
      posts,
    )
    cloud.attach()

    cloud.requestList()
    await Bun.sleep(0)

    expect(signals).toHaveLength(1)
    expect(reads).toBe(0)
    expect(posts.some((item) => type(item) === "agentManager.cloudSessionsPending")).toBe(false)

    cloud.open("ses_cloud")
    await Bun.sleep(0)
    expect(signals).toHaveLength(1)

    cloud.close("ses_cloud")
    expect(signals[0]?.aborted).toBe(false)

    cloud.detach()
    expect(signals[0]?.aborted).toBe(true)
  })

  it("reconnects a list-only stream without hydrating transcripts or posting pending state", async () => {
    const posts: unknown[] = []
    let streams = 0
    let reads = 0
    const cloud = controller(
      remote({
        session: {
          get: async () => {
            reads += 1
            return { data: session() }
          },
          messages: async () => {
            reads += 1
            return { data: [] }
          },
          status: async () => {
            reads += 1
            return { data: {} }
          },
        },
        global: {
          event: async (opts: { onSseEvent?: () => void }) => {
            streams += 1
            if (streams === 1) return { stream: (async function* () {})() }
            opts.onSseEvent?.()
            return { stream: pending() }
          },
        },
      }),
      posts,
      { wait: async () => {} },
    )
    cloud.attach()
    cloud.requestList()
    await Bun.sleep(0)
    await Bun.sleep(0)

    expect(streams).toBe(2)
    expect(reads).toBe(0)
    expect(posts.some((item) => type(item) === "agentManager.cloudSessionsPending")).toBe(false)
    cloud.dispose()
  })

  it("stops list-only streams while suspended or unsupported and restores them on recovery", async () => {
    const posts: unknown[] = []
    const signals: AbortSignal[] = []
    let origin: string | undefined = "git@github.com:Kilo-Org/kilocode.git"
    const cloud = controller(
      remote({
        global: {
          event: async (opts: { signal?: AbortSignal }) => {
            signals.push(opts.signal!)
            return { stream: abortPending(opts.signal) }
          },
        },
      }),
      posts,
      { remoteUrl: async () => origin },
    )
    cloud.attach()
    cloud.requestList()
    await Bun.sleep(0)

    cloud.localDisconnected()
    expect(signals[0]?.aborted).toBe(true)
    expect(posts.some((item) => type(item) === "agentManager.cloudSessionsPending")).toBe(false)

    cloud.recover()
    await Bun.sleep(0)
    expect(signals).toHaveLength(2)
    expect(signals[1]?.aborted).toBe(false)

    origin = undefined
    cloud.requestList()
    await Bun.sleep(0)
    expect(signals[1]?.aborted).toBe(true)
  })

  it("forwards live title updates for listed sessions without open tabs", async () => {
    const posts: unknown[] = []
    const gate = deferred<void>()
    const live = { ...session(), title: "Generated title", time: { ...session().time, updated: 1_700_000_200_000 } }
    const cloud = controller(
      remote({
        global: {
          event: async () => ({
            stream: (async function* () {
              await gate.promise
              yield {
                directory: cloudDirectory("ses_cloud"),
                payload: { type: "session.updated", properties: { info: live } },
              } as GlobalEvent
              await new Promise<void>(() => {})
            })(),
          }),
        },
      }),
      posts,
      { listSessions: async () => [session()] },
    )
    cloud.attach()
    cloud.requestList()
    await Bun.sleep(0)

    gate.resolve(undefined)
    await Bun.sleep(0)

    expect(posts.find((item) => type(item) === "sessionUpdated")).toMatchObject({
      type: "sessionUpdated",
      session: {
        id: "ses_cloud",
        title: "Generated title",
        createdAt: "2023-11-14T22:13:20.000Z",
        updatedAt: "2023-11-14T22:16:40.000Z",
      },
    })
    expect(posts.map(type)).toEqual(["agentManager.cloudSessions", "agentManager.cloudSessions", "sessionUpdated"])
    cloud.dispose()
  })

  it("ignores an older title event after accepting newer listed metadata", async () => {
    const posts: unknown[] = []
    const gate = deferred<void>()
    const newer = { ...session(), title: "Newer", time: { ...session().time, updated: 1_700_000_300_000 } }
    const older = { ...session(), title: "Older", time: { ...session().time, updated: 1_700_000_200_000 } }
    const cloud = controller(
      remote({
        global: {
          event: async () => ({
            stream: (async function* () {
              await gate.promise
              for (const info of [newer, older]) {
                yield {
                  directory: cloudDirectory("ses_cloud"),
                  payload: { type: "session.updated", properties: { info } },
                } as GlobalEvent
              }
              await new Promise<void>(() => {})
            })(),
          }),
        },
      }),
      posts,
      { listSessions: async () => [session()] },
    )
    cloud.attach()
    cloud.requestList()
    await Bun.sleep(0)
    gate.resolve(undefined)
    await Bun.sleep(0)

    expect(
      posts
        .filter((item) => type(item) === "sessionUpdated")
        .map((item) => (item as { session: { title?: string } }).session.title),
    ).toEqual(["Newer"])
    cloud.dispose()
  })

  it("rejects session metadata whose routed and mapped IDs disagree", async () => {
    const posts: unknown[] = []
    const gate = deferred<void>()
    const cloud = controller(
      remote({
        global: {
          event: async () => ({
            stream: (async function* () {
              await gate.promise
              yield {
                directory: cloudDirectory("ses_cloud"),
                payload: {
                  type: "session.updated",
                  properties: { sessionID: "ses_cloud", info: session("ses_foreign") },
                },
              } as unknown as GlobalEvent
              await new Promise<void>(() => {})
            })(),
          }),
        },
      }),
      posts,
      { listSessions: async () => [session()] },
    )
    cloud.attach()
    cloud.requestList()
    await Bun.sleep(0)
    gate.resolve(undefined)
    await Bun.sleep(0)

    expect(posts.some((item) => type(item) === "sessionUpdated")).toBe(false)
    cloud.dispose()
  })

  it("converges the Cloud list and open tab from one facade title event", async () => {
    const posts: unknown[] = []
    const gate = deferred<void>()
    const live = { ...session(), title: "Generated title", time: { ...session().time, updated: 1_700_000_200_000 } }
    let store: SessionInfo[] = []
    let cloud!: CloudAgentController
    const state = createCloudSessionState({
      enabled: true,
      session: {
        currentSessionID: () => store[0]?.id,
        sessions: () => store,
        selectSession: () => {},
        clearCurrentSession: () => {},
        attachCloudSession: (next) => {
          store = [...store.filter((item) => item.id !== next.id), next]
        },
        detachCloudSession: (id) => {
          store = store.filter((item) => item.id !== id)
        },
      },
      postMessage: (message) => {
        cloud.handle(message)
      },
      setSelection: () => {},
      prepare: () => {},
    })
    const post = (message: unknown) => {
      posts.push(message)
      const output = message as ExtensionMessage
      if (output.type === "sessionUpdated") {
        store = [...store.filter((item) => item.id !== output.session.id), output.session]
      }
      state.handle(output)
    }
    cloud = controller(
      remote({
        global: {
          event: async () => ({
            stream: (async function* () {
              await gate.promise
              yield {
                directory: cloudDirectory("ses_cloud"),
                payload: { type: "session.updated", properties: { info: live } },
              } as GlobalEvent
              await new Promise<void>(() => {})
            })(),
          }),
        },
      }),
      posts,
      { listSessions: async () => [session()], post },
    )
    cloud.attach()
    cloud.requestList()
    await Bun.sleep(0)
    state.open(state.sessions()[0])

    gate.resolve(undefined)
    await Bun.sleep(0)

    expect(state.sessions()[0]?.title).toBe("Generated title")
    expect(state.tabs()[0]?.title).toBe("Generated title")
    cloud.dispose()
  })

  it("forwards an open-session event during discovery and admits it to the listed repository", async () => {
    const posts: unknown[] = []
    const listed = deferred<Session[]>()
    const live = { ...session(), title: "Live title", time: { ...session().time, updated: 1_700_000_200_000 } }
    const cloud = controller(
      remote({
        global: {
          event: async () => ({
            stream: (async function* () {
              yield {
                directory: cloudDirectory("ses_cloud"),
                payload: { type: "session.updated", properties: { info: live } },
              } as GlobalEvent
              await new Promise<void>(() => {})
            })(),
          }),
        },
      }),
      posts,
      { listSessions: async () => listed.promise },
    )
    cloud.attach()
    cloud.requestList()
    cloud.open("ses_cloud")
    await Bun.sleep(0)

    expect(posts.find((item) => type(item) === "sessionUpdated")).toMatchObject({
      session: { id: "ses_cloud", title: "Live title" },
    })
    expect(posts.some((item) => (item as { status?: string }).status === "ready")).toBe(false)

    listed.resolve([session()])
    await Bun.sleep(0)

    expect(posts.filter((item) => type(item) === "agentManager.cloudSessions").at(-1)).toMatchObject({
      status: "ready",
      sessions: [{ id: "ses_cloud", title: "Live title", updatedAt: "2023-11-14T22:16:40.000Z" }],
    })
    cloud.dispose()
  })

  it("buffers closed-session metadata until repository membership is admitted", async () => {
    const posts: unknown[] = []
    const listed = deferred<Session[]>()
    const live = { ...session(), title: "Buffered title" }
    const foreign = { ...session("ses_foreign"), title: "Foreign title" }
    const cloud = controller(
      remote({
        global: {
          event: async () => ({
            stream: (async function* () {
              for (const info of [live, foreign]) {
                yield {
                  directory: cloudDirectory(info.id),
                  payload: { type: "session.updated", properties: { info } },
                } as GlobalEvent
              }
              await new Promise<void>(() => {})
            })(),
          }),
        },
      }),
      posts,
      { listSessions: async () => listed.promise },
    )
    cloud.attach()
    cloud.requestList()
    await Bun.sleep(0)

    expect(posts.some((item) => type(item) === "sessionUpdated")).toBe(false)

    listed.resolve([session()])
    await Bun.sleep(0)

    expect(posts.filter((item) => type(item) === "sessionUpdated")).toHaveLength(1)
    expect(posts.filter((item) => type(item) === "agentManager.cloudSessions").at(-1)).toMatchObject({
      status: "ready",
      sessions: [{ id: "ses_cloud", title: "Buffered title" }],
    })
    cloud.dispose()
  })

  it("requests only sessions for the canonical current repository", async () => {
    const posts: unknown[] = []
    const calls: unknown[] = []
    const cloud = controller(remote(), posts, {
      listSessions: async (opts: unknown) => {
        calls.push(opts)
        return [session()]
      },
    })
    cloud.attach()

    cloud.requestList()
    await Bun.sleep(0)

    expect(calls).toEqual([
      {
        url: "https://cloud.example/kilo",
        token: "secret",
        gitUrl: "https://github.com/kilo-org/kilocode",
      },
    ])
    expect(posts.at(-1)).toMatchObject({ type: "agentManager.cloudSessions", status: "ready" })
  })

  for (const origin of [undefined, "https://example.com/acme/repo.git"]) {
    it(`publishes an empty list without facade discovery for unavailable origin ${String(origin)}`, async () => {
      const posts: unknown[] = []
      let lists = 0
      const cloud = controller(remote(), posts, {
        remoteUrl: async () => origin,
        listSessions: async () => {
          lists += 1
          return [session()]
        },
      })
      cloud.attach()

      cloud.requestList()
      await Bun.sleep(0)

      expect(lists).toBe(0)
      expect(posts).toEqual([
        { type: "agentManager.cloudSessions", status: "loading", sessions: [] },
        { type: "agentManager.cloudSessions", status: "ready", sessions: [] },
      ])
    })
  }

  it("publishes an empty error when repository lookup fails operationally", async () => {
    const posts: unknown[] = []
    const cloud = controller(remote(), posts, {
      remoteUrl: async () => {
        throw new Error("git unavailable")
      },
    })
    cloud.attach()

    cloud.requestList()
    await Bun.sleep(0)

    expect(posts).toEqual([
      { type: "agentManager.cloudSessions", status: "loading", sessions: [] },
      { type: "agentManager.cloudSessions", status: "error", sessions: [], error: "git unavailable" },
    ])
  })

  it("clears retained rows before discovering a different repository", async () => {
    const posts: unknown[] = []
    let origin = "git@github.com:Kilo-Org/kilocode.git"
    let lists = 0
    const cloud = controller(remote(), posts, {
      remoteUrl: async () => origin,
      listSessions: async () => {
        lists += 1
        if (lists === 1) return [session()]
        throw new Error("facade unavailable")
      },
    })
    cloud.attach()
    cloud.requestList()
    await Bun.sleep(0)

    origin = "git@github.com:Kilo-Org/other.git"
    cloud.requestList()
    await Bun.sleep(0)

    expect(posts.slice(-2)).toEqual([
      { type: "agentManager.cloudSessions", status: "loading", sessions: [] },
      { type: "agentManager.cloudSessions", status: "error", sessions: [], error: "facade unavailable" },
    ])
  })

  it("does not admit metadata from the previous repository scope", async () => {
    const posts: unknown[] = []
    const gate = deferred<void>()
    const next = deferred<Session[]>()
    let origin = "git@github.com:Kilo-Org/kilocode.git"
    let lists = 0
    const live = { ...session(), title: "Wrong scope", time: { ...session().time, updated: 1_700_000_200_000 } }
    const cloud = controller(
      remote({
        global: {
          event: async () => ({
            stream: (async function* () {
              await gate.promise
              yield {
                directory: cloudDirectory("ses_cloud"),
                payload: { type: "session.updated", properties: { info: live } },
              } as GlobalEvent
              await new Promise<void>(() => {})
            })(),
          }),
        },
      }),
      posts,
      {
        remoteUrl: async () => origin,
        listSessions: async () => (++lists === 1 ? [session()] : next.promise),
      },
    )
    cloud.attach()
    cloud.requestList()
    await Bun.sleep(0)

    origin = "git@github.com:Kilo-Org/other.git"
    cloud.requestList()
    await Bun.sleep(0)
    gate.resolve(undefined)
    await Bun.sleep(0)
    next.resolve([])
    await Bun.sleep(0)

    expect(posts.some((item) => type(item) === "sessionUpdated")).toBe(false)
    expect(posts.filter((item) => type(item) === "agentManager.cloudSessions").at(-1)).toMatchObject({
      status: "ready",
      sessions: [],
      repository: "Kilo-Org/other",
    })
    cloud.dispose()
  })

  it("publishes the owner/repository name used for discovery", async () => {
    const posts: unknown[] = []
    const cloud = controller(remote(), posts, { listSessions: async () => [] })
    cloud.attach()

    cloud.requestList()
    await Bun.sleep(0)

    expect(posts.at(-1)).toEqual({
      type: "agentManager.cloudSessions",
      status: "ready",
      sessions: [],
      repository: "Kilo-Org/kilocode",
    })
  })

  it("posts projected list summaries and ignores stale list completions", async () => {
    const posts: unknown[] = []
    const first = deferred<{ data: Session[] }>()
    const second = deferred<{ data: Session[] }>()
    let calls = 0
    const cloud = controller(
      remote({ session: { list: () => (++calls === 1 ? first.promise : second.promise) } }),
      posts,
    )
    cloud.attach()
    cloud.requestList()
    await Bun.sleep(0)
    cloud.requestList()
    await Bun.sleep(0)
    first.resolve({ data: [session("ses_old")] })
    second.resolve({ data: [session()] })
    await Bun.sleep(0)

    expect(posts.filter((item) => type(item) === "agentManager.cloudSessions")).toEqual([
      { type: "agentManager.cloudSessions", status: "loading", sessions: [] },
      { type: "agentManager.cloudSessions", status: "loading", sessions: [] },
      {
        type: "agentManager.cloudSessions",
        status: "ready",
        sessions: [
          {
            id: "ses_cloud",
            title: "Cloud run",
            createdAt: "2023-11-14T22:13:20.000Z",
            updatedAt: "2023-11-14T22:15:00.000Z",
          },
        ],
        repository: "Kilo-Org/kilocode",
      },
    ])
  })

  it("retains rows while refreshing and through transient errors", async () => {
    const posts: unknown[] = []
    let calls = 0
    const cloud = controller(
      remote({
        session: {
          list: async () => {
            calls += 1
            if (calls === 1) return { data: [session()] }
            throw new Error("facade unavailable")
          },
        },
      }),
      posts,
    )
    cloud.attach()
    cloud.requestList()
    await Bun.sleep(0)
    cloud.requestList()
    await Bun.sleep(0)

    const rows = [
      {
        id: "ses_cloud",
        title: "Cloud run",
        createdAt: "2023-11-14T22:13:20.000Z",
        updatedAt: "2023-11-14T22:15:00.000Z",
      },
    ]
    expect(posts.slice(-2)).toEqual([
      { type: "agentManager.cloudSessions", status: "loading", sessions: rows },
      { type: "agentManager.cloudSessions", status: "error", sessions: rows, error: "facade unavailable" },
    ])
  })

  it("keeps admitted metadata that arrives during a failed same-scope refresh", async () => {
    const posts: unknown[] = []
    const gate = deferred<void>()
    const refresh = deferred<Session[]>()
    const live = { ...session(), title: "Live during failure", time: { ...session().time, updated: 1_700_000_200_000 } }
    let lists = 0
    const cloud = controller(
      remote({
        global: {
          event: async () => ({
            stream: (async function* () {
              await gate.promise
              yield {
                directory: cloudDirectory("ses_cloud"),
                payload: { type: "session.updated", properties: { info: live } },
              } as GlobalEvent
              await new Promise<void>(() => {})
            })(),
          }),
        },
      }),
      posts,
      { listSessions: async () => (++lists === 1 ? [session()] : refresh.promise) },
    )
    cloud.attach()
    cloud.requestList()
    await Bun.sleep(0)

    cloud.requestList()
    await Bun.sleep(0)
    gate.resolve(undefined)
    await Bun.sleep(0)
    refresh.reject(new Error("facade unavailable"))
    await Bun.sleep(0)

    expect(posts.filter((item) => type(item) === "sessionUpdated")).toHaveLength(1)
    expect(posts.filter((item) => type(item) === "agentManager.cloudSessions").at(-1)).toMatchObject({
      status: "error",
      sessions: [{ id: "ses_cloud", title: "Live during failure" }],
    })
    cloud.dispose()
  })

  it("keeps a live title through a stale refresh and subsequent discovery error", async () => {
    const posts: unknown[] = []
    const gate = deferred<void>()
    const refresh = deferred<Session[]>()
    const live = { ...session(), title: "Live title", time: { ...session().time, updated: 1_700_000_200_000 } }
    let lists = 0
    const cloud = controller(
      remote({
        global: {
          event: async () => ({
            stream: (async function* () {
              await gate.promise
              yield {
                directory: cloudDirectory("ses_cloud"),
                payload: { type: "session.updated", properties: { info: live } },
              } as GlobalEvent
              await new Promise<void>(() => {})
            })(),
          }),
        },
      }),
      posts,
      {
        listSessions: async () => {
          lists += 1
          if (lists === 1) return [session()]
          if (lists === 2) return refresh.promise
          throw new Error("facade unavailable")
        },
      },
    )
    cloud.attach()
    cloud.requestList()
    await Bun.sleep(0)

    cloud.requestList()
    await Bun.sleep(0)
    gate.resolve(undefined)
    await Bun.sleep(0)
    refresh.resolve([session()])
    await Bun.sleep(0)

    expect(posts.filter((item) => type(item) === "agentManager.cloudSessions").at(-1)).toMatchObject({
      status: "ready",
      sessions: [{ id: "ses_cloud", title: "Live title" }],
    })

    cloud.requestList()
    await Bun.sleep(0)
    expect(posts.slice(-2)).toEqual([
      {
        type: "agentManager.cloudSessions",
        status: "loading",
        sessions: [
          {
            id: "ses_cloud",
            title: "Live title",
            createdAt: "2023-11-14T22:13:20.000Z",
            updatedAt: "2023-11-14T22:16:40.000Z",
          },
        ],
      },
      {
        type: "agentManager.cloudSessions",
        status: "error",
        sessions: [
          {
            id: "ses_cloud",
            title: "Live title",
            createdAt: "2023-11-14T22:13:20.000Z",
            updatedAt: "2023-11-14T22:16:40.000Z",
          },
        ],
        error: "facade unavailable",
      },
    ])
    cloud.dispose()
  })

  it("hides retained rows while the current repository scope is unresolved", async () => {
    const posts: unknown[] = []
    const next = deferred<string | undefined>()
    let origins = 0
    let lists = 0
    const cloud = controller(remote(), posts, {
      remoteUrl: () => (++origins === 1 ? Promise.resolve("git@github.com:Kilo-Org/kilocode.git") : next.promise),
      listSessions: async () => {
        lists += 1
        return [session()]
      },
    })
    cloud.attach()
    cloud.requestList()
    await Bun.sleep(0)

    cloud.requestList()
    await Bun.sleep(0)

    expect(lists).toBe(1)
    expect(posts.at(-1)).toEqual({ type: "agentManager.cloudSessions", status: "loading", sessions: [] })

    next.resolve("git@github.com:Kilo-Org/kilocode.git")
    await Bun.sleep(0)
    expect(lists).toBe(2)
  })

  it("restarts discovery when the workspace root changes during repository resolution", async () => {
    const posts: unknown[] = []
    const first = deferred<string | undefined>()
    const calls: unknown[] = []
    let root = "/first"
    let origins = 0
    const cloud = controller(remote(), posts, {
      getRoot: () => root,
      remoteUrl: () => (++origins === 1 ? first.promise : Promise.resolve("git@github.com:Kilo-Org/second.git")),
      listSessions: async (opts: unknown) => {
        calls.push(opts)
        return []
      },
    })
    cloud.attach()
    cloud.requestList()
    await Bun.sleep(0)

    root = "/second"
    first.resolve("git@github.com:Kilo-Org/first.git")
    await Bun.sleep(0)

    expect(calls).toEqual([
      {
        url: "https://cloud.example/kilo",
        token: "secret",
        gitUrl: "https://github.com/kilo-org/second",
      },
    ])
  })

  it("restarts discovery when the workspace root changes during facade listing", async () => {
    const posts: unknown[] = []
    const first = deferred<Session[]>()
    const calls: string[] = []
    let root = "/first"
    const cloud = controller(remote(), posts, {
      getRoot: () => root,
      remoteUrl: async (cwd: string) =>
        cwd === "/first" ? "git@github.com:Kilo-Org/first.git" : "git@github.com:Kilo-Org/second.git",
      listSessions: async (opts: { gitUrl: string }) => {
        calls.push(opts.gitUrl)
        if (calls.length === 1) return first.promise
        return []
      },
    })
    cloud.attach()
    cloud.requestList()
    await Bun.sleep(0)

    root = "/second"
    first.resolve([session("ses_old")])
    await Bun.sleep(0)

    expect(calls).toEqual(["https://github.com/kilo-org/first", "https://github.com/kilo-org/second"])
    expect(posts.at(-1)).toEqual({
      type: "agentManager.cloudSessions",
      status: "ready",
      sessions: [],
      repository: "Kilo-Org/second",
    })
  })

  it("does not republish retained rows when auth pauses after the workspace root changes", async () => {
    const posts: unknown[] = []
    const pending = deferred<Session[]>()
    let root = "/first"
    let lists = 0
    const cloud = controller(
      remote({
        command: {
          list: async () => {
            throw { status: 401 }
          },
        },
      }),
      posts,
      {
        getRoot: () => root,
        remoteUrl: async () => "git@github.com:Kilo-Org/first.git",
        listSessions: async () => {
          lists += 1
          if (lists === 1) return [session()]
          return pending.promise
        },
      },
    )
    cloud.attach()
    cloud.requestList()
    await Bun.sleep(0)
    cloud.requestList()
    await Bun.sleep(0)

    root = "/second"
    cloud.open("ses_cloud")
    cloud.handle({ type: "requestCommands", sessionID: "ses_cloud" })
    await Bun.sleep(0)

    expect(posts.filter((item) => type(item) === "agentManager.cloudSessions").at(-1)).toEqual({
      type: "agentManager.cloudSessions",
      status: "error",
      sessions: [],
      error: "Cloud Agent authentication could not be refreshed. Retry after signing in again.",
    })
  })

  it("does not republish retained rows when auth pauses during repository resolution", async () => {
    const posts: unknown[] = []
    const next = deferred<string | undefined>()
    let origins = 0
    const cloud = controller(
      remote({
        command: {
          list: async () => {
            throw { status: 401 }
          },
        },
      }),
      posts,
      {
        remoteUrl: () => (++origins === 1 ? Promise.resolve("git@github.com:Kilo-Org/kilocode.git") : next.promise),
        listSessions: async () => [session()],
      },
    )
    cloud.attach()
    cloud.requestList()
    await Bun.sleep(0)

    cloud.requestList()
    cloud.open("ses_cloud")
    cloud.handle({ type: "requestCommands", sessionID: "ses_cloud" })
    await Bun.sleep(0)

    expect(posts.filter((item) => type(item) === "agentManager.cloudSessions").at(-1)).toEqual({
      type: "agentManager.cloudSessions",
      status: "error",
      sessions: [],
      error: "Cloud Agent authentication could not be refreshed. Retry after signing in again.",
    })
  })

  it("publishes signed-out discovery without a generic retry error", async () => {
    const posts: unknown[] = []
    const cloud = new CloudAgentController({
      getLocalClient: () =>
        ({ kilo: { cloudAgent: { credentials: async () => ({ error: { status: 401 } }) } } }) as unknown as KiloClient,
      getRoot: () => "/workspace",
      remoteUrl: async () => "git@github.com:Kilo-Org/kilocode.git",
      post: (message) => posts.push(message),
      log: () => {},
      createClient: (() => remote()) as never,
    })
    cloud.attach()
    cloud.requestList()
    await Bun.sleep(0)

    expect(posts).toEqual([
      { type: "agentManager.cloudSessions", status: "loading", sessions: [] },
      { type: "agentManager.cloudSessions", status: "signed-out", sessions: [] },
    ])
  })

  it("explicit retry bypasses transient credential cooldown", async () => {
    const posts: unknown[] = []
    let calls = 0
    const cloud = new CloudAgentController({
      getLocalClient: () =>
        ({
          kilo: {
            cloudAgent: {
              credentials: async () => {
                calls += 1
                if (calls === 1) throw new Error("temporary credentials failure")
                return {
                  data: {
                    token: "secret",
                    expiresAt: new Date(Date.now() + 60_000).toISOString(),
                    kiloFacadeUrl: "https://cloud.example/kilo",
                    cloudAgentUrl: "https://cloud.example",
                  },
                }
              },
            },
          },
        }) as unknown as KiloClient,
      getRoot: () => "/workspace",
      remoteUrl: async () => "git@github.com:Kilo-Org/kilocode.git",
      post: (message) => posts.push(message),
      log: () => {},
      createClient: (() => remote()) as never,
      listSessions: async () => [],
    })
    cloud.attach()
    cloud.requestList()
    await Bun.sleep(0)
    cloud.requestList()
    await Bun.sleep(0)
    expect(calls).toBe(1)

    cloud.handle({ type: "agentManager.retryCloudSessions" })
    await Bun.sleep(0)
    expect(calls).toBe(2)
    expect(posts.at(-1)).toEqual({
      type: "agentManager.cloudSessions",
      status: "ready",
      sessions: [],
      repository: "Kilo-Org/kilocode",
    })
  })

  it("relocks open tabs and suppresses an in-flight load after disconnect", async () => {
    const posts: unknown[] = []
    const gate = deferred<{ data: Record<string, { type: "busy" }> }>()
    const cloud = controller(remote({ session: { status: () => gate.promise } }), posts)
    cloud.attach()
    cloud.open("ses_cloud")
    cloud.handle({ type: "loadMessages", sessionID: "ses_cloud" })
    await Bun.sleep(0)
    cloud.localDisconnected()
    gate.resolve({ data: { ses_cloud: { type: "busy" } } })
    await Bun.sleep(0)

    expect(posts).toEqual([{ type: "agentManager.cloudSessionsPending", sessionIDs: ["ses_cloud"] }])
  })

  it("authChanged aborts old stream, relocks, and starts fresh credentials", async () => {
    const posts: unknown[] = []
    const signals: AbortSignal[] = []
    const tokens: string[] = []
    let auth = 0
    const cloud = new CloudAgentController({
      getLocalClient: () => local(`secret-${++auth}`),
      getRoot: () => "/workspace",
      remoteUrl: async () => "git@github.com:Kilo-Org/kilocode.git",
      post: (message) => posts.push(message),
      log: () => {},
      createClient: ((opts: { headers?: Record<string, string> }) => {
        tokens.push(opts.headers?.Authorization ?? "")
        return remote({
          global: {
            event: async (event: { signal?: AbortSignal }) => {
              signals.push(event.signal!)
              return { stream: abortPending(event.signal) }
            },
          },
        })
      }) as never,
    })
    cloud.attach()
    cloud.open("ses_cloud")
    await Bun.sleep(0)
    cloud.authChanged()
    await Bun.sleep(0)

    expect(signals).toHaveLength(2)
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)
    expect(tokens).toEqual(["Bearer secret-1", "Bearer secret-2"])
    expect(posts).toContainEqual({ type: "agentManager.cloudSessionsPending", sessionIDs: ["ses_cloud"] })
  })

  it("loads authoritative status before transcript posts with forwarded options", async () => {
    const posts: unknown[] = []
    const calls: unknown[] = []
    const cloud = controller(
      remote({
        session: {
          get: async (input: unknown, opts: unknown) => {
            calls.push(["get", input, opts])
            return { data: session() }
          },
          messages: async (input: unknown, opts: unknown) => {
            calls.push(["messages", input, opts])
            return { data: [] }
          },
          status: async (input: unknown, opts: unknown) => {
            calls.push(["status", input, opts])
            return { data: { ses_cloud: { type: "busy" } } }
          },
        },
      }),
      posts,
    )
    cloud.attach()
    cloud.open("ses_cloud")
    cloud.handle({ type: "loadMessages", sessionID: "ses_cloud" })
    await Bun.sleep(0)

    expect(posts.map(type)).toEqual(["sessionStatus", "sessionUpdated", "messagesLoaded"])
    expect(posts[0]).toEqual({ type: "sessionStatus", sessionID: "ses_cloud", status: "busy" })
    expect(calls).toEqual([
      ["get", { sessionID: "ses_cloud", directory: cloudDirectory("ses_cloud") }, { throwOnError: true }],
      ["messages", { sessionID: "ses_cloud", directory: cloudDirectory("ses_cloud") }, { throwOnError: true }],
      ["status", { directory: cloudDirectory("ses_cloud") }, { throwOnError: true }],
    ])
  })

  it("repairs a listed summary from session detail hydration", async () => {
    const posts: unknown[] = []
    const fresh = { ...session(), title: "Hydrated title", time: { ...session().time, updated: 1_700_000_200_000 } }
    let lists = 0
    const cloud = controller(remote({ session: { get: async () => ({ data: fresh }) } }), posts, {
      listSessions: async () => {
        lists += 1
        if (lists === 1) return [session()]
        throw new Error("facade unavailable")
      },
    })
    cloud.attach()
    cloud.requestList()
    await Bun.sleep(0)
    cloud.open("ses_cloud")
    cloud.handle({ type: "loadMessages", sessionID: "ses_cloud" })
    await Bun.sleep(0)

    cloud.requestList()
    await Bun.sleep(0)

    expect(posts.filter((item) => type(item) === "agentManager.cloudSessions").at(-1)).toMatchObject({
      status: "error",
      sessions: [{ id: "ses_cloud", title: "Hydrated title" }],
    })
    cloud.dispose()
  })

  it("does not let equal-version detail hydration overwrite a newer live event", async () => {
    const posts: unknown[] = []
    const detail = deferred<{ data: Session }>()
    const gate = deferred<void>()
    const live = { ...session(), title: "Live title" }
    const cloud = controller(
      remote({
        session: { get: () => detail.promise },
        global: {
          event: async () => ({
            stream: (async function* () {
              await gate.promise
              yield {
                directory: cloudDirectory("ses_cloud"),
                payload: { type: "session.updated", properties: { info: live } },
              } as GlobalEvent
              await new Promise<void>(() => {})
            })(),
          }),
        },
      }),
      posts,
    )
    cloud.attach()
    cloud.open("ses_cloud")
    cloud.handle({ type: "loadMessages", sessionID: "ses_cloud" })
    await Bun.sleep(0)

    gate.resolve(undefined)
    await Bun.sleep(0)
    detail.resolve({ data: session() })
    await Bun.sleep(0)

    expect(
      posts
        .filter((item) => type(item) === "sessionUpdated")
        .map((item) => (item as { session: { title?: string } }).session.title),
    ).toEqual(["Live title"])
    expect(posts.map(type)).toContain("sessionStatus")
    expect(posts.map(type)).toContain("messagesLoaded")
    cloud.dispose()
  })

  it("publishes strictly newer detail hydration after an overlapping live event", async () => {
    const posts: unknown[] = []
    const detail = deferred<{ data: Session }>()
    const gate = deferred<void>()
    const live = { ...session(), title: "Live title", time: { ...session().time, updated: 1_700_000_200_000 } }
    const fresh = { ...session(), title: "Hydrated title", time: { ...session().time, updated: 1_700_000_300_000 } }
    const cloud = controller(
      remote({
        session: { get: () => detail.promise },
        global: {
          event: async () => ({
            stream: (async function* () {
              await gate.promise
              yield {
                directory: cloudDirectory("ses_cloud"),
                payload: { type: "session.updated", properties: { info: live } },
              } as GlobalEvent
              await new Promise<void>(() => {})
            })(),
          }),
        },
      }),
      posts,
    )
    cloud.attach()
    cloud.open("ses_cloud")
    cloud.handle({ type: "loadMessages", sessionID: "ses_cloud" })
    await Bun.sleep(0)

    gate.resolve(undefined)
    await Bun.sleep(0)
    detail.resolve({ data: fresh })
    await Bun.sleep(0)

    expect(
      posts
        .filter((item) => type(item) === "sessionUpdated")
        .map((item) => (item as { session: { title?: string } }).session.title),
    ).toEqual(["Live title", "Hydrated title"])
    cloud.dispose()
  })

  it("loads scoped commands from the owned remote session directory", async () => {
    const posts: unknown[] = []
    const calls: unknown[] = []
    const cloud = controller(
      remote({
        command: {
          list: async (input: unknown, opts: unknown) => {
            calls.push([input, opts])
            return {
              data: [
                {
                  name: "init",
                  description: "Initialize the repository",
                  source: "command",
                  hints: ["setup"],
                  template: "",
                },
              ],
            }
          },
        },
      }),
      posts,
    )
    cloud.attach()
    cloud.open("ses_cloud")

    expect(cloud.handle({ type: "requestCommands", sessionID: "ses_other" })).toBe(false)
    expect(cloud.handle({ type: "requestCommands", sessionID: "ses_cloud", requestID: 7 })).toBe(true)
    await Bun.sleep(0)

    expect(calls).toEqual([[{ directory: cloudDirectory("ses_cloud") }, { throwOnError: true }]])
    expect(posts).toContainEqual({
      type: "commandsLoaded",
      sessionID: "ses_cloud",
      requestID: 7,
      commands: [{ name: "init", description: "Initialize the repository", source: "command", hints: ["setup"] }],
    })
  })

  it("drops command discovery failures that settle after the cloud session closes", async () => {
    const posts: unknown[] = []
    const list = deferred<{ data: never[] }>()
    const cloud = controller(remote({ command: { list: () => list.promise } }), posts)
    cloud.attach()
    cloud.open("ses_cloud")
    cloud.handle({ type: "requestCommands", sessionID: "ses_cloud" })
    cloud.close("ses_cloud")
    list.reject(new Error("late list failure"))
    await Bun.sleep(0)

    expect(posts).toEqual([])
  })

  it("drops successful command discovery that settles after the cloud session closes", async () => {
    const posts: unknown[] = []
    const list = deferred<{ data: Array<{ name: string; hints: string[] }> }>()
    const cloud = controller(remote({ command: { list: () => list.promise } }), posts)
    cloud.attach()
    cloud.open("ses_cloud")
    cloud.handle({ type: "requestCommands", sessionID: "ses_cloud" })
    cloud.close("ses_cloud")
    list.resolve({ data: [{ name: "init", hints: [] }] })
    await Bun.sleep(0)

    expect(posts).toEqual([])
  })

  it("admits a cloud command through the remote facade and ignores its synthetic acknowledgement", async () => {
    const posts: unknown[] = []
    const calls: unknown[] = []
    const cloud = controller(
      remote({
        session: {
          command: async (input: unknown, opts: unknown) => {
            calls.push([input, opts])
            return { data: { info: { id: "msg_synthetic" }, parts: [] } }
          },
        },
      }),
      posts,
    )
    cloud.attach()
    cloud.open("ses_cloud")

    expect(
      cloud.handle({
        type: "sendCommand",
        sessionID: "ses_cloud",
        messageID: "msg_command",
        command: "review/security",
        arguments: "focus auth",
        providerID: "kilo",
        modelID: "kilo-auto",
        agent: "code",
        variant: "high",
      }),
    ).toBe(true)
    await Bun.sleep(0)

    expect(calls).toEqual([
      [
        {
          sessionID: "ses_cloud",
          directory: cloudDirectory("ses_cloud"),
          messageID: "msg_command",
          command: "review/security",
          arguments: "focus auth",
          model: "kilo/kilo-auto",
          agent: "code",
          variant: "high",
          snapshotInitialization: "wait",
        },
        { throwOnError: true },
      ],
    ])
    expect(posts).toEqual([])
  })

  it("allows the remote facade to resolve the default cloud command agent", async () => {
    const posts: unknown[] = []
    const calls: unknown[] = []
    const cloud = controller(
      remote({
        session: {
          command: async (input: unknown) => {
            calls.push(input)
            return { data: { info: { id: "msg_synthetic" }, parts: [] } }
          },
        },
      }),
      posts,
    )
    cloud.attach()
    cloud.open("ses_cloud")
    cloud.handle({
      type: "sendCommand",
      sessionID: "ses_cloud",
      command: "init",
      arguments: "",
      providerID: "kilo",
      modelID: "kilo-auto",
    })
    await Bun.sleep(0)

    expect(calls).toEqual([
      {
        sessionID: "ses_cloud",
        directory: cloudDirectory("ses_cloud"),
        command: "init",
        arguments: "",
        model: "kilo/kilo-auto",
        snapshotInitialization: "wait",
      },
    ])
    expect(posts).toEqual([])
  })

  it("restores cloud command text after remote admission rejects", async () => {
    const posts: unknown[] = []
    const cloud = controller(
      remote({
        session: {
          command: async () => {
            throw new Error("command rejected")
          },
        },
      }),
      posts,
    )
    cloud.attach()
    cloud.open("ses_cloud")
    cloud.handle({
      type: "sendCommand",
      sessionID: "ses_cloud",
      messageID: "msg_command",
      command: "review",
      arguments: "security",
      providerID: "kilo",
      modelID: "kilo-auto",
      agent: "code",
    })
    await Bun.sleep(5)

    expect(posts).toContainEqual({
      type: "sendMessageFailed",
      error: "command rejected",
      text: "/review security",
      sessionID: "ses_cloud",
      draftID: undefined,
      messageID: "msg_command",
      files: undefined,
    })
  })

  it("restores a cloud command after repeated remote authentication rejection", async () => {
    const posts: unknown[] = []
    let calls = 0
    const cloud = controller(
      remote({
        session: {
          command: async () => {
            calls += 1
            throw { status: 401 }
          },
        },
      }),
      posts,
    )
    cloud.attach()
    cloud.open("ses_cloud")
    cloud.handle({
      type: "sendCommand",
      sessionID: "ses_cloud",
      messageID: "msg_command",
      command: "review",
      arguments: "security",
      providerID: "kilo",
      modelID: "kilo-auto",
    })
    await Bun.sleep(5)

    expect(calls).toBe(2)
    expect(posts).toContainEqual(
      expect.objectContaining({
        type: "sendMessageFailed",
        text: "/review security",
        sessionID: "ses_cloud",
        messageID: "msg_command",
      }),
    )
  })

  it("does not roll back a command after Cloud Agent confirms durable admission", async () => {
    const posts: unknown[] = []
    const queued = deferred<GlobalEvent>()
    const request = deferred<never>()
    const cloud = controller(
      remote({
        session: { command: async () => request.promise },
        global: {
          event: async () => ({
            stream: (async function* () {
              yield await queued.promise
              await new Promise<void>(() => {})
            })(),
          }),
        },
      }),
      posts,
    )
    cloud.attach()
    cloud.open("ses_cloud")
    cloud.handle({
      type: "sendCommand",
      sessionID: "ses_cloud",
      messageID: "msg_command",
      command: "init",
      arguments: "",
      providerID: "kilo",
      modelID: "kilo-auto",
    })
    await Bun.sleep(0)
    queued.resolve({
      directory: cloudDirectory("ses_cloud"),
      payload: {
        type: "cloud.message.queued",
        properties: { sessionID: "ses_cloud", messageId: "msg_command", delivery: "queued" },
      },
    } as unknown as GlobalEvent)
    await Bun.sleep(0)
    request.reject(new Error("transport failed after admission"))
    await Bun.sleep(0)

    expect(posts.filter((item) => type(item) === "sendMessageFailed")).toEqual([])
    cloud.dispose()
  })

  it("does not roll back a pending command after its cloud session closes", async () => {
    const posts: unknown[] = []
    const request = deferred<never>()
    const cloud = controller(remote({ session: { command: async () => request.promise } }), posts)
    cloud.attach()
    cloud.open("ses_cloud")
    cloud.handle({
      type: "sendCommand",
      sessionID: "ses_cloud",
      messageID: "msg_command",
      command: "init",
      arguments: "",
      providerID: "kilo",
      modelID: "kilo-auto",
    })
    await Bun.sleep(0)
    cloud.close("ses_cloud")
    request.reject(new Error("transport failed after close"))
    await Bun.sleep(5)

    expect(posts.filter((item) => type(item) === "sendMessageFailed")).toEqual([])
  })

  it("confirms pending commands from an authoritative transcript snapshot", async () => {
    const posts: unknown[] = []
    const request = deferred<never>()
    const cloud = controller(
      remote({
        session: {
          command: async () => request.promise,
          messages: async () => ({
            data: [
              {
                info: {
                  id: "msg_command",
                  sessionID: "ses_cloud",
                  role: "user",
                  time: { created: 1_700_000_000_000 },
                  agent: "code",
                  model: { providerID: "kilo", modelID: "kilo-auto" },
                },
                parts: [],
              },
            ],
          }),
        },
      }),
      posts,
    )
    cloud.attach()
    cloud.open("ses_cloud")
    cloud.handle({
      type: "sendCommand",
      sessionID: "ses_cloud",
      messageID: "msg_command",
      command: "init",
      arguments: "",
      providerID: "kilo",
      modelID: "kilo-auto",
    })
    cloud.handle({ type: "loadMessages", sessionID: "ses_cloud" })
    await Bun.sleep(0)
    request.reject(new Error("transport failed after snapshot"))
    await Bun.sleep(0)

    expect(posts.filter((item) => type(item) === "sendMessageFailed")).toEqual([])
    cloud.dispose()
  })

  it("rejects cloud command attachments before remote admission", async () => {
    const posts: unknown[] = []
    let calls = 0
    const cloud = controller(
      remote({
        session: {
          command: async () => {
            calls += 1
            return { data: undefined }
          },
        },
      }),
      posts,
    )
    cloud.attach()
    cloud.open("ses_cloud")
    cloud.handle({
      type: "sendCommand",
      sessionID: "ses_cloud",
      command: "review",
      arguments: "security",
      providerID: "kilo",
      modelID: "kilo-auto",
      agent: "code",
      files: [{ type: "file" }],
    })
    await Bun.sleep(0)

    expect(calls).toBe(0)
    expect(posts).toContainEqual({
      type: "sendMessageFailed",
      error: "Cloud Agent commands require a Kilo model and do not support attachments",
      text: "/review security",
      sessionID: "ses_cloud",
      draftID: undefined,
      messageID: undefined,
      files: [{ type: "file" }],
    })
  })

  it("does not publish idle fallback when status hydration is unavailable", async () => {
    const posts: unknown[] = []
    const cloud = controller(remote({ session: { status: async () => ({ data: undefined }) } }), posts)
    cloud.attach()
    cloud.open("ses_cloud")
    cloud.handle({ type: "loadMessages", sessionID: "ses_cloud" })
    await Bun.sleep(0)
    expect(posts).toEqual([
      { type: "error", sessionID: "ses_cloud", message: "Cloud Agent status response is missing data" },
    ])
  })

  it("relocks before ordinary reconnect delay, stages hydration, and drains queued load", async () => {
    const posts: unknown[] = []
    const wait = deferred<void>()
    const hydrate = deferred<{ data: Record<string, { type: "idle" }> }>()
    let streams = 0
    let statuses = 0
    let prompts = 0
    let commands = 0
    const cloud = controller(
      remote({
        session: {
          status: async () => {
            statuses += 1
            return statuses === 1 ? hydrate.promise : { data: {} }
          },
          promptAsync: async () => {
            prompts += 1
            return { data: undefined }
          },
          command: async () => {
            commands += 1
            return { data: undefined }
          },
        },
        global: {
          event: async (opts: { onSseEvent?: (event: unknown) => void }) => {
            streams += 1
            if (streams === 1) return { stream: (async function* () {})() }
            opts.onSseEvent?.({ data: undefined })
            return { stream: pending() }
          },
        },
      }),
      posts,
      { wait: async () => wait.promise },
    )
    cloud.attach()
    cloud.open("ses_cloud")
    await Bun.sleep(0)
    expect(posts).toContainEqual({ type: "agentManager.cloudSessionsPending", sessionIDs: ["ses_cloud"] })

    cloud.handle({ type: "loadMessages", sessionID: "ses_cloud" })
    cloud.handle({
      type: "sendMessage",
      sessionID: "ses_cloud",
      text: "continue",
      providerID: "kilo",
      modelID: "model",
      agent: "code",
    })
    cloud.handle({
      type: "sendCommand",
      sessionID: "ses_cloud",
      command: "init",
      arguments: "",
      providerID: "kilo",
      modelID: "model",
    })
    expect(statuses).toBe(0)
    expect(prompts).toBe(0)
    expect(commands).toBe(0)
    expect(posts).toContainEqual({
      type: "sendMessageFailed",
      error: "Cloud Agent connection is not ready. Retry after reconnecting.",
      text: "continue",
      sessionID: "ses_cloud",
      draftID: undefined,
      messageID: undefined,
      files: undefined,
    })
    expect(posts).toContainEqual({
      type: "sendMessageFailed",
      error: "Cloud Agent connection is not ready. Retry after reconnecting.",
      text: "/init",
      sessionID: "ses_cloud",
      draftID: undefined,
      messageID: undefined,
      files: undefined,
    })

    wait.resolve(undefined)
    await Bun.sleep(0)
    expect(statuses).toBe(1)
    hydrate.resolve({ data: {} })
    await Bun.sleep(0)
    expect(statuses).toBe(2)
    expect(posts.filter((item) => type(item) === "messagesLoaded")).toHaveLength(2)
    cloud.dispose()
  })

  it("keeps the replacement stream attached when one open session fails hydration", async () => {
    const posts: unknown[] = []
    const reconnect = deferred<void>()
    const stopped = deferred<void>()
    const signals: AbortSignal[] = []
    let waits = 0
    const cloud = controller(
      remote({
        session: {
          get: async (input: { sessionID: string }) => {
            if (input.sessionID === "ses_failed") throw new Error("session unavailable")
            return { data: session(input.sessionID) }
          },
          status: async (input: { directory: string }) => {
            const id = input.directory.split("/").at(-1)!
            return { data: { [id]: { type: "idle" } } }
          },
        },
        global: {
          event: async (opts: { signal?: AbortSignal; onSseEvent?: () => void }) => {
            signals.push(opts.signal!)
            if (signals.length === 1) return { stream: (async function* () {})() }
            opts.onSseEvent?.()
            return { stream: abortPending(opts.signal) }
          },
        },
      }),
      posts,
      { wait: () => (++waits === 1 ? reconnect.promise : stopped.promise) },
    )
    cloud.attach()
    cloud.open("ses_failed")
    cloud.open("ses_ready")
    await Bun.sleep(0)
    reconnect.resolve(undefined)
    await Bun.sleep(0)
    await Bun.sleep(0)

    expect(signals).toHaveLength(2)
    expect(signals[1]?.aborted).toBe(false)
    expect(posts).toContainEqual({
      type: "messagesLoaded",
      sessionID: "ses_ready",
      messages: [],
      mode: "replace",
      hasMore: false,
    })
    expect(posts.filter((item) => type(item) === "error")).toEqual([
      { type: "error", sessionID: "ses_failed", message: "session unavailable" },
    ])
    cloud.dispose()
  })

  it("reconnects before unresolved hydration buffers unbounded events", async () => {
    const posts: unknown[] = []
    let streams = 0
    const event = {
      directory: cloudDirectory("ses_cloud"),
      payload: {
        type: "message.part.updated",
        properties: {
          part: { id: "part_1", sessionID: "ses_cloud", messageID: "msg_1", type: "text", text: "delta" },
        },
      },
    }
    const cloud = controller(
      remote({
        session: { status: async () => new Promise<never>(() => {}) },
        global: {
          event: async (opts: { signal?: AbortSignal; onSseEvent?: () => void }) => {
            streams += 1
            if (streams === 1) return { stream: (async function* () {})() }
            opts.onSseEvent?.()
            if (streams > 2) return { stream: abortPending(opts.signal) }
            return {
              stream: (async function* () {
                for (const _ of Array.from({ length: 1_001 })) yield event
              })(),
            }
          },
        },
      }),
      posts,
      { wait: async () => {} },
    )
    cloud.attach()
    cloud.open("ses_cloud")

    for (const _ of Array.from({ length: 20 })) {
      if (streams > 2) break
      await Bun.sleep(0)
    }

    expect(streams).toBeGreaterThan(2)
    cloud.dispose()
  })

  it("forwards cloud status while replacement hydration remains unresolved", async () => {
    const posts: unknown[] = []
    const wait = deferred<void>()
    const hydrate = deferred<{ data: Record<string, { type: "idle" }> }>()
    let streams = 0
    const event = {
      directory: cloudDirectory("ses_cloud"),
      payload: {
        type: "cloud.status",
        properties: { sessionID: "ses_cloud", cloudStatus: { type: "preparing", step: "cloning" } },
      },
    }
    const cloud = controller(
      remote({
        session: { status: () => hydrate.promise },
        global: {
          event: async (opts: { onSseEvent?: (event: unknown) => void }) => {
            streams += 1
            if (streams === 1) return { stream: (async function* () {})() }
            opts.onSseEvent?.({ data: undefined })
            return {
              stream: (async function* () {
                yield event
                await new Promise<void>(() => {})
              })(),
            }
          },
        },
      }),
      posts,
      { wait: async () => wait.promise },
    )
    cloud.attach()
    cloud.open("ses_cloud")
    await Bun.sleep(0)
    wait.resolve(undefined)
    await Bun.sleep(0)

    expect(posts).toEqual([
      { type: "agentManager.cloudSessionsPending", sessionIDs: ["ses_cloud"] },
      {
        type: "agentManager.cloudStatus",
        sessionID: "ses_cloud",
        cloudStatus: { type: "preparing", step: "cloning" },
      },
    ])
    cloud.dispose()
  })

  it("forwards pre-delivery failure while replacement hydration remains unresolved", async () => {
    const posts: unknown[] = []
    const wait = deferred<void>()
    const hydrate = deferred<{ data: Record<string, { type: "idle" }> }>()
    let streams = 0
    const event = {
      directory: cloudDirectory("ses_cloud"),
      payload: {
        type: "cloud.message.failed",
        properties: {
          sessionID: "ses_cloud",
          messageId: "msg_cloud",
          status: "interrupted",
          delivery: "queued",
          accepted: false,
        },
      },
    }
    const cloud = controller(
      remote({
        session: { status: () => hydrate.promise },
        global: {
          event: async (opts: { onSseEvent?: (event: unknown) => void }) => {
            streams += 1
            if (streams === 1) return { stream: (async function* () {})() }
            opts.onSseEvent?.({ data: undefined })
            return {
              stream: (async function* () {
                yield event
                await new Promise<void>(() => {})
              })(),
            }
          },
        },
      }),
      posts,
      { wait: async () => wait.promise },
    )
    cloud.attach()
    cloud.open("ses_cloud")
    await Bun.sleep(0)
    wait.resolve(undefined)
    await Bun.sleep(0)

    expect(posts).toEqual([
      { type: "agentManager.cloudSessionsPending", sessionIDs: ["ses_cloud"] },
      {
        type: "agentManager.cloudMessageFailed",
        sessionID: "ses_cloud",
        messageID: "msg_cloud",
        status: "interrupted",
      },
    ])
    cloud.dispose()
  })

  it("buffers replacement stream events until staged hydration completes", async () => {
    const posts: unknown[] = []
    const wait = deferred<void>()
    const hydrate = deferred<{ data: Record<string, { type: "idle" }> }>()
    let streams = 0
    const event = {
      directory: cloudDirectory("ses_cloud"),
      payload: {
        id: "evt_part",
        type: "message.part.updated",
        properties: { part: { id: "part_1", sessionID: "ses_cloud", messageID: "msg_1", type: "text", text: "delta" } },
      },
    }
    const cloud = controller(
      remote({
        session: { status: () => hydrate.promise },
        global: {
          event: async (opts: { onSseEvent?: (event: unknown) => void }) => {
            streams += 1
            if (streams === 1) return { stream: (async function* () {})() }
            opts.onSseEvent?.({ data: undefined })
            return {
              stream: (async function* () {
                yield event
                await new Promise<void>(() => {})
              })(),
            }
          },
        },
      }),
      posts,
      { wait: async () => wait.promise },
    )
    cloud.attach()
    cloud.open("ses_cloud")
    await Bun.sleep(0)
    wait.resolve(undefined)
    await Bun.sleep(0)
    expect(posts.map(type)).toEqual(["agentManager.cloudSessionsPending"])
    hydrate.resolve({ data: {} })
    await Bun.sleep(0)
    expect(posts.map(type)).toEqual([
      "agentManager.cloudSessionsPending",
      "sessionStatus",
      "sessionUpdated",
      "messagesLoaded",
      "partUpdated",
    ])
    cloud.dispose()
  })

  it("aborts a replacement attempt when hydrate exceeds heartbeat deadline", async () => {
    const posts: unknown[] = []
    const signals: AbortSignal[] = []
    let streams = 0
    const cloud = controller(
      remote({
        session: {
          status: async (_input: unknown, opts: { signal?: AbortSignal }) => {
            signals.push(opts.signal!)
            await new Promise<void>(() => {})
            return { data: {} }
          },
        },
        global: {
          event: async (opts: { signal?: AbortSignal; onSseEvent?: (event: unknown) => void }) => {
            streams += 1
            if (streams === 1) return { stream: (async function* () {})() }
            opts.onSseEvent?.({ data: undefined })
            return { stream: abortPending(opts.signal) }
          },
        },
      }),
      posts,
      { wait: async () => {}, heartbeat: 1 },
    )
    cloud.attach()
    cloud.open("ses_cloud")
    await Bun.sleep(10)
    expect(signals[0]?.aborted).toBe(true)
    expect(streams).toBeGreaterThan(2)
    cloud.dispose()
  })

  it("comment-only SSE callbacks keep the heartbeat watchdog alive", async () => {
    const posts: unknown[] = []
    const signals: AbortSignal[] = []
    const cloud = controller(
      remote({
        global: {
          event: async (opts: { signal?: AbortSignal; onSseEvent?: (event: unknown) => void }) => {
            signals.push(opts.signal!)
            return {
              stream: (async function* () {
                await Bun.sleep(3)
                opts.onSseEvent?.({ data: undefined })
                await Bun.sleep(3)
                opts.onSseEvent?.({ data: undefined })
                await new Promise<void>((resolve) =>
                  opts.signal?.addEventListener("abort", () => resolve(), { once: true }),
                )
              })(),
            }
          },
        },
      }),
      posts,
      { wait: async () => {}, heartbeat: 5 },
    )
    cloud.attach()
    cloud.open("ses_cloud")
    await Bun.sleep(7)
    expect(signals).toHaveLength(1)
    expect(signals[0]?.aborted).toBe(false)
    await Bun.sleep(7)
    expect(signals.length).toBeGreaterThan(1)
    cloud.dispose()
  })

  it("pauses repeated remote REST unauthorized recovery until explicit retry", async () => {
    const posts: unknown[] = []
    let auth = 0
    const cloud = new CloudAgentController({
      getLocalClient: () => local(`secret-${++auth}`),
      getRoot: () => "/workspace",
      remoteUrl: async () => "git@github.com:Kilo-Org/kilocode.git",
      post: (message) => posts.push(message),
      log: () => {},
      createClient: (() => remote()) as never,
      listSessions: async () => {
        throw { status: 401 }
      },
    })
    cloud.attach()
    cloud.requestList()
    await Bun.sleep(0)
    expect(auth).toBe(2)
    cloud.requestList()
    expect(posts.at(-1)).toEqual({
      type: "agentManager.cloudSessions",
      status: "error",
      sessions: [],
      error: "Cloud Agent authentication could not be refreshed. Retry after signing in again.",
    })
    cloud.handle({ type: "agentManager.retryCloudSessions" })
    await Bun.sleep(0)
    expect(auth).toBe(4)
  })

  it("restores a known rejected send immediately", async () => {
    const posts: unknown[] = []
    const cloud = controller(
      remote({
        session: {
          promptAsync: async () => {
            throw new Error("prompt rejected")
          },
        },
      }),
      posts,
    )
    cloud.attach()
    cloud.open("ses_cloud")
    cloud.handle({
      type: "sendMessage",
      sessionID: "ses_cloud",
      messageID: "msg_1",
      text: "continue",
      providerID: "kilo",
      modelID: "model",
      agent: "code",
    })
    await Bun.sleep(0)
    expect(posts).toContainEqual({
      type: "sendMessageFailed",
      error: "prompt rejected",
      text: "continue",
      sessionID: "ses_cloud",
      draftID: undefined,
      messageID: "msg_1",
      files: undefined,
    })
  })

  for (const kind of ["permission.asked", "question.asked", "suggestion.shown"]) {
    it(`posts an explanatory error and aborts ${kind} once while stop remains in flight`, async () => {
      const posts: unknown[] = []
      const stop = deferred<{ data: boolean }>()
      let calls = 0
      const event = {
        directory: cloudDirectory("ses_cloud"),
        payload: { id: `evt_${kind}`, type: kind, properties: { sessionID: "ses_cloud" } },
      } as GlobalEvent
      const cloud = controller(
        remote({
          session: {
            abort: () => {
              calls += 1
              return stop.promise
            },
          },
          global: {
            event: async () => ({
              stream: (async function* () {
                yield event
                yield event
                await new Promise<void>(() => {})
              })(),
            }),
          },
        }),
        posts,
      )
      cloud.attach()
      cloud.open("ses_cloud")
      await Bun.sleep(0)
      expect(calls).toBe(1)
      expect(posts.filter((item) => type(item) === "error")).toEqual([
        {
          type: "error",
          sessionID: "ses_cloud",
          message: "Cloud Agent session stopped because interactive requests are not supported in VS Code yet.",
        },
        {
          type: "error",
          sessionID: "ses_cloud",
          message: "Cloud Agent session stopped because interactive requests are not supported in VS Code yet.",
        },
      ])
      stop.resolve({ data: true })
      cloud.dispose()
    })
  }

  it("aborts unsupported interactions immediately while reconnect hydration is pending", async () => {
    const posts: unknown[] = []
    const detail = deferred<{ data: Session }>()
    let streams = 0
    let calls = 0
    const event = {
      directory: cloudDirectory("ses_cloud"),
      payload: { id: "evt_permission", type: "permission.asked", properties: { sessionID: "ses_cloud" } },
    } as GlobalEvent
    const cloud = controller(
      remote({
        session: {
          get: () => detail.promise,
          abort: async () => {
            calls += 1
            return { data: true }
          },
        },
        global: {
          event: async (opts: { onSseEvent?: () => void }) => {
            streams += 1
            if (streams === 1) return { stream: (async function* () {})() }
            return {
              stream: (async function* () {
                opts.onSseEvent?.()
                yield event
                await new Promise<void>(() => {})
              })(),
            }
          },
        },
      }),
      posts,
      { wait: async () => {} },
    )
    cloud.attach()
    cloud.open("ses_cloud")
    await Bun.sleep(0)
    await Bun.sleep(0)

    expect(calls).toBe(1)
    expect(posts).toContainEqual({
      type: "error",
      sessionID: "ses_cloud",
      message: "Cloud Agent session stopped because interactive requests are not supported in VS Code yet.",
    })
    cloud.dispose()
  })

  it("forwards sanitized cloud status for an open session", async () => {
    const posts: unknown[] = []
    const cloud = controller(
      remote({
        global: {
          event: async () => ({
            stream: (async function* () {
              yield {
                directory: cloudDirectory("ses_cloud"),
                payload: {
                  id: "evt_status",
                  type: "cloud.status",
                  properties: {
                    sessionID: "ses_cloud",
                    cloudStatus: { type: "preparing", step: "workspace_setup", detail: "secret" },
                  },
                },
              }
              await new Promise<void>(() => {})
            })(),
          }),
        },
      }),
      posts,
    )
    cloud.attach()
    cloud.open("ses_cloud")
    await Bun.sleep(0)

    expect(posts).toEqual([
      {
        type: "agentManager.cloudStatus",
        sessionID: "ses_cloud",
        cloudStatus: { type: "preparing", step: "workspace_setup" },
      },
    ])
    cloud.dispose()
  })

  it("forwards sanitized pre-delivery failure for an open session", async () => {
    const posts: unknown[] = []
    const cloud = controller(
      remote({
        global: {
          event: async () => ({
            stream: (async function* () {
              yield {
                directory: cloudDirectory("ses_cloud"),
                payload: {
                  type: "cloud.message.failed",
                  properties: {
                    sessionID: "ses_cloud",
                    messageId: "msg_cloud",
                    status: "failed",
                    delivery: "queued",
                    accepted: false,
                    error: "secret",
                  },
                },
              }
              yield {
                directory: cloudDirectory("ses_cloud"),
                payload: {
                  type: "cloud.message.failed",
                  properties: {
                    sessionID: "ses_cloud",
                    messageId: "msg_accepted",
                    status: "failed",
                    delivery: "sent",
                    accepted: true,
                  },
                },
              }
              await new Promise<void>(() => {})
            })(),
          }),
        },
      }),
      posts,
    )
    cloud.attach()
    cloud.open("ses_cloud")
    await Bun.sleep(0)

    expect(posts).toEqual([
      {
        type: "agentManager.cloudMessageFailed",
        sessionID: "ses_cloud",
        messageID: "msg_cloud",
        status: "failed",
      },
    ])
    cloud.dispose()
  })

  it("ignores cloud status for closed sessions and malformed open-session statuses", async () => {
    const posts: unknown[] = []
    const cloud = controller(
      remote({
        global: {
          event: async () => ({
            stream: (async function* () {
              yield {
                directory: cloudDirectory("ses_closed"),
                payload: {
                  type: "cloud.status",
                  properties: { sessionID: "ses_closed", cloudStatus: { type: "ready" } },
                },
              }
              yield {
                directory: cloudDirectory("ses_cloud"),
                payload: {
                  type: "cloud.status",
                  properties: { sessionID: "ses_cloud", cloudStatus: { type: "unknown" } },
                },
              }
              await new Promise<void>(() => {})
            })(),
          }),
        },
      }),
      posts,
    )
    cloud.attach()
    cloud.open("ses_cloud")
    await Bun.sleep(0)

    expect(posts).toEqual([])
    cloud.dispose()
  })

  it("routes owned incremental events and tombstones deleted sessions", async () => {
    const posts: unknown[] = []
    const cloud = controller(
      remote({
        global: {
          event: async () => ({
            stream: (async function* () {
              yield {
                directory: cloudDirectory("ses_cloud"),
                payload: {
                  id: "evt_part",
                  type: "message.part.updated",
                  properties: {
                    part: { id: "part_1", sessionID: "ses_cloud", messageID: "msg_1", type: "text", text: "delta" },
                  },
                },
              }
              yield {
                directory: cloudDirectory("ses_cloud"),
                payload: {
                  id: "evt_deleted",
                  type: "session.deleted",
                  properties: { sessionID: "ses_cloud", info: session() },
                },
              }
            })(),
          }),
        },
      }),
      posts,
    )
    cloud.attach()
    cloud.open("ses_cloud")
    await Bun.sleep(0)
    expect(posts.map(type)).toEqual([
      "partUpdated",
      "agentManager.cloudSessionDeleted",
      "sessionDeleted",
      "agentManager.cloudSessions",
      "agentManager.cloudSessions",
    ])
    expect(cloud.owns("ses_cloud")).toBe(true)
    expect(cloud.handle({ type: "loadMessages", sessionID: "ses_cloud" })).toBe(true)
    cloud.close("ses_cloud")
    expect(cloud.owns("ses_cloud")).toBe(false)
  })
})
