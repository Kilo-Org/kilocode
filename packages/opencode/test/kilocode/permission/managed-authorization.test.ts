import { expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Effect, Fiber } from "effect"
import { Permission } from "@/permission"
import { SessionID } from "@/session/schema"
import { pollWithTimeout, testEffect } from "../../lib/effect"

const it = testEffect(AppNodeBuilder.build(Permission.node))
const org = "9d278969-5453-4ae3-a51f-a8d2274a7b56"
const other = "41661e40-d1db-4e50-823a-29bacdf2e3dc"

it.instance(
  "preserves local denials and protects managed approvals from auto replies, drains, persistence, and context changes",
  () =>
    Effect.gen(function* () {
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch(request) {
              if (request.headers.get("authorization") !== "Bearer test-permission-member")
                return new Response(null, { status: 401 })
              const path = new URL(request.url).pathname
              if (path === "/api/profile") return Response.json({ user: { id: "test/permission-member" } })
              if (path === `/api/organizations/${other}/policy/permission`) {
                return Response.json(
                  {
                    schema_version: 1,
                    organization_id: other,
                    managed: false,
                    revision: 0,
                    max_age_seconds: 300,
                    policy: {},
                  },
                  { headers: { ETag: '"disabled-organization"' } },
                )
              }
              if (path !== `/api/organizations/${org}/policy/permission`) return new Response(null, { status: 404 })
              return Response.json(
                {
                  schema_version: 1,
                  organization_id: org,
                  managed: true,
                  revision: 8,
                  max_age_seconds: 300,
                  policy: {
                    agent_permissions: {
                      layers: [
                        {
                          schema_version: 1,
                          unrestricted_mode: "deny",
                          tools: {
                            edit: "allow",
                            websearch: "deny",
                            webfetch: { rules: [{ pattern: "docs.example.test/*", action: "ask" }] },
                          },
                        },
                      ],
                    },
                  },
                },
                { headers: { ETag: '"managed-organization"' } },
              )
            },
          }),
        ),
        (server) => Effect.promise(() => server.stop(true)).pipe(Effect.asVoid),
      )
      const env = {
        KILO_ORG_ID: org,
        KILO_API_KEY: "test-permission-member",
        KILO_API_URL: server.url.origin,
      }
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const before = Object.entries(env).map(([key]) => [key, process.env[key]] as const)
          Object.assign(process.env, env)
          return before
        }),
        (before) =>
          Effect.sync(() => {
            for (const [key, value] of before) {
              if (value === undefined) delete process.env[key]
              else process.env[key] = value
            }
          }),
      )

      const svc = yield* Permission.Service
      const request = {
        sessionID: SessionID.create(),
        patterns: ["docs.example.test/start"],
        metadata: {},
        always: ["*"],
        ruleset: [{ permission: "*", pattern: "*", action: "allow" as const }],
      }
      expect(yield* svc.managedState()).toEqual({
        status: "active",
        organization: org,
        revision: 8,
        unrestricted: false,
      })
      expect(yield* svc.ask({ ...request, permission: "websearch" }).pipe(Effect.flip)).toMatchObject({
        reason: "denied",
      })
      expect(
        yield* svc
          .ask({ ...request, permission: "edit", ruleset: [{ permission: "edit", pattern: "*", action: "deny" }] })
          .pipe(Effect.flip),
      ).toBeInstanceOf(Permission.DeniedError)

      const waiting = yield* svc.ask({ ...request, permission: "webfetch" }).pipe(Effect.forkScoped)
      const pending = (managed: boolean) =>
        pollWithTimeout(
          svc
            .list()
            .pipe(
              Effect.map((list) =>
                list.find((entry) => entry.permission === "webfetch" && !!entry.managed === managed),
              ),
            ),
          "Expected a pending webfetch permission",
        )
      const first = yield* pending(true)
      expect(first.managed).toEqual({ revision: 8 })
      expect(first.always).toEqual([])
      yield* svc.reply({ requestID: first.id, reply: "once" })
      yield* svc.reply({ requestID: first.id, reply: "always", interactive: true })
      yield* svc.saveAlwaysRules({ requestID: first.id, approvedAlways: ["*"] })
      expect((yield* svc.pending(first.id))?.id).toBe(first.id)

      const local = yield* svc
        .ask({ ...request, permission: "webfetch", patterns: ["other.example.test/start"], ruleset: [] })
        .pipe(Effect.forkScoped)
      const second = yield* pending(false)
      yield* svc.reply({ requestID: second.id, reply: "always", interactive: true })
      yield* Fiber.join(local)
      expect((yield* svc.pending(first.id))?.id).toBe(first.id)
      expect(yield* svc.allowEverything({ enable: true }, Effect.die("must not persist unrestricted mode"))).toBe(false)

      yield* svc.reply({ requestID: first.id, reply: "once", interactive: true })
      expect((yield* Fiber.join(waiting)).manual).toBe(true)

      const current = { denied: false }
      const changing = yield* svc
        .ask({
          ...request,
          permission: "webfetch",
          reload: () =>
            Effect.sync(() => ({
              ruleset: current.denied ? [{ permission: "webfetch", pattern: "*", action: "deny" }] : request.ruleset,
            })),
        })
        .pipe(Effect.forkScoped)
      const tightened = yield* pending(true)
      current.denied = true
      yield* svc.reply({ requestID: tightened.id, reply: "once", interactive: true })
      expect(yield* Fiber.join(changing).pipe(Effect.flip)).toMatchObject({ reason: "changed" })

      const again = yield* svc.ask({ ...request, permission: "webfetch" }).pipe(Effect.forkScoped)
      const third = yield* pending(true)
      expect(third.id).not.toBe(first.id)
      yield* Effect.sync(() => {
        process.env.KILO_ORG_ID = other
      })
      yield* svc.reply({ requestID: third.id, reply: "once", interactive: true })
      expect(yield* Fiber.join(again).pipe(Effect.flip)).toMatchObject({ reason: "changed" })
      expect(yield* svc.canEnableUnrestricted()).toBe(true)
    }),
)
