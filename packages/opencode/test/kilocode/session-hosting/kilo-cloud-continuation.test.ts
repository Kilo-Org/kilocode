import { Auth } from "@/auth"
import { PROVIDER, provider as kiloCloud } from "@/kilocode/session-hosting/kilo-cloud"
import {
  ProviderContinueWorkspaceInput,
  type ProviderContinueWorkspaceInput as ContinueBody,
} from "@/kilocode/session-hosting/types"
import { expect, test } from "bun:test"
import { Effect, Layer, Option, Schema } from "effect"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.empty)

const decode = (body: ContinueBody) => Schema.decodeUnknownOption(ProviderContinueWorkspaceInput)(body)

const OPERATION = "11111111-1111-4111-8111-111111111111"
const WORKSPACE = "workspace_12345678-1234-1234-1234-123456789abc"
const CLOUD = "agent_12345678-1234-1234-1234-123456789abc"
const OTHER_CLOUD = "agent_abcdefab-cdef-4abc-8def-abcdefabcdef"
const SESSION = "ses_00000000000000000000000001"
const OTHER = "ses_00000000000000000000000002"
const NEW_ONE = "ses_10000000000000000000000001"
const NEW_TWO = "ses_10000000000000000000000002"
const TOKEN = "kilo-test-bearer-value"
const CONTROL = "kilo-test-control-value"

type Call = {
  readonly method: string
  readonly path: string
  readonly auth: string | null
  readonly org: string | null
  readonly body: string
}

const input: ContinueBody = {
  operationKey: OPERATION,
  clientProvenance: "agent-manager",
  repository: { type: "github", repo: "Kilo-Org/kilocode", branch: "main" },
  activeSourceKiloSessionId: OTHER,
  sessions: [
    { sourceKiloSessionId: SESSION, agent: { mode: "build", model: "kilo/deepseek", variant: "" } },
    { sourceKiloSessionId: OTHER, agent: { mode: "plan", model: "anthropic/claude" } },
  ],
}

function harness(reply: () => Response) {
  const calls: Call[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/cloud-agent-next/token") {
        return Response.json({ token: CONTROL, expiresAt: new Date(Date.now() + 600_000).toISOString() })
      }
      const body = request.method === "POST" ? await request.text() : ""
      calls.push({
        method: request.method,
        path: url.pathname,
        auth: request.headers.get("authorization"),
        org: request.headers.get("x-kilocode-organizationid"),
        body,
      })
      if (url.pathname === "/trpc/continueHostedWorkspace") return reply()
      return Response.json({ error: "NOT_FOUND" }, { status: 404 })
    },
  })
  return { url: `http://127.0.0.1:${server.port}`, calls, stop: () => server.stop(true) }
}

function auth(info: Auth.Info | undefined) {
  return {
    get: (id: string) => Effect.succeed(id === "kilo" ? info : undefined),
    all: () => Effect.succeed<Record<string, Auth.Info>>(info ? { kilo: info } : {}),
    set: () => Effect.void,
    remove: () => Effect.void,
  } satisfies Auth.Interface
}

const client = (url: string) =>
  kiloCloud({
    auth: auth(new Auth.Api({ type: "api", key: TOKEN })),
    env: { CLOUD_AGENT_NEXT_BASE_URL: url, KILO_WEB_APP_URL: url, KILO_API_URL: url },
  })

const envelope = (data: unknown) => Response.json({ result: { data } })

const ok = (overrides: Record<string, unknown> = {}) =>
  envelope({
    workspaceId: WORKSPACE,
    sessions: [
      {
        sourceKiloSessionId: SESSION,
        kiloSessionId: NEW_ONE,
        cloudAgentSessionId: CLOUD,
        agent: { mode: "build", model: "kilo/deepseek", variant: "" },
        modeFallback: false,
      },
      {
        sourceKiloSessionId: OTHER,
        kiloSessionId: NEW_TWO,
        cloudAgentSessionId: OTHER_CLOUD,
        agent: { mode: "plan", model: "anthropic/claude" },
        modeFallback: true,
      },
    ],
    activeKiloSessionId: NEW_TWO,
    ...overrides,
  })

it.effect("posts the exact stored body without an organization and maps the result", () => {
  const app = harness(() => ok())
  return Effect.gen(function* () {
    const cloud = client(app.url)
    const result = yield* cloud.continueWorkspace(input)
    expect(app.calls[0]).toMatchObject({
      method: "POST",
      path: "/trpc/continueHostedWorkspace",
      org: null,
    })
    // The stored body is posted unchanged, including an empty variant.
    expect(app.calls[0].body).toBe(JSON.stringify(input))
    expect(result).toEqual({
      workspace: { providerID: PROVIDER, workspaceID: WORKSPACE },
      sessions: [
        {
          source: SESSION,
          destination: { providerID: PROVIDER, sessionID: NEW_ONE },
          agent: { mode: "build", model: "kilo/deepseek", variant: "" },
          modeFallback: false,
        },
        {
          source: OTHER,
          destination: { providerID: PROVIDER, sessionID: NEW_TWO },
          agent: { mode: "plan", model: "anthropic/claude" },
          modeFallback: true,
        },
      ],
      active: { providerID: PROVIDER, sessionID: NEW_TWO },
      replayed: false,
    })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("maps a balance rejection to insufficient_balance with retryable false", () => {
  const app = harness(() => Response.json({ error: "insufficient_balance" }, { status: 402 }))
  return Effect.gen(function* () {
    const error = yield* client(app.url).continueWorkspace(input).pipe(Effect.flip)
    expect(error).toMatchObject({ code: "insufficient_balance", retryable: false })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("maps the continuation conflict codes with the right retryable bit", () => {
  return Effect.gen(function* () {
    const cases: Array<[string, boolean]> = [
      ["creation_in_progress", true],
      ["continuation_incomplete", true],
      ["operation_key_reuse_mismatch", false],
      ["organization_mismatch", false],
    ]
    for (const [code, retryable] of cases) {
      const app = harness(() => Response.json({ error: code }, { status: 409 }))
      const error = yield* client(app.url).continueWorkspace(input).pipe(Effect.flip)
      expect(error).toMatchObject({ code, retryable })
      app.stop()
    }
  })
})

it.effect("rejects a different session order as invalid_response", () => {
  const app = harness(() =>
    ok({
      sessions: [
        {
          sourceKiloSessionId: OTHER,
          kiloSessionId: NEW_TWO,
          cloudAgentSessionId: OTHER_CLOUD,
          agent: { mode: "plan", model: "anthropic/claude" },
          modeFallback: false,
        },
        {
          sourceKiloSessionId: SESSION,
          kiloSessionId: NEW_ONE,
          cloudAgentSessionId: CLOUD,
          agent: { mode: "build", model: "kilo/deepseek" },
          modeFallback: false,
        },
      ],
    }),
  )
  return Effect.gen(function* () {
    const error = yield* client(app.url).continueWorkspace(input).pipe(Effect.flip)
    expect(error).toMatchObject({ code: "invalid_response", retryable: false })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("reads the continuation code from a real nested tRPC envelope", () => {
  return Effect.gen(function* () {
    // tRPC puts a generic transport code beside the actionable Kilo message, so
    // the code must be found in error.json.message / error.data.code, not only a
    // flat `data.code`.
    const shapes: Array<unknown> = [
      { error: { message: "operation_key_reuse_mismatch", data: { code: "CONFLICT" } } },
      { error: { json: { message: "operation_key_reuse_mismatch" } } },
      { error: { json: { message: "operation_key_reuse_mismatch" }, data: { code: "CONFLICT" } } },
    ]
    for (const body of shapes) {
      const app = harness(() => Response.json(body, { status: 409 }))
      const error = yield* client(app.url).continueWorkspace(input).pipe(Effect.flip)
      expect(error).toMatchObject({ code: "operation_key_reuse_mismatch", retryable: false })
      app.stop()
    }

    const orgShape = harness(() =>
      Response.json(
        { error: { json: { message: "organization_mismatch", data: { code: "FORBIDDEN" } } } },
        { status: 409 },
      ),
    )
    const orgError = yield* client(orgShape.url).continueWorkspace(input).pipe(Effect.flip)
    expect(orgError).toMatchObject({ code: "organization_mismatch", retryable: false })
    orgShape.stop()

    const progress = harness(() =>
      Response.json({ error: { json: { message: "creation_in_progress" } } }, { status: 409 }),
    )
    const progressError = yield* client(progress.url).continueWorkspace(input).pipe(Effect.flip)
    expect(progressError).toMatchObject({ code: "creation_in_progress", retryable: true })
    progress.stop()
  })
})

it.effect("rejects an active session that does not match the active source", () => {
  const app = harness(() => ok({ activeKiloSessionId: NEW_ONE }))
  return Effect.gen(function* () {
    const error = yield* client(app.url).continueWorkspace(input).pipe(Effect.flip)
    expect(error).toMatchObject({ code: "invalid_response", retryable: false })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})
it.effect("rejects duplicate destination sessions", () => {
  const app = harness(() =>
    ok({
      sessions: [
        {
          sourceKiloSessionId: SESSION,
          kiloSessionId: NEW_ONE,
          cloudAgentSessionId: CLOUD,
          agent: { mode: "build", model: "kilo/deepseek", variant: "" },
          modeFallback: false,
        },
        {
          sourceKiloSessionId: OTHER,
          kiloSessionId: NEW_ONE,
          cloudAgentSessionId: OTHER_CLOUD,
          agent: { mode: "plan", model: "anthropic/claude" },
          modeFallback: false,
        },
      ],
      activeKiloSessionId: NEW_ONE,
    }),
  )
  return Effect.gen(function* () {
    const error = yield* client(app.url).continueWorkspace(input).pipe(Effect.flip)
    expect(error).toMatchObject({ code: "invalid_response", retryable: false })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

test("rejects a durable body with an over-long mode or variant before it is stored", () => {
  // The durable contract bounds mode and variant to 50 characters. A body that
  // violates it must fail validation, so `run` never reaches its only writer
  // (`Continuation.store.insert`), and no row can poison the stored intent.
  const overLongMode = {
    ...input,
    sessions: [{ sourceKiloSessionId: SESSION, agent: { mode: "m".repeat(51), model: "kilo/deepseek" } }],
  } as ContinueBody
  expect(Option.isNone(decode(overLongMode))).toBe(true)

  const overLongVariant = {
    ...input,
    sessions: [
      {
        sourceKiloSessionId: SESSION,
        agent: { mode: "build", model: "kilo/deepseek", variant: "v".repeat(51) },
      },
    ],
  } as ContinueBody
  expect(Option.isNone(decode(overLongVariant))).toBe(true)

  // A boundary-length body is accepted, so the bound is exact.
  const boundary = {
    ...input,
    sessions: [{ sourceKiloSessionId: SESSION, agent: { mode: "m".repeat(50), model: "kilo/deepseek" } }],
  } as ContinueBody
  expect(Option.isSome(decode(boundary))).toBe(true)
})

it.effect("maps 403 authentication failures without hiding organization mismatches", () =>
  Effect.gen(function* () {
    for (const [message, code] of [
      ["Forbidden", "unauthorized"],
      ["organization_mismatch", "organization_mismatch"],
    ]) {
      const app = harness(() => Response.json({ error: { message, data: { code: "FORBIDDEN" } } }, { status: 403 }))
      yield* Effect.gen(function* () {
        const error = yield* client(app.url).continueWorkspace(input).pipe(Effect.flip)
        expect(error).toMatchObject({ code, retryable: false })
      }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
    }
  }),
)
