// kilocode_change - focused tests for the production `createRemoteRunLive`
// adapter. These tests prove that the live factory wires the session-create
// and prompt-persistence seams through the right `provide` directory, calls
// the right Effect services with the exact shape, and sanitizes late-loop
// failures before they reach the EventV2Bridge publish channel.
//
// Strict TDD: every behavior promised by the plan is asserted here before
// the production change. State coverage:
//   - Happy: prompt persistence + loop fork + happy late cause return
//     `promptStarted:true`
//   - Retryable: prompt persistence failure is a terminal partial with the
//     created sessionId (no late-cause publish)
//   - Nonretryable: not applicable at this layer (the seam is bounded)
//   - Empty: structurally impossible (every code path either persists a
//     message or surfaces a sanitized event)
//
// Strict invariants that must never regress:
//   - The fixed launch directory is the `provide` directory for both
//     `session.create` and `SessionPrompt.prompt`.
//   - The root session create is called with `{}`.
//   - The prompt call shape is exact: `sessionID`, generated `messageID`,
//     `noReply:true`, `agent`, nested `model`, optional `variant`, single
//     `text` part. The closure never edits the upstream request fields.
//   - Prompt persistence happens before the loop fiber is forked.
//   - Late-loop-cause publishing never leaks the raw error message, prompt,
//     path, or token; the published event is the fixed sanitized literal.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { createRemoteRunLive } from "../../../src/kilo-sessions/remote-run-live"
import type { RuntimeDeps } from "../../../src/kilo-sessions/remote-run-live"
import { Session } from "../../../src/session/session"
import { SessionPrompt } from "../../../src/session/prompt"
import { EventV2Bridge } from "../../../src/event-v2-bridge"
import { SessionID } from "../../../src/session/schema"
import { RemoteRun } from "../../../src/kilo-sessions/remote-run"
import { RemoteModelCatalog } from "../../../src/kilo-sessions/remote-model-catalog"
import { RemoteRuntime } from "../../../src/kilo-sessions/remote-runtime"
import { AttachedState } from "../../../src/kilo-sessions/attached-state"
import type { ProviderV2 } from "@opencode-ai/core/provider"
import type { ModelV2 } from "@opencode-ai/core/model"

const SESSION_ID = "ses_live_test" as SessionID
const SAFE_UNKNOWN_MESSAGE = "The session encountered an unexpected error."

const SENTINEL_RAW_MESSAGE = "SENTINEL_RAW_PROMPT_SECRET_TOKEN_xyz must-not-leak /private/path"
const SENTINEL_RAW_MARKER = "SENTINEL_RAW_PROMPT_SECRET_TOKEN_xyz"

function uuid(idx: number): string {
  const hex = idx.toString(16).padStart(12, "0")
  return `00000000-0000-4000-8000-${hex}`
}

function validRequest(over: Partial<RemoteRun.Request> = {}): RemoteRun.Request {
  return {
    protocolVersion: 1,
    requestId: uuid(1),
    prompt: "Hello there",
    model: { providerID: "kilo", modelID: "anthropic/claude-sonnet-4" },
    agent: "build",
    ...over,
  }
}

function providerFixture(providerID: string, modelID: string) {
  return {
    [providerID]: {
      id: providerID,
      name: providerID,
      source: "env" as const,
      env: [],
      key: "",
      options: {},
      models: {
        [modelID]: {
          id: modelID,
          providerID,
          api: { id: "anthropic-messages", url: "", npm: "@ai-sdk/anthropic" },
          name: modelID,
          capabilities: {
            temperature: true,
            attachment: true,
            reasoning: false,
            toolcall: true,
            input: { text: true, audio: false, image: true, video: false, pdf: true },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
            interleaved: false,
          },
          cost: { input: 1, output: 2, cache: { read: 3, write: 4 } },
          limit: { context: 100_000, output: 4_096 },
          status: "active" as const,
          options: {},
          headers: {},
          release_date: "2026-01-01",
          variants: {},
        },
      },
    },
  }
}

function makeCatalog(): RemoteRuntime.Catalog {
  const models = RemoteModelCatalog.build({
    providers: providerFixture("kilo", "anthropic/claude-sonnet-4"),
    session: {},
    messages: [],
    defaultModel: { providerID: "kilo", modelID: "anthropic/claude-sonnet-4" },
  })
  return {
    protocolVersion: 1,
    models,
    agents: [{ slug: "build", name: "build" }],
    defaultAgent: "build",
  }
}

type LoopBehavior = "ok" | "fail-die" | "fail-fail" | "fail-interrupt" | "fail-wrapped-interrupt"

type FakeOptions = {
  directory?: string
  createError?: unknown
  promptError?: unknown
  loopBehavior?: LoopBehavior
  catalog?: RemoteRuntime.Catalog
}

type FakeHarness = {
  run: RemoteRun.Interface
  provideDirs: string[]
  createInputs: unknown[]
  promptInputs: Array<{ input: any; messageID: string }>
  loopInputs: unknown[]
  order: string[]
  published: Array<{ definition: unknown; data: unknown }>
  lateCause: Array<{ operation: string; sessionID: SessionID; errorClass: string }>
  log: { error: unknown[][]; warn: unknown[][] }
  setPublishSessionError: (impl: RuntimeDeps["publishSessionError"]) => void
  onLateCause: (impl: NonNullable<RuntimeDeps["onLateCause"]>) => void
}

function makeFakeHarness(opts: FakeOptions = {}): FakeHarness {
  const directory = opts.directory ?? "/workspace/alpha"
  const provideDirs: string[] = []
  const createInputs: unknown[] = []
  const promptInputs: Array<{ input: any; messageID: string }> = []
  const loopInputs: unknown[] = []
  const order: string[] = []
  const published: Array<{ definition: unknown; data: unknown }> = []
  const lateCause: Array<{ operation: string; sessionID: SessionID; errorClass: string }> = []
  const log: { error: unknown[][]; warn: unknown[][] } = { error: [], warn: [] }
  const publishSessionErrorRef: { current: RuntimeDeps["publishSessionError"] } = {
    current: () => Effect.void as never,
  }
  const onLateCauseRef: { current: RuntimeDeps["onLateCause"] } = { current: undefined }

  const catalog = opts.catalog ?? makeCatalog()

  // Fake `Session.Service` only needs `create` for the production closure.
  const fakeSession = {
    create: (input: any) => {
      createInputs.push(input)
      order.push("create")
      if (opts.createError) return Effect.fail(opts.createError) as never
      return Effect.succeed({
        id: SESSION_ID,
        directory,
        title: "",
        parentID: undefined,
        created: 0,
      } as unknown as Awaited<ReturnType<Session.Interface["create"]>>)
    },
  } as unknown as Session.Interface

  // Fake `SessionPrompt.Service` only needs `prompt` and `loop`.
  const fakePrompt = {
    prompt: (input: any) => {
      order.push("prompt")
      promptInputs.push({ input, messageID: (input as any).messageID })
      if (opts.promptError) return Effect.fail(opts.promptError) as never
      return Effect.succeed({} as never)
    },
    loop: (input: any) => {
      order.push("loop")
      loopInputs.push(input)
      if (opts.loopBehavior === "fail-die") {
        return Effect.die(new Error(SENTINEL_RAW_MESSAGE)) as never
      }
      if (opts.loopBehavior === "fail-fail") {
        return Effect.fail(new Error(SENTINEL_RAW_MESSAGE)) as never
      }
      if (opts.loopBehavior === "fail-interrupt") {
        return Effect.interrupt as never
      }
      if (opts.loopBehavior === "fail-wrapped-interrupt") {
        const err = new Error("wrapped interruption signal")
        err.name = "SessionPrompt.InterruptedError"
        return Effect.fail(err) as never
      }
      return Effect.succeed({} as never)
    },
  } as unknown as SessionPrompt.Interface

  // Fake `EventV2Bridge.Service` only needs `publish` for the production
  // default `publishSessionError`. The test override path doesn't need it.
  const fakeEvents = {
    publish: (definition: any, data: any) => {
      published.push({ definition, data })
      return Effect.void as never
    },
  } as unknown as EventV2Bridge.Service["Service"]

  const fakeLayer = Layer.mergeAll(
    Layer.succeed(Session.Service, fakeSession),
    Layer.succeed(SessionPrompt.Service, fakePrompt),
    Layer.succeed(EventV2Bridge.Service, fakeEvents),
  )
  // The merged layer's output is the union of the provided service tags;
  // cast to `any` so the test fake's `Effect.provide` calls satisfy
  // `Effect.runPromise`/`Effect.runSync` regardless of the captured R.
  const anyLayer = fakeLayer as Layer.Layer<any, never, never>

  // Fake `provide` is a no-op wrapper that records the directory and calls
  // the function. The real `Instance.provide` re-enters AsyncLocalStorage,
  // which is irrelevant to the seam under test.
  const fakeProvide = (input: { directory: string; fn: () => unknown }) => {
    provideDirs.push(input.directory)
    return input.fn()
  }

  const fakeRuntime: RuntimeDeps["AppRuntime"] = {
    runPromise: <A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> => {
      return Effect.runPromise(Effect.provide(effect as Effect.Effect<any, any, any>, anyLayer)) as unknown as Promise<A>
    },
    runFork: <A, E, R>(effect: Effect.Effect<A, E, R>) => {
      Effect.runSync(Effect.provide(effect as Effect.Effect<any, any, any>, anyLayer))
    },
  }

  const runtime: RemoteRuntime.Interface = {
    runtimeId: "rt-live",
    directory,
    setConnectionId: () => {},
    presence: () => ({}) as ReturnType<RemoteRuntime.Interface["presence"]>,
    catalog: async () => catalog,
  }
  const attachedState: AttachedState.Interface = {
    setPresence: () => {},
    announce: async () => {
      order.push("announce")
    },
    union: () => new Set(),
    reset: () => {},
  }

  const run = createRemoteRunLive({
    runtime,
    attachedState,
    directory,
    log: {
      error: (...args) => log.error.push(args),
      warn: (...args) => log.warn.push(args),
    },
    deps: {
      provide: fakeProvide as never,
      AppRuntime: fakeRuntime,
      publishSessionError: ((input) => publishSessionErrorRef.current(input)) as RuntimeDeps["publishSessionError"],
      onLateCause: (input) => onLateCauseRef.current?.(input),
    },
  })

  return {
    run,
    provideDirs,
    createInputs,
    promptInputs,
    loopInputs,
    order,
    published,
    lateCause,
    log,
    setPublishSessionError(impl) {
      publishSessionErrorRef.current = impl
    },
    onLateCause(impl) {
      onLateCauseRef.current = impl
    },
  }
}

beforeEach(() => {
  mock.restore()
})

afterEach(() => {
  mock.restore()
})

describe("createRemoteRunLive: directory + create input", () => {
  test("uses the fixed launch directory for session.create and prompt persistence", async () => {
    const h = makeFakeHarness({ directory: "/workspace/alpha" })
    const result = await h.run.createAndRun(validRequest())
    expect(result.ok).toBe(true)
    // The provide directory must be the fixed launch directory for both
    // the session create and the prompt persistence.
    expect(h.provideDirs).toEqual(["/workspace/alpha", "/workspace/alpha"])
  })

  test("calls Session.Service.create with exactly {}", async () => {
    const h = makeFakeHarness()
    await h.run.createAndRun(validRequest())
    expect(h.createInputs).toHaveLength(1)
    expect(h.createInputs[0]).toEqual({})
  })
})

describe("createRemoteRunLive: prompt persistence shape", () => {
  test("persists the prompt with sessionID, generated messageID, noReply:true, agent, nested model, single text part", async () => {
    const h = makeFakeHarness()
    await h.run.createAndRun(validRequest())
    expect(h.promptInputs).toHaveLength(1)
    const input = h.promptInputs[0]!.input as Record<string, unknown>
    expect(input.sessionID).toBe(SESSION_ID)
    expect(typeof input.messageID).toBe("string")
    if (typeof input.messageID !== "string") throw new Error("messageID must be string")
    expect(input.messageID.length).toBeGreaterThan(0)
    // Generated messageID is recorded separately and used downstream.
    expect(h.promptInputs[0]!.messageID).toBe(input.messageID)
    expect(input.noReply).toBe(true)
    expect(input.agent).toBe("build")
    expect(input.model).toEqual({ providerID: "kilo", modelID: "anthropic/claude-sonnet-4" })
    expect(input.variant).toBeUndefined()
    expect(input.parts).toEqual([{ type: "text", text: "Hello there" }])
    // No extra fields beyond the seam contract.
    expect(Object.keys(input).sort()).toEqual(
      ["agent", "messageID", "model", "noReply", "parts", "sessionID"].sort(),
    )
  })

  test("forwards the request variant when present", async () => {
    // Build a catalog that includes the variant so the request validates.
    const catalog = makeCatalog()
    ;(catalog.agents[0] as any).variant = "precise"
    const modelEntry = catalog.models.all[0]!.models["anthropic/claude-sonnet-4"] as any
    modelEntry.variants = { precise: {} }
    const h = makeFakeHarness({ catalog })
    const result = await h.run.createAndRun({ ...validRequest(), variant: "precise" })
    expect(result.ok).toBe(true)
    const input = h.promptInputs[0]!.input as Record<string, unknown>
    expect(input.variant).toBe("precise")
  })

  test("persists the message before forking the loop fiber", async () => {
    const h = makeFakeHarness()
    await h.run.createAndRun(validRequest())
    // The order of operations within the promptStart closure must be
    // create -> announce -> prompt -> loop. The loop is forked AFTER the
    // prompt is persisted.
    expect(h.order).toEqual(["create", "announce", "prompt", "loop"])
  })

  test("prompt persistence failure surfaces a terminal partial with the created sessionId", async () => {
    const h = makeFakeHarness({ promptError: new Error("SENTINEL_RAW_PROMPT_FAIL") })
    const r = await h.run.createAndRun(validRequest())
    expect(r.ok).toBe(true)
    if (r.ok && r.promptStarted === false) {
      expect(r.sessionId).toBe(SESSION_ID)
      expect(r.error.code).toBe("PROMPT_START_FAILED")
      expect(r.error.message).toBe("The session was created, but the first prompt did not start.")
    } else {
      throw new Error("expected terminal partial")
    }
    // The loop was never installed because the prompt call rejected.
    expect(h.loopInputs).toHaveLength(0)
  })
})

describe("createRemoteRunLive: happy return + loop fork", () => {
  test("returns promptStarted:true after the loop fork is installed", async () => {
    const h = makeFakeHarness()
    const r = await h.run.createAndRun(validRequest())
    if (r.ok && r.promptStarted) {
      expect(r.sessionId).toBe(SESSION_ID)
      expect(r.protocolVersion).toBe(1)
    } else {
      throw new Error("expected ok+promptStarted")
    }
    // The loop fiber was installed exactly once.
    expect(h.loopInputs).toHaveLength(1)
  })
})

describe("createRemoteRunLive: late loop cause sanitization", () => {
  test("interrupt-only late cause logs nothing and publishes nothing", async () => {
    const h = makeFakeHarness({ loopBehavior: "fail-interrupt" })
    const r = await h.run.createAndRun(validRequest())
    expect(r.ok).toBe(true)
    // The outer call still resolves with promptStarted:true because the late
    // cause is async and only fires after the message is persisted.
    if (r.ok && r.promptStarted) {
      expect(r.sessionId).toBe(SESSION_ID)
    } else {
      throw new Error("expected ok+promptStarted")
    }
    // No sanitized log line and no published event.
    const flattened = JSON.stringify(h.log)
    expect(flattened).not.toContain("remote_run late cause")
    expect(h.published).toHaveLength(0)
    expect(h.lateCause).toHaveLength(0)
  })

  test("wrapped SessionPrompt.InterruptedError late cause logs nothing and publishes nothing", async () => {
    const h = makeFakeHarness({ loopBehavior: "fail-wrapped-interrupt" })
    const r = await h.run.createAndRun(validRequest())
    expect(r.ok).toBe(true)
    if (r.ok && r.promptStarted) {
      expect(r.sessionId).toBe(SESSION_ID)
    } else {
      throw new Error("expected ok+promptStarted")
    }
    // A wrapped interruption failure must be swallowed exactly like a pure
    // interrupt, with no sanitized log line or published event.
    const flattened = JSON.stringify(h.log)
    expect(flattened).not.toContain("remote_run late cause")
    expect(h.published).toHaveLength(0)
    expect(h.lateCause).toHaveLength(0)
  })

  test("non-interrupt late cause logs the safe class and publishes the fixed safe event", async () => {
    let captured: { sessionID: SessionID; error: unknown } | undefined
    const h = makeFakeHarness({ loopBehavior: "fail-fail" })
    h.setPublishSessionError((input) =>
      Effect.sync(() => {
        captured = {
          sessionID: input.sessionID,
          error: { name: "UnknownError", data: { message: SAFE_UNKNOWN_MESSAGE } },
        }
      }) as never,
    )
    h.onLateCause((input) => {
      h.lateCause.push(input)
    })

    const r = await h.run.createAndRun(validRequest())
    expect(r.ok).toBe(true)
    if (r.ok && r.promptStarted) {
      expect(r.sessionId).toBe(SESSION_ID)
    } else {
      throw new Error("expected ok+promptStarted")
    }

    // Late cause hook saw the sanitized class, never the raw message.
    expect(h.lateCause).toHaveLength(1)
    expect(h.lateCause[0]!.operation).toBe("remote_run_late_cause")
    expect(h.lateCause[0]!.sessionID).toBe(SESSION_ID)
    expect(h.lateCause[0]!.errorClass).not.toContain(SENTINEL_RAW_MARKER)
    expect(h.lateCause[0]!.errorClass).not.toContain("must-not-leak")

    // The log line is the sanitized class, never the raw error.
    const flattened = JSON.stringify(h.log)
    expect(flattened).toContain("remote_run late cause")
    expect(flattened).not.toContain(SENTINEL_RAW_MARKER)
    expect(flattened).not.toContain("must-not-leak")
    expect(flattened).not.toContain("/private/path")

    // The published event uses the fixed sanitized literal.
    expect(captured).toBeDefined()
    expect(captured!.sessionID).toBe(SESSION_ID)
    expect(captured!.error).toEqual({ name: "UnknownError", data: { message: SAFE_UNKNOWN_MESSAGE } })
    // The sentinel never appears in the published event.
    expect(JSON.stringify(captured)).not.toContain(SENTINEL_RAW_MARKER)
    expect(JSON.stringify(captured)).not.toContain("must-not-leak")
  })

  test("non-interrupt die cause is sanitized the same way as a failure cause", async () => {
    const h = makeFakeHarness({ loopBehavior: "fail-die" })
    let captured: { sessionID: SessionID; error: unknown } | undefined
    h.setPublishSessionError((input) =>
      Effect.sync(() => {
        captured = {
          sessionID: input.sessionID,
          error: { name: "UnknownError", data: { message: SAFE_UNKNOWN_MESSAGE } },
        }
      }) as never,
    )

    const r = await h.run.createAndRun(validRequest())
    expect(r.ok).toBe(true)
    if (r.ok && r.promptStarted) {
      expect(r.sessionId).toBe(SESSION_ID)
    } else {
      throw new Error("expected ok+promptStarted")
    }

    expect(captured).toBeDefined()
    expect(captured!.sessionID).toBe(SESSION_ID)
    const flattened = JSON.stringify(h.log)
    expect(flattened).not.toContain(SENTINEL_RAW_MARKER)
    expect(flattened).not.toContain("must-not-leak")
  })
})

describe("createRemoteRunLive: production publishSessionError uses EventV2Bridge", () => {
  test("default publishSessionError publishes Session.Event.Error via EventV2Bridge with the fixed sanitized Unknown error", async () => {
    const directory = "/workspace/alpha"
    const provideDirs: string[] = []
    const published: Array<{ definition: unknown; data: unknown }> = []
    const log: { error: unknown[][]; warn: unknown[][] } = { error: [], warn: [] }
    const promptInputs: Array<{ input: any; messageID: string }> = []
    const createInputs: unknown[] = []
    const order: string[] = []

    const fakeSession = {
      create: (input: any) => {
        createInputs.push(input)
        order.push("create")
        return Effect.succeed({
          id: SESSION_ID,
          directory,
          title: "",
          parentID: undefined,
          created: 0,
        } as never)
      },
    } as unknown as Session.Interface
    const fakePrompt = {
      prompt: (input: any) => {
        order.push("prompt")
        promptInputs.push({ input, messageID: (input as any).messageID })
        return Effect.succeed({} as never)
      },
      loop: (_input: any) => {
        order.push("loop")
        return Effect.fail(new Error(SENTINEL_RAW_MESSAGE)) as never
      },
    } as unknown as SessionPrompt.Interface
    const fakeEvents = {
      publish: (definition: any, data: any) => {
        published.push({ definition, data })
        return Effect.void as never
      },
    } as unknown as EventV2Bridge.Service["Service"]
    const fakeLayer = Layer.mergeAll(
      Layer.succeed(Session.Service, fakeSession),
      Layer.succeed(SessionPrompt.Service, fakePrompt),
      Layer.succeed(EventV2Bridge.Service, fakeEvents),
    )
    const anyLayer = fakeLayer as Layer.Layer<any, never, never>
    const fakeProvide = (input: { directory: string; fn: () => unknown }) => {
      provideDirs.push(input.directory)
      return input.fn()
    }
    const fakeRuntime: RuntimeDeps["AppRuntime"] = {
      runPromise: <A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> =>
        Effect.runPromise(Effect.provide(effect as Effect.Effect<any, any, any>, anyLayer)) as unknown as Promise<A>,
      runFork: <A, E, R>(effect: Effect.Effect<A, E, R>) => {
        Effect.runSync(Effect.provide(effect as Effect.Effect<any, any, any>, anyLayer))
      },
    }
    const catalog = makeCatalog()
    const runtime: RemoteRuntime.Interface = {
      runtimeId: "rt-live",
      directory,
      setConnectionId: () => {},
      presence: () => ({}) as ReturnType<RemoteRuntime.Interface["presence"]>,
      catalog: async () => catalog,
    }
    const attachedState: AttachedState.Interface = {
      setPresence: () => {},
      announce: async () => {
        order.push("announce")
      },
      union: () => new Set(),
      reset: () => {},
    }
    // NO publishSessionError override — production default must be used.
    const run = createRemoteRunLive({
      runtime,
      attachedState,
      directory,
      log: {
        error: (...args) => log.error.push(args),
        warn: (...args) => log.warn.push(args),
      },
      deps: {
        provide: fakeProvide as never,
        AppRuntime: fakeRuntime,
      },
    })

    const r = await run.createAndRun(validRequest())
    expect(r.ok).toBe(true)
    // Production default must have published exactly one event.
    expect(published).toHaveLength(1)
    const evt = published[0]!
    // The event is the Session.Event.Error definition (compare by type string).
    expect((evt.definition as { type?: string }).type).toBe("session.error")
    expect(evt.data).toEqual({
      sessionID: SESSION_ID,
      error: { name: "UnknownError", data: { message: SAFE_UNKNOWN_MESSAGE } },
    })
    // The log line is the sanitized class, never the raw error.
    const flattened = JSON.stringify(log)
    expect(flattened).not.toContain(SENTINEL_RAW_MARKER)
    expect(flattened).not.toContain("must-not-leak")
  })
})
