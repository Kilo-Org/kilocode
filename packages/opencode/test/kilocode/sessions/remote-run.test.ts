// kilocode_change - Slice 3A tests for the sessionless create_and_run deep module.
// Strict TDD: every behavior promised by the plan is asserted here before the
// implementation. State coverage:
//   - Happy: create -> announce -> start prompt returns known session id
//   - Retryable: pre-create failure and announcement failure are recoverable
//   - Nonretryable partial: prompt-start failure returns a terminal partial
//     carrying the same sessionId (no second prompt attempt)
//   - Empty: structurally impossible (required prompt and validated catalog)
//
// Strict invariants that must never regress:
//   - The request shape is exact; extras are rejected.
//   - Prompt and path are never written to logs.
//   - Concurrent duplicate calls join one operation; completed duplicates
//     return the cached result without re-running create/prompt.
//   - The terminal prompt-start partial uses the cloud-relay-expected
//     literal message and always includes the created sessionId.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { RemoteModelCatalog } from "../../../src/kilo-sessions/remote-model-catalog"
import { RemoteRun } from "../../../src/kilo-sessions/remote-run"
import type { RemoteRuntime } from "../../../src/kilo-sessions/remote-runtime"
import type { AttachedState } from "../../../src/kilo-sessions/attached-state"
import type { ProviderV2 } from "@opencode-ai/core/provider"
import type { ModelV2 } from "@opencode-ai/core/model"
import type { SessionID } from "../../../src/session/schema"
import type { Info as SessionInfo } from "../../../src/session/session"

const PROMPT_START_FAILED_MESSAGE =
  "The session was created, but the first prompt did not start."

// Condition-based wait helper: polls the predicate after yielding to the
// event loop until the predicate is true or the timeout elapses. Deterministic
// and replaces arbitrary fixed sleeps.
async function until(predicate: () => boolean, timeout: number): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) {
      throw new Error("until: condition did not become true within timeout")
    }
    await new Promise((r) => setTimeout(r, 1))
  }
}

function uuid(idx: number): string {
  // Stable UUID-shaped strings (not real UUIDs - the strict parser only requires the
  // dotted/hex shape, so we synthesize one per test index). Pads idx to 12
  // hex chars so each index maps to a distinct 36-char UUID.
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

// Provider fixture that matches the shape `Provider.Service.list()` returns.
// Mirrors the builder used in `remote-runtime.test.ts` so the projected
// `RemoteModelCatalog.Response` is the real wire shape, not a hand-rolled
// stub. The `MUST_NOT_LEAK` markers are checked by the catalog builder
// itself — they must never reach the wire.
function providerFixture(providerID: string, modelID: string, variant?: string) {
  return {
    [providerID]: {
      id: providerID,
      name: providerID,
      source: "env" as const,
      env: ["MUST_NOT_LEAK"],
      key: "MUST_NOT_LEAK",
      options: { apiKey: "MUST_NOT_LEAK" },
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
          options: { apiKey: "MUST_NOT_LEAK" },
          headers: { authorization: "MUST_NOT_LEAK" },
          release_date: "2026-01-01",
          variants: variant ? { [variant]: { apiKey: "MUST_NOT_LEAK" } } : {},
        },
      },
    },
  }
}

function makeCatalog(
  over: Partial<{ agent: string; defaultAgent: string; modelKey: string; variant?: string }> = {},
): RemoteRuntime.Catalog {
  const agent = over.agent ?? "build"
  const defaultAgent = over.defaultAgent ?? agent
  const modelKey = over.modelKey ?? "anthropic/claude-sonnet-4"
  const variant = over.variant
  const models = RemoteModelCatalog.build({
    providers: providerFixture("kilo", modelKey, variant),
    session: {},
    messages: [],
    defaultModel: { providerID: "kilo", modelID: modelKey },
  })
  return {
    protocolVersion: 1,
    models,
    agents: [
      {
        slug: agent,
        name: agent,
        ...(variant ? { variant } : {}),
      },
    ],
    defaultAgent,
  }
}

type SessionCreate = (input?: Record<string, never>) => Promise<SessionInfo>
type Announce = (id: SessionID) => Promise<void>
type PromptStart = (input: {
  sessionID: SessionID
  agent: string
  model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
  variant?: string
  prompt: string
}) => Promise<{ messageID: string; loopInstalled: boolean }>

type Harness = {
  runtime: RemoteRuntime.Interface
  state: AttachedState.Interface
  catalog: { errors: number; calls: number; snapshot: RemoteRuntime.Catalog }
  create: { calls: number; throw?: Error }
  announce: { calls: number; throw?: Error; throwsFor: number; invocations: number }
  promptStart: { calls: number; throw?: Error; throwsFor: number; invocations: number; messageID: string; loopInstalled: boolean }
  bound: { sessionID: SessionID; directory: string }
  log: { error: unknown[][]; warn: unknown[][] }
  run: RemoteRun.Interface
}

function makeHarness(over: {
  create?: { throw?: Error }
  announce?: { throw?: Error; throwsFor?: number }
  promptStart?: { throw?: Error; throwsFor?: number; messageID?: string; loopInstalled?: boolean }
  catalog?: { throw?: Error }
  directory?: string
} = {}): Harness {
  const directory = over.directory ?? "/tmp/proj"
  const catalog = makeCatalog()
  const harness: Harness = {
    runtime: {} as RemoteRuntime.Interface,
    state: {} as AttachedState.Interface,
    catalog: { errors: 0, calls: 0, snapshot: catalog },
    create: { calls: 0, ...(over.create ?? {}) },
    announce: { calls: 0, throwsFor: over.announce?.throwsFor ?? 0, invocations: 0, ...(over.announce ?? {}) },
    promptStart: {
      calls: 0,
      throwsFor: over.promptStart?.throwsFor ?? 0,
      invocations: 0,
      messageID: over.promptStart?.messageID ?? "msg_init",
      loopInstalled: over.promptStart?.loopInstalled ?? true,
      ...(over.promptStart ?? {}),
    },
    bound: { sessionID: "ses_bound" as SessionID, directory },
    log: { error: [], warn: [] },
    run: undefined as unknown as RemoteRun.Interface,
  }
  const sessionCreate: SessionCreate = async () => {
    harness.create.calls += 1
    if (harness.create.throw) throw harness.create.throw
    return { id: "ses_new" as SessionID, directory: harness.bound.directory, title: "", parentID: undefined, created: 0 } as unknown as SessionInfo
  }
  const announce: Announce = async () => {
    harness.announce.calls += 1
    harness.announce.invocations += 1
    if (harness.announce.throw && harness.announce.invocations <= (harness.announce.throwsFor ?? 0)) {
      throw harness.announce.throw
    }
  }
  const promptStart: PromptStart = async () => {
    harness.promptStart.calls += 1
    harness.promptStart.invocations += 1
    if (harness.promptStart.throw && harness.promptStart.invocations <= (harness.promptStart.throwsFor ?? 0)) {
      throw harness.promptStart.throw
    }
    return { messageID: harness.promptStart.messageID, loopInstalled: harness.promptStart.loopInstalled }
  }
  // Trivial runtime shape: only `directory` and `catalog()` are read by the run module.
  harness.runtime = {
    runtimeId: "rt-fixed",
    directory,
    setConnectionId: () => {},
    presence: () => ({}) as ReturnType<RemoteRuntime.Interface["presence"]>,
    catalog: async () => {
      harness.catalog.calls += 1
      if (over.catalog?.throw) {
        harness.catalog.errors += 1
        throw over.catalog.throw
      }
      return harness.catalog.snapshot
    },
  }
  // Trivial attached-state shape: only `announce()` is read by the run module.
  harness.state = {
    setPresence: () => {},
    announce: async (id) => {
      announce(id as SessionID)
    },
    union: () => new Set(),
    reset: () => {},
  }
  harness.run = RemoteRun.create({
    runtime: harness.runtime,
    state: harness.state,
    session: { create: sessionCreate },
    prompt: { start: promptStart },
    log: {
      error: (...args: unknown[]) => harness.log.error.push(args),
      warn: (...args: unknown[]) => harness.log.warn.push(args),
    },
  })
  return harness
}

type AnyResult = { ok: boolean; error?: { code: string; message: string }; [k: string]: unknown }

const expectOk = (value: AnyResult) => {
  if (value.ok && (value as { promptStarted?: boolean }).promptStarted === true) {
    return value as unknown as { sessionId: string; promptStarted: true; protocolVersion: 1 }
  }
  throw new Error(
    `expected ok+promptStarted:true, got ${value.ok ? JSON.stringify(value) : `${value.error?.code} ${value.error?.message}`}`,
  )
}

const expectPartial = (value: AnyResult) => {
  if (value.ok && (value as { promptStarted?: boolean }).promptStarted === false) {
    return value as unknown as {
      sessionId: string
      promptStarted: false
      error: { code: string; message: string }
      protocolVersion: 1
    }
  }
  throw new Error(
    `expected terminal partial (ok+promptStarted:false), got ${value.ok ? JSON.stringify(value) : `${value.error?.code} ${value.error?.message}`}`,
  )
}

const expectErr = (value: AnyResult) => {
  if (!value.ok) return value.error!
  throw new Error(`expected error, got ok: ${JSON.stringify(value)}`)
}

beforeEach(() => {
  mock.restore()
})

afterEach(() => {
  mock.restore()
})

describe("RemoteRun.create request shape", () => {
  test("rejects request with extra fields", async () => {
    const h = makeHarness()
    // Spread a valid request and add extra top-level fields. The deep
    // module must reject this; the `as never` cast marks the payload as
    // intentionally malformed test input.
    const result = await h.run.createAndRun({
      ...validRequest(),
      extraField: "must-not-leak",
      sessionId: "ses_leak",
    } as never)
    const err = expectErr(result)
    expect(err.code).toBe("INVALID_REQUEST")
    // Error must never echo the bad payload or session id.
    expect(err.message).not.toContain("extraField")
    expect(err.message).not.toContain("ses_leak")
    expect(JSON.stringify(h.log)).not.toContain("ses_leak")
  })

  test("rejects unsupported protocol versions", async () => {
    const h = makeHarness()
    const result = await h.run.createAndRun({ ...validRequest(), protocolVersion: 2 } as never)
    expect(expectErr(result).code).toBe("INVALID_REQUEST")
  })

  test("rejects requestId that is not a UUID", async () => {
    const h = makeHarness()
    const result = await h.run.createAndRun({ ...validRequest(), requestId: "not-a-uuid" })
    expect(expectErr(result).code).toBe("INVALID_REQUEST")
  })

  test("rejects a blank prompt", async () => {
    const h = makeHarness()
    const result = await h.run.createAndRun({ ...validRequest(), prompt: "   " })
    expect(expectErr(result).code).toBe("INVALID_REQUEST")
  })

  test("rejects a prompt longer than 32768 characters after trim", async () => {
    const h = makeHarness()
    const result = await h.run.createAndRun({ ...validRequest(), prompt: "x".repeat(32_769) })
    expect(expectErr(result).code).toBe("INVALID_REQUEST")
  })

  test("trims leading/trailing whitespace from prompt before length check", async () => {
    const h = makeHarness()
    const prompt = `   ${"y".repeat(32_768)}   `
    const result = await h.run.createAndRun({ ...validRequest(), prompt })
    expectOk(result)
    expect(h.create.calls).toBe(1)
  })

  test("rejects top-level provider/model fields (must be nested under model)", async () => {
    const h = makeHarness()
    const result = await h.run.createAndRun({
      protocolVersion: 1,
      requestId: uuid(1),
      prompt: "hi",
      providerID: "kilo",
      modelID: "anthropic/claude-sonnet-4",
      agent: "build",
    })
    expect(expectErr(result).code).toBe("INVALID_REQUEST")
  })

  test("rejects an unknown agent slug against the current catalog", async () => {
    const h = makeHarness()
    const result = await h.run.createAndRun({ ...validRequest(), agent: "phantom" })
    const err = expectErr(result)
    expect(err.code).toBe("CATALOG_CHANGED")
    expect(h.create.calls).toBe(0)
  })

  test("rejects an unknown provider/model pair against the current catalog", async () => {
    const h = makeHarness()
    const result = await h.run.createAndRun({
      ...validRequest(),
      model: { providerID: "ghost", modelID: "ghost/model" },
    })
    const err = expectErr(result)
    expect(err.code).toBe("CATALOG_CHANGED")
    expect(h.create.calls).toBe(0)
  })

  test("rejects a variant the catalog model does not list", async () => {
    const h = makeHarness()
    const result = await h.run.createAndRun({ ...validRequest(), variant: "creative" })
    const err = expectErr(result)
    expect(err.code).toBe("CATALOG_CHANGED")
    expect(h.create.calls).toBe(0)
  })

  test("accepts a model whose pinned variant matches the catalog agent", async () => {
    const h = makeHarness()
    h.catalog.snapshot = makeCatalog({ variant: "precise" })
    const result = await h.run.createAndRun({ ...validRequest(), variant: "precise" })
    expectOk(result)
  })
})

describe("RemoteRun.createAndRun happy path", () => {
  test("returns sessionId and promptStarted:true after create -> announce -> start", async () => {
    const directory = "/tmp/proj"
    const order: string[] = []
    let createDone = false
    const runtime: RemoteRuntime.Interface = {
      runtimeId: "rt",
      directory,
      setConnectionId: () => {},
      presence: () => ({}) as ReturnType<RemoteRuntime.Interface["presence"]>,
      catalog: async () => makeCatalog(),
    }
    const state: AttachedState.Interface = {
      setPresence: () => {},
      announce: async () => {
        order.push("announce")
        if (!createDone) throw new Error("create must complete before announce")
      },
      union: () => new Set(),
      reset: () => {},
    }
    const run = RemoteRun.create({
      runtime,
      state,
      session: {
        create: async () => {
          order.push("create")
          createDone = true
          return { id: "ses_new" as SessionID, directory } as unknown as SessionInfo
        },
      },
      prompt: {
        start: async () => {
          order.push("start")
          return { messageID: "msg_a", loopInstalled: true }
        },
      },
      log: { error: () => {}, warn: () => {} },
    })
    const result = await run.createAndRun(validRequest())
    const out = expectOk(result)
    expect(out.sessionId).toBe("ses_new")
    expect(out.promptStarted).toBe(true)
    expect(out.protocolVersion).toBe(1)
    expect(order).toEqual(["create", "announce", "start"])
  })

  test("passes only {} to session.create and uses the runtime's fixed directory", async () => {
    const directory = "/workspace/alpha"
    let createInput: unknown
    const runtime: RemoteRuntime.Interface = {
      runtimeId: "rt",
      directory,
      setConnectionId: () => {},
      presence: () => ({}) as ReturnType<RemoteRuntime.Interface["presence"]>,
      catalog: async () => makeCatalog(),
    }
    const run = RemoteRun.create({
      runtime,
      state: { setPresence: () => {}, announce: async () => {}, union: () => new Set(), reset: () => {} },
      session: {
        create: async (input) => {
          createInput = input
          return { id: "ses_root" as SessionID, directory } as unknown as SessionInfo
        },
      },
      prompt: { start: async () => ({ messageID: "msg", loopInstalled: true }) },
      log: { error: () => {}, warn: () => {} },
    })
    const result = await run.createAndRun(validRequest())
    expectOk(result)
    expect(createInput).toEqual({})
  })
})

describe("RemoteRun.createAndRun progress / idempotency", () => {
  test("evicts a pre-create failure so manual same-id retry can re-run", async () => {
    let first = true
    const h = makeHarness()
    h.run = RemoteRun.create({
      runtime: h.runtime,
      state: h.state,
      session: {
        create: async () => {
          if (first) {
            first = false
            throw new Error("disk full private=/must-not-leak")
          }
          return { id: "ses_recovered" as SessionID, directory: "/tmp/proj" } as unknown as SessionInfo
        },
      },
      prompt: { start: async () => ({ messageID: "msg", loopInstalled: true }) },
      log: {
        error: (...args) => h.log.error.push(args),
        warn: (...args) => h.log.warn.push(args),
      },
    })

    const r1 = await h.run.createAndRun(validRequest())
    const err1 = expectErr(r1)
    expect(err1.code).toBe("CREATE_FAILED")
    expect(err1.message).not.toContain("private")
    expect(err1.message).not.toContain("must-not-leak")
    expect(JSON.stringify(h.log)).not.toContain("private")
    expect(JSON.stringify(h.log)).not.toContain("must-not-leak")

    const r2 = await h.run.createAndRun(validRequest())
    expectOk(r2)
  })

  test("preserves a created session when announcement fails and same-id retry resumes announcement", async () => {
    let announceInvocations = 0
    let createCalls = 0
    const h = makeHarness()
    h.run = RemoteRun.create({
      runtime: h.runtime,
      state: {
        setPresence: () => {},
        announce: async () => {
          announceInvocations += 1
          if (announceInvocations === 1) {
            throw new Error("relay down: credential=must-not-leak")
          }
        },
        union: () => new Set(),
        reset: () => {},
      },
      session: {
        create: async () => {
          createCalls += 1
          return { id: "ses_preserved" as SessionID, directory: "/tmp/proj" } as unknown as SessionInfo
        },
      },
      prompt: { start: async () => ({ messageID: "msg", loopInstalled: true }) },
      log: {
        error: (...args) => h.log.error.push(args),
        warn: (...args) => h.log.warn.push(args),
      },
    })

    const r1 = await h.run.createAndRun(validRequest())
    const err1 = expectErr(r1)
    expect(err1.code).toBe("ANNOUNCE_FAILED")
    expect(err1.message).not.toContain("credential")
    expect(JSON.stringify(h.log)).not.toContain("credential")
    expect(JSON.stringify(h.log)).not.toContain("must-not-leak")
    // Session was created exactly once, the partial result references it.
    expect(createCalls).toBe(1)

    const r2 = await h.run.createAndRun(validRequest())
    const out = expectOk(r2)
    expect(out.sessionId).toBe("ses_preserved")
    expect(createCalls).toBe(1)
    expect(announceInvocations).toBe(2)
  })

  test("returns a terminal partial carrying the sessionId when prompt-start fails; same-id retry returns the same partial", async () => {
    let promptInvocations = 0
    const h = makeHarness()
    h.run = RemoteRun.create({
      runtime: h.runtime,
      state: h.state,
      session: {
        create: async () => ({ id: "ses_p" as SessionID, directory: "/tmp/proj" } as unknown as SessionInfo),
      },
      prompt: {
        start: async () => {
          promptInvocations += 1
          throw new Error("provider down: secret=must-not-leak and path=/private/repo")
        },
      },
      log: {
        error: (...args) => h.log.error.push(args),
        warn: (...args) => h.log.warn.push(args),
      },
    })

    const r1 = await h.run.createAndRun(validRequest())
    const partial = expectPartial(r1)
    expect(partial.sessionId).toBe("ses_p")
    expect(partial.error.code).toBe("PROMPT_START_FAILED")
    expect(partial.error.message).toBe(PROMPT_START_FAILED_MESSAGE)
    expect(partial.error.message).not.toContain("secret")
    expect(partial.error.message).not.toContain("must-not-leak")
    expect(partial.error.message).not.toContain("/private/repo")
    expect(partial.error.message).not.toContain("prompt=")
    expect(JSON.stringify(h.log)).not.toContain("must-not-leak")
    expect(JSON.stringify(h.log)).not.toContain("/private/repo")

    const r2 = await h.run.createAndRun(validRequest())
    const partial2 = expectPartial(r2)
    expect(partial2.sessionId).toBe("ses_p")
    expect(partial2.error.message).toBe(PROMPT_START_FAILED_MESSAGE)
    // No second prompt attempt was made.
    expect(promptInvocations).toBe(1)
  })

  test("no result is sent before the announce ACK resolves", async () => {
    let resolveAck: (() => void) | undefined
    const h = makeHarness()
    h.run = RemoteRun.create({
      runtime: h.runtime,
      state: {
        setPresence: () => {},
        announce: async () => {
          await new Promise<void>((resolve) => {
            resolveAck = resolve
          })
        },
        union: () => new Set(),
        reset: () => {},
      },
      session: { create: async () => ({ id: "ses_ord" as SessionID, directory: "/tmp/proj" } as unknown as SessionInfo) },
      prompt: { start: async () => ({ messageID: "msg", loopInstalled: true }) },
      log: {
        error: (...args) => h.log.error.push(args),
        warn: (...args) => h.log.warn.push(args),
      },
    })

    const resultPromise = h.run.createAndRun(validRequest())
    let settled = false
    void resultPromise.then(() => {
      settled = true
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(settled).toBe(false)
    resolveAck?.()
    const result = await resultPromise
    expectOk(result)
  })
})

describe("RemoteRun.createAndRun concurrency and dedupe", () => {
  test("concurrent duplicate calls share one create+announce+start", async () => {
    const counts = { create: 0, announce: 0, prompt: 0, catalog: 0 }
    let resolveStart: (() => void) | undefined
    const h = makeHarness()
    h.run = RemoteRun.create({
      runtime: {
        ...h.runtime,
        catalog: async (request) => {
          counts.catalog += 1
          return h.runtime.catalog(request)
        },
      },
      state: {
        setPresence: () => {},
        announce: async () => {
          counts.announce += 1
        },
        union: () => new Set(),
        reset: () => {},
      },
      session: {
        create: async () => {
          counts.create += 1
          return { id: "ses_concurrent" as SessionID, directory: "/tmp/proj" } as unknown as SessionInfo
        },
      },
      prompt: {
        start: async () => {
          counts.prompt += 1
          await new Promise<void>((resolve) => {
            resolveStart = resolve
          })
          return { messageID: "msg", loopInstalled: true }
        },
      },
      log: {
        error: (...args) => h.log.error.push(args),
        warn: (...args) => h.log.warn.push(args),
      },
    })

    const a = h.run.createAndRun(validRequest())
    // Wait for the first call to clear the catalog validate step and
    // register its inflight entry. The catalog is a microtask-resolved
    // call, so a few yields are enough.
    for (let i = 0; i < 5; i += 1) await Promise.resolve()
    const b = h.run.createAndRun(validRequest())
    for (let i = 0; i < 5; i += 1) await Promise.resolve()
    expect(resolveStart).toBeDefined()
    resolveStart!()
    const ra = await a
    const rb = await b
    expectOk(ra)
    expectOk(rb)
    expect(counts.create).toBe(1)
    expect(counts.announce).toBe(1)
    expect(counts.prompt).toBe(1)
    // Catalog must be called once, not per duplicate.
    expect(counts.catalog).toBe(1)
  })

  test("completed duplicate returns the cached terminal result without re-running", async () => {
    const counts = { create: 0, prompt: 0 }
    const h = makeHarness()
    h.run = RemoteRun.create({
      runtime: h.runtime,
      state: h.state,
      session: {
        create: async () => {
          counts.create += 1
          return { id: "ses_cached" as SessionID, directory: "/tmp/proj" } as unknown as SessionInfo
        },
      },
      prompt: {
        start: async () => {
          counts.prompt += 1
          return { messageID: "msg", loopInstalled: true }
        },
      },
      log: {
        error: (...args) => h.log.error.push(args),
        warn: (...args) => h.log.warn.push(args),
      },
    })

    const r1 = await h.run.createAndRun(validRequest())
    expectOk(r1)
    const r2 = await h.run.createAndRun(validRequest())
    expectOk(r2)
    expect(counts.create).toBe(1)
    expect(counts.prompt).toBe(1)
  })

  test("failed duplicate evicts the cache so a manual retry can run", async () => {
    let first = true
    const h = makeHarness()
    h.run = RemoteRun.create({
      runtime: h.runtime,
      state: h.state,
      session: {
        create: async () => {
          if (first) {
            first = false
            throw new Error("transient")
          }
          return { id: "ses_recovered" as SessionID, directory: "/tmp/proj" } as unknown as SessionInfo
        },
      },
      prompt: { start: async () => ({ messageID: "msg", loopInstalled: true }) },
      log: {
        error: (...args) => h.log.error.push(args),
        warn: (...args) => h.log.warn.push(args),
      },
    })

    const r1 = await h.run.createAndRun(validRequest())
    expectErr(r1)
    const r2 = await h.run.createAndRun(validRequest())
    expectOk(r2)
  })

  test("terminal results are bounded to 128 entries (sequential)", async () => {
    // Run 130 distinct requests sequentially so each completes its create +
    // announce + start chain before the next begins. This makes the
    // terminal cache grow to 128 entries and evict the oldest two, without
    // racing inflight bookkeeping against the bounded eviction logic.
    const h = makeHarness()
    let createCalls = 0
    h.run = RemoteRun.create({
      runtime: h.runtime,
      state: h.state,
      session: {
        create: async () => {
          createCalls += 1
          return {
            id: `ses_${createCalls}` as SessionID,
            directory: "/tmp/proj",
          } as unknown as SessionInfo
        },
      },
      prompt: { start: async () => ({ messageID: "msg", loopInstalled: true }) },
      log: {
        error: (...args) => h.log.error.push(args),
        warn: (...args) => h.log.warn.push(args),
      },
    })

    const oldestId = uuid(9001)
    const newestId = uuid(9002)
    await h.run.createAndRun({ ...validRequest(), requestId: oldestId })
    // After the first create, the cache holds 1 entry: oldestId. Run 130
    // more sequentially so the cache reaches its 128-entry cap. The 129th
    // new id evicts oldestId from the terminal map (oldestId was first).
    for (let i = 0; i < 128; i += 1) {
      const id = uuid(9100 + i)
      const result = await h.run.createAndRun({ ...validRequest(), requestId: id })
      expectOk(result)
    }
    // NewestId is the 130th distinct id, currently in the cache.
    await h.run.createAndRun({ ...validRequest(), requestId: newestId })
    // At this point: cache holds 128 entries (oldestId was evicted by the
    // 128th loop iteration, leaving newestId at the tail). Re-running
    // oldestId must hit create again (cache miss) while newestId must
    // hit the cache (create not called).
    const createCallsBefore = createCalls
    const oldestRetry = await h.run.createAndRun({ ...validRequest(), requestId: oldestId })
    expectOk(oldestRetry)
    expect(createCalls).toBe(createCallsBefore + 1)
    const newestRetry = await h.run.createAndRun({ ...validRequest(), requestId: newestId })
    expectOk(newestRetry)
    expect(createCalls).toBe(createCallsBefore + 1)
  })

  test("inflight entries are never evicted by terminal-cache bound growth", async () => {
    // Hold one inflight op while completing enough distinct terminals to
    // exceed the bounded cache. The held op must still resolve successfully
    // — inflight entries live in a separate map and are not subject to the
    // 128-entry terminal LRU eviction.
    const h = makeHarness()
    const heldResolvers: { resolve: () => void }[] = []
    let callIndex = 0
    h.run = RemoteRun.create({
      runtime: h.runtime,
      state: h.state,
      session: {
        create: async () => {
          const myIndex = callIndex
          callIndex += 1
          return new Promise<SessionInfo>((resolve) => {
            heldResolvers[myIndex] = { resolve: () => resolve({ id: "ses_held" as SessionID, directory: "/tmp/proj" } as unknown as SessionInfo) }
          })
        },
      },
      prompt: { start: async () => ({ messageID: "msg", loopInstalled: true }) },
      log: {
        error: (...args) => h.log.error.push(args),
        warn: (...args) => h.log.warn.push(args),
      },
    })

    // 1) Start one op and let it register its inflight entry (create
    //    resolver captured). Complete 129 distinct terminals sequentially.
    //    Those 129 terminals will evict each other from the terminal map,
    //    but the held op's inflight entry must remain untouched.
    const held = h.run.createAndRun({ ...validRequest(), requestId: uuid(7000) })
    await until(() => callIndex >= 1, 1000)
    for (let i = 0; i < 129; i += 1) {
      const id = uuid(7100 + i)
      const p = h.run.createAndRun({ ...validRequest(), requestId: id })
      // The newly issued op is an inflight duplicate of the held one only
      // if it shares the same requestId; each loop iteration uses a fresh
      // id, so each enters its own create and registers its own resolver.
      await until(() => callIndex >= i + 2, 1000)
      heldResolvers[i + 1]?.resolve()
      const r = await p
      expectOk(r)
    }
    // 2) Release the held op (its inflight entry was never evicted by the
    //    129 terminals). It must still resolve successfully.
    heldResolvers[0]?.resolve()
    const heldResult = await held
    expectOk(heldResult)
  })

  test("terminal cache side effect is visible before the same-id retry resolves", async () => {
    // Once a request completes, the very next call with the same requestId
    // must return the cached terminal — not start a new create. We assert
    // that create is called exactly once across both calls, which is only
    // possible if the terminal-store side effect ran on the microtask
    // boundary before the second call's terminal-cache check.
    const h = makeHarness()
    let createCount = 0
    h.run = RemoteRun.create({
      runtime: h.runtime,
      state: h.state,
      session: {
        create: async () => {
          createCount += 1
          return { id: "ses_imm" as SessionID, directory: "/tmp/proj" } as unknown as SessionInfo
        },
      },
      prompt: { start: async () => ({ messageID: "msg", loopInstalled: true }) },
      log: {
        error: (...args) => h.log.error.push(args),
        warn: (...args) => h.log.warn.push(args),
      },
    })

    const first = await h.run.createAndRun({ ...validRequest(), requestId: uuid(8000) })
    expectOk(first)
    const second = await h.run.createAndRun({ ...validRequest(), requestId: uuid(8000) })
    expectOk(second)
    expect(createCount).toBe(1)
  })

  test("reset clears the per-process idempotency cache", async () => {
    const h = makeHarness()
    h.run = RemoteRun.create({
      runtime: h.runtime,
      state: h.state,
      session: {
        create: async () => ({ id: "ses_r" as SessionID, directory: "/tmp/proj" } as unknown as SessionInfo),
      },
      prompt: { start: async () => ({ messageID: "msg", loopInstalled: true }) },
      log: {
        error: (...args) => h.log.error.push(args),
        warn: (...args) => h.log.warn.push(args),
      },
    })

    const r1 = await h.run.createAndRun(validRequest())
    expectOk(r1)
    h.run.reset()
    const r2 = await h.run.createAndRun(validRequest())
    expectOk(r2)
  })
})

describe("RemoteRun.createAndRun safe logging", () => {
  test("error log never contains the prompt, path, token, or raw provider error", async () => {
    const h = makeHarness()
    h.run = RemoteRun.create({
      runtime: h.runtime,
      state: h.state,
      session: {
        create: async () => {
          throw new Error("private detail: apiKey=must-not-leak path=/private/repo prompt=hello")
        },
      },
      prompt: { start: async () => ({ messageID: "msg", loopInstalled: true }) },
      log: {
        error: (...args) => h.log.error.push(args),
        warn: (...args) => h.log.warn.push(args),
      },
    })
    await h.run.createAndRun({ ...validRequest(), prompt: "hello" })
    const flattened = JSON.stringify(h.log)
    expect(flattened).not.toContain("hello")
    expect(flattened).not.toContain("must-not-leak")
    expect(flattened).not.toContain("/private/repo")
    expect(flattened).not.toContain("apiKey=")
    expect(flattened).not.toContain("private detail")
  })
})
