// Regression: the real continuation route must acknowledge the full transcript
// with only the request's Effect instance — no ambient AsyncLocalStorage.
//
// The route resolves the worktree with InstanceStore; the acknowledged sync
// crosses an Effect→Promise→AppRuntime boundary where the request fiber is gone.
// This drives the real handler, the real syncForContinuation/fullSync, and a
// local fake ingest/Cloud boundary, and asserts every message/part/diff is
// acknowledged before the provider dispatch (and never on failure).
process.env["KILO_DISABLE_SESSION_INGEST"] = "0"
delete process.env["KILO_DISABLE_SHARE"]

import { SessionHostApi, SessionHostPaths } from "@/kilocode/server/httpapi/groups/session-host"
import { sessionHostHandlers } from "@/kilocode/server/httpapi/handlers/session-host"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { schemaErrorLayer } from "@/server/routes/instance/httpapi/middleware/schema-error"
import { InstanceRef } from "@/effect/instance-ref"
import { AppRuntime } from "@/effect/app-runtime"
import { Auth } from "@/auth"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionHost } from "@/kilocode/session-hosting"
import { CloudRepository } from "@/kilocode/cloud/repository"
import type { InstanceContext } from "@/project/instance-context"
import { context as instanceContext } from "@/project/instance-context"
import { InstanceStore } from "@/project/instance-store"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { Storage } from "@/storage/storage"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Database } from "@opencode-ai/core/database/database"
import { afterAll, expect, spyOn } from "bun:test"
import { $ } from "bun"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi"
import { NodeHttpServer } from "@effect/platform-node"
import fs from "fs/promises"
import path from "path"
import { testEffect } from "../../lib/effect"
import { tmpdir } from "../../fixture/fixture"

const TOKEN = "continuation-route-token"
const ACCOUNT = "oauth/route-account"
const ORG = "11111111-1111-4111-8111-111111111111"

interface Relay {
  ingest: Map<string, { data: { type: string }[] }>
  order: string[]
  body: unknown
  sessionStatus: number
  ingestStatus: number
}

const relay: Relay = { ingest: new Map(), order: [], body: undefined, sessionStatus: 200, ingestStatus: 200 }

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    const text = request.method === "POST" ? await request.text() : ""
    if (url.pathname === "/api/user") return new Response(null, { status: 200 })
    if (url.pathname === "/api/profile") return Response.json({ user: { id: ACCOUNT } })
    if (url.pathname === "/api/defaults") return Response.json({ defaultModel: "test/fake" })
    if (url.pathname === "/api/cloud-agent-next/token") {
      return Response.json({ token: "control-token", expiresAt: new Date(Date.now() + 600_000).toISOString() })
    }
    if (url.pathname === "/api/session") {
      if (relay.sessionStatus !== 200) return new Response(null, { status: relay.sessionStatus })
      const body = JSON.parse(text || "{}") as { sessionId?: string }
      const id = body.sessionId ?? "unknown"
      return Response.json({ id: `share-${id}`, ingestPath: `/ingest/${id}` })
    }
    if (url.pathname.startsWith("/ingest/")) {
      const id = url.pathname.split("/ingest/")[1]!
      relay.order.push(`ingest:${id}`)
      if (relay.ingestStatus !== 200) return new Response(null, { status: relay.ingestStatus })
      relay.ingest.set(id, JSON.parse(text || "{}") as { data: { type: string }[] })
      return new Response("{}", { status: 200 })
    }
    if (url.pathname === "/trpc/continueHostedWorkspace") {
      const body = JSON.parse(text || "{}") as {
        sessions: { sourceKiloSessionId: string }[]
        activeSourceKiloSessionId: string
      }
      relay.order.push("continue")
      relay.body = body
      const sessions = body.sessions.map((session, index) => ({
        sourceKiloSessionId: session.sourceKiloSessionId,
        kiloSessionId: `ses_destination_${index}`,
        cloudAgentSessionId: `cloud_${index}`,
        agent: { mode: "code", model: "test/fake" },
        modeFallback: false,
      }))
      const active = sessions.find((session) => session.sourceKiloSessionId === body.activeSourceKiloSessionId)
      return Response.json({
        result: { data: { workspaceId: "ws_route", sessions, activeKiloSessionId: active?.kiloSessionId } },
      })
    }
    return new Response(null, { status: 404 })
  },
})

process.env["KILO_API_KEY"] = TOKEN
process.env["KILO_SESSION_INGEST_URL"] = server.url.origin
process.env["KILO_API_URL"] = server.url.origin
process.env["CLOUD_AGENT_NEXT_BASE_URL"] = server.url.origin
process.env["KILO_WEB_APP_URL"] = server.url.origin
process.env["KILO_ORG_ID"] = ORG

// The Kilo API base is captured at module load from KILO_API_URL, so auth checks
// may still target the default origin. Map that origin onto the local server.
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (raw.startsWith("https://api.kilo.ai")) {
    return realFetch(`${server.url.origin}${raw.slice("https://api.kilo.ai".length)}`, init)
  }
  return realFetch(input, init)
}) as unknown as typeof fetch

function auth() {
  const info = new Auth.Api({ type: "api", key: TOKEN })
  return {
    get: (id: string) => Effect.succeed(id === "kilo" ? info : undefined),
    all: () => Effect.succeed<Record<string, Auth.Info>>({ kilo: info }),
    set: () => Effect.void,
    remove: () => Effect.void,
  } satisfies Auth.Interface
}

const TestHttpApi = HttpApi.make("opencode-instance").addHttpApi(SessionHostApi)

function layer(url: string) {
  const host = SessionHost.layer({
    env: { CLOUD_AGENT_NEXT_BASE_URL: url, KILO_WEB_APP_URL: url, KILO_API_URL: url },
  }).pipe(Layer.provide(Layer.succeed(Auth.Service, auth())))
  return HttpRouter.serve(
    HttpApiBuilder.layer(TestHttpApi).pipe(
      Layer.provide(sessionHostHandlers),
      Layer.provide(schemaErrorLayer),
      Layer.provide([
        Layer.succeed(
          Authorization,
          Authorization.of((effect) => effect),
        ),
        host,
        AppNodeBuilder.build(EventV2Bridge.node),
      ]),
      Layer.provide(AppNodeBuilder.build(Database.node)),
    ),
    { disableListenLog: true, disableLogger: true },
  ).pipe(Layer.provideMerge(NodeHttpServer.layerTest))
}

const it = testEffect(layer(server.url.origin))

// Substitute only the fixture's repository identity. Git checks, the route,
// and ingest remain real; remote URL validation has separate Git tests.
const remote = CloudRepository.remote
const parser = spyOn(CloudRepository, "remote").mockImplementation((input) =>
  remote({ ...input, repo: input.repo === "acme/widget" ? "https://github.com/acme/widget.git" : input.repo }),
)

/** A clean pushed worktree backed by a local bare repository. */
async function worktree() {
  const work = await tmpdir({ git: true })
  const branch = (await $`git rev-parse --abbrev-ref HEAD`.cwd(work.path).text()).trim()
  const bare = path.join(work.path, "acme", "widget")
  await fs.mkdir(path.dirname(bare), { recursive: true })
  await $`git init --bare ${bare}`.quiet()
  await Bun.write(path.join(work.path, ".git", "info", "exclude"), "acme/\n")
  await $`git remote add origin acme/widget`.cwd(work.path).quiet()
  await $`git push -u origin ${branch}`.cwd(work.path).quiet()
  return work
}

function onInstance<T, E, R>(ctx: InstanceContext, effect: Effect.Effect<T, E, R>) {
  return effect.pipe(Effect.provideService(InstanceRef, ctx))
}

/** Resolve the request instance exactly as the route does: from the directory. */
async function context(directory: string) {
  return AppRuntime.runPromise(InstanceStore.Service.use((store) => store.load({ directory })))
}

async function seed(ctx: InstanceContext) {
  const directory = ctx.directory
  const session = await AppRuntime.runPromise(
    onInstance(
      ctx,
      Session.Service.use((svc) => svc.create({ agent: "code" })),
    ),
  )
  const messages: string[] = []
  for (let index = 0; index < 2; index++) {
    const id = MessageID.ascending()
    messages.push(id)
    await AppRuntime.runPromise(
      onInstance(
        ctx,
        Session.Service.use((svc) =>
          svc.updateMessage({
            id,
            sessionID: session.id,
            parentID: MessageID.ascending(),
            role: "assistant",
            agent: "code",
            mode: "code",
            modelID: "fake",
            providerID: "test",
            path: { cwd: directory, root: directory },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: Date.now() + index },
          } as never),
        ),
      ),
    )
    await AppRuntime.runPromise(
      onInstance(
        ctx,
        Session.Service.use((svc) =>
          svc.updatePart({
            id: PartID.ascending(),
            sessionID: session.id,
            messageID: id,
            type: "text",
            text: `message ${index}`,
            time: { start: Date.now(), end: Date.now() },
          } as never),
        ),
      ),
    )
  }
  // A real stored diff row, read by fullSync through Storage.
  await AppRuntime.runPromise(
    onInstance(
      ctx,
      Storage.Service.use((storage) =>
        storage.write(
          ["session_diff", String(session.id)],
          [
            {
              file: "historical.txt",
              patch: "--- /dev/null\n+++ b/historical.txt\n@@ -0,0 +1 @@\n+HISTORICAL\n",
              additions: 1,
              deletions: 0,
              status: "added",
            },
          ],
        ),
      ),
    ),
  )
  return { session: String(session.id), messages }
}

/** Wait for the session-creation watcher's own sync so it cannot pollute the route's events. */
async function settleWatchers(sessions: string[]) {
  const deadline = Date.now() + 5000
  while (!sessions.every((id) => relay.ingest.has(id))) {
    if (Date.now() > deadline) throw new Error("watcher sync did not settle")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  relay.order.length = 0
  relay.ingest.clear()
  relay.body = undefined
}

function continueRoute(directory: string, sessionIDs: string[], activeSessionID: string) {
  return HttpClientRequest.post(SessionHostPaths.workspaceContinue).pipe(
    HttpClientRequest.bodyJson({
      operationKey: crypto.randomUUID(),
      directory,
      sessionIDs,
      activeSessionID,
    }),
    Effect.flatMap(HttpClient.execute),
  )
}

it.live(
  "acknowledges the full transcript with an Effect-only request instance before dispatch",
  () =>
    Effect.gen(function* () {
      // The fixture has no ambient AsyncLocalStorage instance.
      expect(() => instanceContext.use()).toThrow()

      const repo = yield* Effect.promise(() => worktree())
      try {
        const ctx = yield* Effect.promise(() => context(repo.path))
        const seeded = yield* Effect.promise(() => seed(ctx))
        yield* Effect.promise(() => settleWatchers([seeded.session]))

        const response = yield* continueRoute(repo.path, [seeded.session], seeded.session)
        expect(response.status).toBe(200)

        // The whole transcript was acknowledged before the provider dispatch.
        const ingest = relay.ingest.get(seeded.session)
        expect(ingest).toBeDefined()
        expect(ingest!.data.filter((item) => item.type === "message")).toHaveLength(2)
        expect(ingest!.data.filter((item) => item.type === "part").length).toBeGreaterThanOrEqual(2)
        expect(
          (ingest!.data.find((item) => item.type === "session_diff") as unknown as { data: unknown[] }).data.length,
        ).toBe(1)
        expect(relay.order).toEqual([`ingest:${seeded.session}`, "continue"])
        expect(relay.body).toMatchObject({
          sessions: [{ sourceKiloSessionId: seeded.session }],
          activeSourceKiloSessionId: seeded.session,
        })
      } finally {
        yield* Effect.promise(() => repo[Symbol.asyncDispose]())
      }
    }),
  30000,
)

it.live(
  "uses the requested worktree, not the process cwd, and never dispatches on a failed sync",
  () =>
    Effect.gen(function* () {
      expect(() => instanceContext.use()).toThrow()

      const repoA = yield* Effect.promise(() => worktree())
      const repoB = yield* Effect.promise(() => worktree())
      try {
        const ctxA = yield* Effect.promise(() => context(repoA.path))
        const ctxB = yield* Effect.promise(() => context(repoB.path))
        const seededA = yield* Effect.promise(() => seed(ctxA))
        const seededB = yield* Effect.promise(() => seed(ctxB))
        yield* Effect.promise(() => settleWatchers([seededA.session, seededB.session]))

        // A failed acknowledgement for worktree B must not dispatch, and must not
        // touch worktree A's transcript.
        relay.ingestStatus = 404
        const failed = yield* continueRoute(repoB.path, [seededB.session], seededB.session)
        expect(failed.status).toBe(409)
        expect(Object(yield* failed.json)).toMatchObject({ code: "sync_failed", retryable: true })
        expect(relay.order).toEqual([`ingest:${seededB.session}`])
        expect(relay.order).not.toContain("continue")
        expect(relay.body).toBeUndefined()

        // With ingest healthy, worktree B succeeds and only B's session is synced.
        relay.order.length = 0
        relay.ingestStatus = 200
        const ok = yield* continueRoute(repoB.path, [seededB.session], seededB.session)
        expect(ok.status).toBe(200)
        expect(relay.order).toEqual([`ingest:${seededB.session}`, "continue"])
        expect(relay.ingest.has(seededA.session)).toBe(false)
        expect(relay.body).toMatchObject({ sessions: [{ sourceKiloSessionId: seededB.session }] })
      } finally {
        yield* Effect.promise(() => repoA[Symbol.asyncDispose]())
        yield* Effect.promise(() => repoB[Symbol.asyncDispose]())
      }
    }),
  40000,
)

afterAll(() => {
  parser.mockRestore()
  void server.stop(true)
})
