import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { resolve } from "@/kilocode/permission/managed-context"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { TestConfig } from "../../fixture/config"
import { TestInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.mergeAll(Auth.defaultLayer, AppNodeBuilder.build(Config.node)))
const org = "3b359483-18de-4a46-adcf-ae11a609810c"
const other = "fa973648-1258-4037-907a-d99830df96b8"
const route = (organization: string) => `/api/organizations/${organization}/policy/permission`
const policy = {
  schema_version: 1,
  organization_id: org,
  revision: 1,
  max_age_seconds: 300,
  managed: true,
  policy: {},
}

const env = (values: Record<string, string | undefined>) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      return previous
    }),
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }),
  )

const serve = (handler: (pathname: string, bearer: string | null) => Response | Promise<Response>) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request) {
          return handler(new URL(request.url).pathname, request.headers.get("authorization"))
        },
      }),
    ),
    (server) => Effect.promise(() => server.stop(true)),
  )

const profile = (id = "oauth/member") => Response.json({ user: { id } })
const response = (value: object = policy) => Response.json(value, { headers: { etag: '"opaque"' } })

it.live("keeps the selected organization on a third-party model and invalidates scope after an account switch", () =>
  Effect.gen(function* () {
    const hits: Array<[string, string | null]> = []
    const server = yield* serve((url, bearer) => {
      hits.push([url, bearer])
      return url === "/api/profile" ? profile() : response()
    })
    yield* env({
      KILO_API_URL: server.url.origin,
      KILO_ORG_ID: org.toUpperCase(),
      KILO_API_KEY: "first",
      KILO_AUTH_CONTENT: "{}",
    })
    const auth = yield* Auth.Service
    let model = "kilo/first-model"
    const cfg = TestConfig.make({ get: () => Effect.succeed({ model }) })
    const first = yield* resolve(auth, cfg)
    if (first.status !== "active") throw new Error(JSON.stringify(first))
    expect(first.organization).toBe(org)
    model = "another/third-party"
    expect(yield* resolve(auth, cfg)).toEqual(first)
    expect(hits).toEqual([
      ["/api/profile", "Bearer first"],
      [route(org), "Bearer first"],
    ])

    process.env.KILO_API_KEY = "second"
    const second = yield* resolve(auth, cfg)
    if (second.status !== "active") throw new Error(JSON.stringify(second))
    expect(second.scope).not.toBe(first.scope)
    expect(second.stamp).not.toBe(first.stamp)
    expect(hits.slice(2)).toEqual([
      ["/api/profile", "Bearer second"],
      [route(org), "Bearer second"],
    ])

    process.env.KILO_API_KEY = "first"
    const third = yield* resolve(auth, cfg)
    if (third.status !== "active") throw new Error(JSON.stringify(third))
    expect(third.scope).not.toBe(first.scope)
    expect(third.stamp).not.toBe(first.stamp)
    expect(hits).toHaveLength(4)
  }),
)

it.live("rejects conflicting scoped organization IDs and mismatched accounts on an environment bearer override", () =>
  Effect.gen(function* () {
    const hits: Array<[string, string | null]> = []
    const server = yield* serve((url, bearer) => {
      hits.push([url, bearer])
      return url === "/api/profile"
        ? profile(`oauth/${bearer === "Bearer original" ? "selected" : "other"}`)
        : response()
    })
    yield* env({
      KILO_API_URL: server.url.origin,
      KILO_ORG_ID: other,
      KILO_API_KEY: "override",
      KILO_AUTH_CONTENT: JSON.stringify({
        kilo: { type: "oauth", access: "original", refresh: "unused", expires: 0, accountId: org },
      }),
    })
    const auth = yield* Auth.Service
    const cfg = TestConfig.make()
    expect(yield* resolve(auth, cfg)).toEqual({ status: "unavailable", organization: other, reason: "invalid" })
    expect(hits).toEqual([])
    process.env.KILO_ORG_ID = org
    expect(yield* resolve(auth, cfg)).toEqual({ status: "unavailable", organization: org, reason: "unauthorized" })
    expect(hits).toEqual([
      ["/api/profile", "Bearer override"],
      ["/api/profile", "Bearer original"],
    ])
  }),
)

it.live(
  "recognizes an organization-scoped gateway bearer and does not send a bearer to an unrelated model origin",
  () =>
    Effect.gen(function* () {
      const hits: Array<[string, string | null]> = []
      const server = yield* serve((url, bearer) => {
        hits.push([url, bearer])
        return url === "/api/profile" ? profile() : response({ ...policy, managed: false })
      })
      const unrelated = yield* serve((url, bearer) => {
        hits.push([url, bearer])
        return response()
      })
      const key = `${server.url.origin}/api/organizations/${org}:exact-key`
      yield* env({
        KILO_API_URL: server.url.origin,
        KILO_ORG_ID: undefined,
        KILO_API_KEY: key,
        KILO_AUTH_CONTENT: "{}",
      })
      const auth = yield* Auth.Service
      const cfg = TestConfig.make({
        get: () => Effect.succeed({ provider: { kilo: { options: { baseURL: unrelated.url.origin } } } }),
      })
      expect(yield* resolve(auth, cfg)).toMatchObject({ status: "disabled", organization: org, unrestricted: true })
      expect(hits).toEqual([
        ["/api/profile", `Bearer ${key}`],
        [route(org), `Bearer ${key}`],
      ])

      process.env.KILO_API_KEY = `${unrelated.url.origin}/api/organizations/${org}:unrelated-key`
      expect(yield* resolve(auth, cfg)).toEqual({ status: "unavailable", organization: org, reason: "invalid" })
      expect(hits).toHaveLength(2)
    }),
)

it.live("reports unavailable reason codes without treating a rejected policy as disabled", () =>
  Effect.gen(function* () {
    const server = yield* serve((url, bearer) => {
      if (url === "/api/profile") return profile()
      switch (bearer) {
        case "Bearer unauthorized":
          return new Response(null, { status: 403 })
        case "Bearer invalid":
          return response({ ...policy, organization_id: other })
        case "Bearer update-required":
          return response({ ...policy, schema_version: 2 })
        case "Bearer client-denied":
          return response({
            ...policy,
            policy: {
              client_access: {
                layers: [{ schema_version: 1, mode: "allowlist", clients: [{ feature: "cli", min_version: "2.0.0" }] }],
              },
            },
          })
        default:
          return new Response(null, { status: 503 })
      }
    })
    yield* env({
      KILO_API_URL: server.url.origin,
      KILO_ORG_ID: org,
      KILO_API_KEY: "",
      KILO_AUTH_CONTENT: "{}",
      KILOCODE_FEATURE: "cli",
      KILOCODE_VERSION: "1.0.0",
    })
    const auth = yield* Auth.Service
    const cfg = TestConfig.make()
    for (const reason of ["unavailable", "unauthorized", "invalid", "update-required", "client-denied"] as const) {
      process.env.KILO_API_KEY = reason
      expect(yield* resolve(auth, cfg)).toEqual({ status: "unavailable", organization: org, reason })
    }
    process.env.KILOCODE_VERSION = "2.0.0"
    const first = yield* resolve(auth, cfg)
    if (first.status !== "active") throw new Error(JSON.stringify(first))
    process.env.KILOCODE_VERSION = "1.0.0"
    expect(yield* resolve(auth, cfg)).toMatchObject({ status: "unavailable", reason: "client-denied" })
    process.env.KILOCODE_VERSION = "2.0.0"
    const next = yield* resolve(auth, cfg)
    if (next.status !== "active") throw new Error(JSON.stringify(next))
    expect(next.scope).toBe(first.scope)
    expect(next.stamp).not.toBe(first.stamp)
  }),
)

it.live("rejects a late policy result after a selection switch", () =>
  Effect.gen(function* () {
    const ready = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<void>()
    const server = yield* serve(async (url) => {
      if (url === "/api/profile") return profile()
      if (url === route(org)) {
        ready.resolve()
        await gate.promise
        return response()
      }
      return response({ ...policy, organization_id: other })
    })
    yield* Effect.addFinalizer(() => Effect.sync(() => gate.resolve()))
    yield* env({ KILO_API_URL: server.url.origin, KILO_ORG_ID: org, KILO_API_KEY: "pinned", KILO_AUTH_CONTENT: "{}" })
    const auth = yield* Auth.Service
    const cfg = TestConfig.make()
    const pending = yield* resolve(auth, cfg).pipe(Effect.forkChild)
    yield* Effect.promise(() => ready.promise)
    process.env.KILO_ORG_ID = other
    expect(yield* resolve(auth, cfg)).toMatchObject({ status: "active", organization: other })
    gate.resolve()
    expect(yield* Fiber.join(pending)).toEqual({ status: "unavailable", organization: org, reason: "unavailable" })
  }),
)

it.instance("keeps separate trusted device and per-agent permissions apart from editable config", () =>
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const mdm = path.join(instance.directory, "device-config")
    yield* env({ KILO_TEST_MANAGED_CONFIG_DIR: mdm, KILO_PERMISSION: '{"bash":"allow"}', KILO_AUTH_CONTENT: "{}" })
    yield* Effect.promise(() => fs.mkdir(mdm))
    yield* Effect.promise(() =>
      Promise.all([
        fs.writeFile(
          path.join(mdm, "kilo.json"),
          JSON.stringify({
            permission: { bash: "deny" },
            agent: { coder: { permission: { read: "ask" } } },
            mode: { coder: { tools: { write: false } } },
          }),
        ),
        fs.writeFile(path.join(mdm, "opencode.json"), JSON.stringify({ permission: { bash: "allow" } })),
        fs.writeFile(
          path.join(instance.directory, "kilo.json"),
          JSON.stringify({
            permission: { list: "deny" },
            agent: { other: { permission: { grep: "deny" } } },
          }),
        ),
      ]),
    )
    const cfg = yield* Config.Service
    expect((yield* cfg.get()).permission).toMatchObject({ bash: "allow", list: "deny" })
    expect(yield* cfg.mdmPermissions()).toEqual([{ bash: "deny" }, { bash: "allow" }])
    expect(yield* cfg.mdmPermissions("coder")).toEqual([
      { bash: "deny" },
      { read: "ask" },
      { edit: "deny" },
      { bash: "allow" },
    ])
    expect(yield* cfg.mdmPermissions("other")).toEqual([{ bash: "deny" }, { bash: "allow" }])
  }),
)
