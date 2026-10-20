// v1 fixture child: offline network wait and reconnect (U-E2-01). See v1.mjs.
import fs from "node:fs/promises"
import path from "node:path"
import { effect, source, url, write } from "./v1.mjs"

const { Effect, Schedule, Fiber, Exit, Clock } = await effect()
const TestClock = await import(url("packages/opencode/node_modules/effect/dist/testing/TestClock.js"))
const { APICallError } = await import(url("packages/opencode/node_modules/ai/dist/index.mjs"))
const { SessionRetry } = await source("packages/opencode/src/session/retry.ts")
const { SessionNetwork } = await source("packages/opencode/src/session/network.ts")
const { MessageV2 } = await source("packages/opencode/src/session/message-v2.ts")
const { KiloSessionProcessor } = await source("packages/opencode/src/kilocode/session/processor.ts")

const providerID = "test"
const WALL = "<wall-clock Date.now()>"

// Build a raw error from a JSON spec. Plain objects pass through unchanged.
// "$type" markers build the few non-plain shapes the v1 code inspects.
function raw(spec) {
  if (spec === null || typeof spec !== "object") return spec
  if (spec.$type === "Error") {
    const err = new Error(spec.message, spec.cause === undefined ? undefined : { cause: raw(spec.cause) })
    if (spec.code) err.code = spec.code
    return err
  }
  if (spec.$type === "DOMException") return new DOMException(spec.message, spec.name)
  if (spec.$type === "DisconnectedError") return new KiloSessionProcessor.DisconnectedError()
  if (spec.$type === "APICallError")
    return new APICallError({
      message: spec.message,
      url: spec.url ?? "https://api.example.com/v1/chat/completions",
      requestBodyValues: {},
      statusCode: spec.statusCode,
      responseHeaders: spec.responseHeaders,
      responseBody: spec.responseBody,
      isRetryable: spec.isRetryable,
    })
  return spec
}

const json = (value) => (value === undefined ? null : JSON.parse(JSON.stringify(value)))

// ---- 1. raw error classification ----------------------------------------
const rawCases = {
  "reset-code": { code: "ECONNRESET", syscall: "read", message: "read ECONNRESET" },
  "reset-nested-in-cause": {
    $type: "Error",
    message: "fetch failed",
    cause: { code: "ECONNRESET", syscall: "read", message: "read ECONNRESET" },
  },
  "refused-code": { code: "ECONNREFUSED", syscall: "connect", message: "connect ECONNREFUSED 127.0.0.1:3000" },
  "dns-notfound": { code: "ENOTFOUND", syscall: "getaddrinfo", message: "getaddrinfo ENOTFOUND api.example.com" },
  "timedout-nested-in-cause": { message: "top", cause: { code: "ETIMEDOUT" } },
  "fetch-failed": { $type: "Error", message: "fetch failed" },
  "aggregate-enetdown": { message: "request failed", errors: [{ message: "top" }, { code: "ENETDOWN" }] },
  "unable-to-connect": { $type: "Error", message: "Unable to connect. Is the computer able to access the url?" },
  "socket-hang-up": { $type: "Error", message: "socket hang up" },
  "offline-guard-stall": { $type: "DisconnectedError" },
  "abort-signal-timeout": {
    $type: "DOMException",
    name: "TimeoutError",
    message: "The operation was aborted due to timeout",
  },
  "epipe-code": { code: "EPIPE", syscall: "write", message: "write EPIPE" },
  "econnreset-text-only": { $type: "Error", message: "read ECONNRESET" },
  "http-429-retry-after": {
    $type: "APICallError",
    message: "429 status code (no body)",
    statusCode: 429,
    responseHeaders: { "content-type": "application/json", "retry-after": "7" },
    isRetryable: true,
  },
  "http-400": {
    $type: "APICallError",
    message: "Bad request",
    statusCode: 400,
    responseHeaders: { "content-type": "application/json" },
    responseBody: '{"error":{"message":"bad"}}',
    isRetryable: false,
  },
}

// One fresh policy step with an offline handler that answers "retry".
// Reports the branch the real policy takes for the first failure.
function route(input) {
  return Effect.gen(function* () {
    const sets = []
    const state = { offline: [] }
    const step = yield* Schedule.toStepWithMetadata(
      SessionRetry.policy({
        provider: providerID,
        parse: (e) => MessageV2.fromError(e, { providerID }),
        set: (info) => Effect.sync(() => sets.push(info)),
        offline: (info) => Effect.sync(() => (state.offline.push(info.message), "retry")),
      }),
    )
    const before = yield* Clock.currentTimeMillis
    const fiber = yield* Effect.forkChild(Effect.suspend(() => step(input)))
    yield* TestClock.adjust("1 hour")
    const exit = yield* Fiber.await(fiber)
    const set = sets[0]
    if (Exit.isFailure(exit)) return { branch: "stop", offlineCalls: state.offline.length, set: null }
    if (state.offline.length > 0)
      return {
        branch: "offline-wait",
        offlineMessage: state.offline[0],
        set: { attempt: set.attempt, message: set.message, next: WALL },
      }
    return {
      branch: "backoff",
      set: { attempt: set.attempt, message: set.message, delayMs: set.next - before },
    }
  })
}

const run = (effect) => Effect.runPromise(effect.pipe(Effect.provide(TestClock.layer())))

// Pin jitter so backoff output is deterministic (random = 0, the lower bound).
const realRandom = Math.random
Math.random = () => 0

const classification = {}
for (const [name, spec] of Object.entries(rawCases)) {
  const input = raw(spec)
  const parsed = MessageV2.fromError(input, { providerID })
  classification[name] = {
    input: spec,
    disconnected: SessionNetwork.disconnected(input),
    code: SessionNetwork.code(input) ?? null,
    networkMessage: SessionNetwork.message(input),
    fromError: json(parsed),
    serverReset: SessionNetwork.serverReset(parsed),
    retryable: json(SessionRetry.retryable(parsed, providerID)),
    policyFirstStep: await run(route(input)),
  }
}

// ---- 2. normalized APIError classification ------------------------------
const api = (data) => ({ name: "APIError", data })
const normalizedCases = {
  "reset-retryable": api({
    message: "Connection reset by server",
    isRetryable: true,
    metadata: { code: "ECONNRESET", syscall: "read", message: "read ECONNRESET" },
  }),
  "reset-message-only-retryable": api({
    message: "Connection reset by server",
    isRetryable: true,
    metadata: { code: "", syscall: "", message: "fetch failed" },
  }),
  "reset-not-retryable (blockRetry after output)": api({ message: "Connection reset by server", isRetryable: false }),
  "refused-retryable": api({
    message: "Connection refused",
    isRetryable: true,
    metadata: { code: "ECONNREFUSED", syscall: "connect", message: "connect ECONNREFUSED 127.0.0.1:3000" },
  }),
  "429-retryable": api({ message: "Too Many Requests", statusCode: 429, isRetryable: true }),
  "400-not-retryable": api({ message: "Bad request", statusCode: 400, isRetryable: false }),
  "400-retryable-body-text": api({
    message: "Request failed",
    statusCode: 400,
    isRetryable: false,
    responseBody: '{"error":{"message":"upstream connection refused"}}',
  }),
  "503-not-marked-retryable": api({ message: "Service unavailable", statusCode: 503, isRetryable: false }),
  overloaded: api({ message: "Overloaded", statusCode: 529, isRetryable: true }),
  "free-usage-limit": api({
    message: "Free usage exceeded",
    statusCode: 429,
    isRetryable: true,
    responseBody: '{"type":"error","error":{"type":"FreeUsageLimitError","message":"Free usage exceeded"}}',
  }),
  "kilo-paid-model-auth": api({
    message: "Sign in required",
    statusCode: 401,
    isRetryable: true,
    responseBody: '{"error":{"code":"PAID_MODEL_AUTH_REQUIRED"}}',
  }),
  "context-overflow": {
    name: "ContextOverflowError",
    data: {
      message: "Input exceeds context window of this model",
      responseBody: '{"error":{"code":"context_length_exceeded"}}',
    },
  },
  "unknown-rate-limit-text": { name: "UnknownError", data: { message: "Rate limit exceeded, please try again later" } },
}
const normalized = Object.fromEntries(
  Object.entries(normalizedCases).map(([name, input]) => [
    name,
    {
      input,
      retryable: json(SessionRetry.retryable(input, providerID)),
      serverReset: SessionNetwork.serverReset(input),
    },
  ]),
)
normalized["blockRetry-of-reset"] = {
  input: normalizedCases["reset-retryable"],
  blockRetry: json(KiloSessionProcessor.blockRetry(normalizedCases["reset-retryable"])),
  retryable: json(
    SessionRetry.retryable(KiloSessionProcessor.blockRetry(normalizedCases["reset-retryable"]), providerID),
  ),
}

// ---- 3. delay ------------------------------------------------------------
const withHeaders = (responseHeaders) => api({ message: "boom", isRetryable: true, responseHeaders })
const range = (n) => Array.from({ length: n }, (_, i) => i + 1)
const delayCases = {
  "no-error random=0 attempts 1..7": { error: null, random: 0, attempts: range(7) },
  "no-error random=1 attempts 1..6": { error: null, random: 1, attempts: range(6) },
  "no-headers random=0.5 attempts 1..6": {
    error: api({ message: "boom", isRetryable: true }),
    random: 0.5,
    attempts: range(6),
  },
  "headers-without-hint random=0 attempts 1..8 (no 30s cap)": {
    error: withHeaders({ "content-type": "application/json" }),
    random: 0,
    attempts: range(8),
  },
  "retry-after-ms 1500": { error: withHeaders({ "retry-after-ms": "1500" }), random: 0, attempts: [1, 4] },
  "retry-after-ms 0": { error: withHeaders({ "retry-after-ms": "0" }), random: 0, attempts: [3] },
  "retry-after-ms beats retry-after": {
    error: withHeaders({ "retry-after-ms": "250", "retry-after": "30" }),
    random: 0,
    attempts: [1],
  },
  "retry-after seconds 30": { error: withHeaders({ "retry-after": "30" }), random: 0, attempts: [3] },
  "retry-after fractional 1.5": { error: withHeaders({ "retry-after": "1.5" }), random: 0, attempts: [1] },
  "retry-after 600 (no upper cap besides timer max)": {
    error: withHeaders({ "retry-after": "600" }),
    random: 0,
    attempts: [1],
  },
  "retry-after-ms invalid falls to retry-after": {
    error: withHeaders({ "retry-after-ms": "abc", "retry-after": "2" }),
    random: 0,
    attempts: [1],
  },
  "retry-after invalid falls to uncapped exponential": {
    error: withHeaders({ "retry-after": "not-a-number" }),
    random: 0,
    attempts: [1, 6],
  },
  "retry-after past http-date falls to exponential": {
    error: withHeaders({ "retry-after": "Thu, 01 Jan 1970 00:00:00 GMT" }),
    random: 0,
    attempts: [1],
  },
  "retry-after far-future http-date capped": {
    error: withHeaders({ "retry-after": "Fri, 01 Jan 2100 00:00:00 GMT" }),
    random: 0,
    attempts: [1],
  },
  "retry-after-ms oversized capped": {
    error: withHeaders({ "retry-after-ms": "999999999999" }),
    random: 0,
    attempts: [1],
  },
}
const delay = Object.fromEntries(
  Object.entries(delayCases).map(([name, c]) => [
    name,
    { ...c, output: c.attempts.map((n) => SessionRetry.delay(n, c.error ?? undefined, c.random)) },
  ]),
)

// ---- 4. policy timelines -------------------------------------------------
const events = {
  reset: () => raw(rawCases["reset-code"]),
  offline: () => raw(rawCases["refused-code"]),
  provider: () =>
    raw({
      $type: "APICallError",
      message: "429 status code (no body)",
      statusCode: 429,
      responseHeaders: { "content-type": "application/json" },
      isRetryable: true,
    }),
  provider0: () =>
    raw({
      $type: "APICallError",
      message: "429 status code (no body)",
      statusCode: 429,
      responseHeaders: { "content-type": "application/json", "retry-after-ms": "0" },
      isRetryable: true,
    }),
}

// Drives the real v1 SessionRetry.policy with a TestClock.
// offline: undefined (no handler) | { result, waitMs } (handler sleeps waitMs, then answers result).
function timeline(input) {
  return Effect.gen(function* () {
    const log = []
    const counts = { offline: 0 }
    const parse = input.blockRetry
      ? (e) => KiloSessionProcessor.blockRetry(MessageV2.fromError(e, { providerID }))
      : (e) => MessageV2.fromError(e, { providerID })
    const step = yield* Schedule.toStepWithMetadata(
      SessionRetry.policy({
        provider: providerID,
        parse,
        limit: input.limit,
        set: (info) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            log.at(-1).set = {
              attempt: info.attempt,
              message: info.message,
              ...(info.message === "Reconnected" ? { next: WALL } : { delayMs: info.next - now }),
            }
          }),
        offline: input.offline
          ? (info) =>
              Effect.gen(function* () {
                counts.offline += 1
                log.at(-1).offline = {
                  message: info.message,
                  waitedMs: input.offline.waitMs,
                  result: input.offline.result,
                }
                yield* Effect.sleep(input.offline.waitMs)
                return input.offline.result
              })
          : undefined,
      }),
    )
    for (const [index, kind] of input.events.entries()) {
      log.push({ failure: index + 1, kind })
      const fiber = yield* Effect.forkChild(Effect.suspend(() => step(events[kind]())))
      yield* TestClock.adjust("1 hour")
      const exit = yield* Fiber.await(fiber)
      if (Exit.isFailure(exit)) {
        log.at(-1).decision = "stop"
        break
      }
      log.at(-1).decision = "retry"
    }
    const retried = log.filter((item) => item.decision === "retry")
    return {
      events: input.events,
      limit: input.limit ?? null,
      offlineHandler: input.offline ?? null,
      blockRetry: input.blockRetry ?? false,
      offlineCalls: counts.offline,
      attempts: retried.map((item) => item.set?.attempt ?? null),
      backoffDelaysMs: retried.filter((item) => item.set && "delayMs" in item.set).map((item) => item.set.delayMs),
      stopped: log.some((item) => item.decision === "stop"),
      stoppedAtFailure: log.find((item) => item.decision === "stop")?.failure ?? null,
      // Virtual time the schedule spent waiting (offline handler waits + backoff sleeps).
      totalWaitMs: log.reduce((sum, item) => sum + (item.offline?.waitedMs ?? 0) + (item.set?.delayMs ?? 0), 0),
      steps: log.map((item) => ({
        kind: item.kind,
        decision: item.decision,
        ...(item.offline ? { offline: item.offline.message, handler: item.offline.result } : {}),
        ...(item.set ? item.set : {}),
      })),
    }
  })
}

const repeat = (kind, n) => Array.from({ length: n }, () => kind)
const retryNow = { result: "retry", waitMs: 120_000 }
const timelineCases = {
  "reset x6, no limit: normal backoff then stop": { events: repeat("reset", 6), offline: retryNow },
  "provider 429 with headers x6: uncapped backoff then stop": { events: repeat("provider", 6), offline: retryNow },
  "offline x8 (120s wait each) then provider: waits past bound and resumes": {
    events: [...repeat("offline", 8), "provider"],
    offline: retryNow,
  },
  "provider/offline alternating x6: offline does not consume provider budget": {
    events: repeat(["provider0", "offline"], 6).flat(),
    offline: { result: "retry", waitMs: 0 },
  },
  "reset x3 with limit 2: resets count against limit": { events: repeat("reset", 3), offline: retryNow, limit: 2 },
  "limit 5 counts raw attempts including reconnects": {
    events: ["offline", "provider0", "offline", "provider0", "offline", "offline"],
    offline: { result: "retry", waitMs: 0 },
    limit: 5,
  },
  "offline handler rejected (blocked): stop": {
    events: ["offline", "offline"],
    offline: { result: "blocked", waitMs: 5_000 },
  },
  "offline handler aborted: stop": { events: ["offline"], offline: { result: "aborted", waitMs: 0 } },
  "no offline handler: disconnect uses normal backoff": { events: repeat("offline", 6) },
  "disconnect after streamed output (blockRetry): stop without offline wait": {
    events: ["offline"],
    offline: retryNow,
    blockRetry: true,
  },
}
const timelines = {}
for (const [name, input] of Object.entries(timelineCases)) timelines[name] = await run(timeline(input))

Math.random = realRandom

// ---- 5. offline guard ----------------------------------------------------
const guardFail = await Effect.runPromiseExit(
  KiloSessionProcessor.offlineGuard({ stallMs: 200, tickMs: 20, check: () => Promise.resolve(false) }).watch,
)
const guardHealthy = await Effect.runPromiseExit(
  KiloSessionProcessor.offlineGuard({ stallMs: 200, tickMs: 20, check: () => Promise.resolve(true) }).watch.pipe(
    Effect.raceFirst(Effect.sleep("500 millis")),
  ),
)
const guardBusy = await Effect.runPromiseExit(
  KiloSessionProcessor.offlineGuard({
    stallMs: 200,
    tickMs: 20,
    busy: () => KiloSessionProcessor.executingTools({ "call-1": { executing: true } }),
    check: () => Promise.resolve(false),
  }).watch.pipe(Effect.raceFirst(Effect.sleep("500 millis"))),
)
const squash = (exit) => (Exit.isFailure(exit) ? (exit.cause.reasons?.[0]?.error ?? exit.cause) : undefined)
const offlineGuard = {
  constants: { STALL_MS: KiloSessionProcessor.STALL_MS, defaultTickMs: 1000 },
  "stalled + probe fails": {
    failed: Exit.isFailure(guardFail),
    error: { name: squash(guardFail)?.name, message: squash(guardFail)?.message },
  },
  "stalled + probe passes (race 500ms)": { failed: Exit.isFailure(guardHealthy) },
  "stalled + executing tool (race 500ms)": { failed: Exit.isFailure(guardBusy) },
}

// ---- 6. offline wait lifecycle (real SessionNetwork in a v1 test instance, real timers) ----------
const { provideTestInstance, disposeTestRuntime } = await source("packages/opencode/test/fixture/fixture.ts")
const { Bus } = await source("packages/opencode/src/bus/index.ts")
const lifecycle = await (async () => {
  const dir = await fs.mkdtemp(path.join(process.env.TMPDIR, "net-"))
  const t0 = Date.now()
  const events = []
  const at = () => Math.round((Date.now() - t0) / 1000)
  const result = await provideTestInstance({
    directory: dir,
    fn: async () => {
      const offs = ["Asked", "Restored", "Replied", "Rejected"].map((key) =>
        Bus.subscribe(SessionNetwork.Event[key], (event) => events.push({ type: event.type, atSec: at() })),
      )
      const out = {}
      // Restore (what the probe loop does when the network is back), then the resume window, then the reply.
      const a = await SessionNetwork.ask({
        sessionID: "ses_fixture_a",
        message: "Connection refused",
        abort: new AbortController().signal,
      })
      const pending = structuredClone((await SessionNetwork.list())[0])
      await SessionNetwork.restore({ requestID: a.id })
      const restored = (await SessionNetwork.list())[0]
      await a.promise
      out.restoreThenAutoResume = {
        pendingBefore: {
          message: pending.message,
          restored: pending.restored,
          hasRestoredTime: pending.time.restored !== undefined,
        },
        afterRestore: { restored: restored.restored, hasRestoredTime: restored.time.restored !== undefined },
        resolvedAfterSec: at(),
        pendingAfter: (await SessionNetwork.list()).length,
      }
      // An explicit reply ("retry now") resolves at once.
      const t1 = Date.now()
      const b = await SessionNetwork.ask({
        sessionID: "ses_fixture_b",
        message: "Host not found",
        abort: new AbortController().signal,
      })
      await SessionNetwork.reply({ requestID: b.id })
      await b.promise
      out.replyResolvesImmediately = { underOneSecond: Date.now() - t1 < 1000 }
      // A reject fails with RejectedError; the processor maps it to "blocked".
      const c = await SessionNetwork.ask({
        sessionID: "ses_fixture_c",
        message: "Connection timed out",
        abort: new AbortController().signal,
      })
      await SessionNetwork.reject({ requestID: c.id })
      const rejected = await c.promise.catch((err) => err)
      out.rejectRejects = {
        isRejectedError: rejected instanceof SessionNetwork.RejectedError,
        message: rejected.message,
      }
      // An abort fails with AbortError; the processor maps it to "aborted".
      const ctl = new AbortController()
      const d = await SessionNetwork.ask({
        sessionID: "ses_fixture_d",
        message: "Connection refused",
        abort: ctl.signal,
      })
      ctl.abort()
      const aborted = await d.promise.catch((err) => err)
      out.abortRejects = { name: aborted.name, pendingAfter: (await SessionNetwork.list()).length }
      offs.forEach((off) => off())
      return out
    },
  })
  await disposeTestRuntime()
  return { ...result, events }
})()

const cases = [
  ...Object.entries(classification).map(([name, { input, ...output }]) => ({
    name: `classify/${name}`,
    fn: "SessionNetwork.disconnected, code, message; MessageV2.fromError; SessionNetwork.serverReset; SessionRetry.retryable; first SessionRetry.policy step",
    input,
    output,
  })),
  ...Object.entries(normalized).map(([name, { input, ...output }]) => ({
    name: `normalized/${name}`,
    fn: "SessionRetry.retryable, SessionNetwork.serverReset (KiloSessionProcessor.blockRetry where named)",
    input,
    output,
  })),
  ...Object.entries(delay).map(([name, { output, ...input }]) => ({
    name: `delay/${name}`,
    fn: "SessionRetry.delay",
    input,
    output,
  })),
  ...Object.entries(timelines).map(([name, output]) => ({
    name: `timeline/${name}`,
    fn: "SessionRetry.policy (TestClock, Math.random = 0)",
    input: {
      events: output.events,
      limit: output.limit,
      offlineHandler: output.offlineHandler,
      blockRetry: output.blockRetry,
    },
    output,
  })),
  ...Object.entries(offlineGuard)
    .filter(([name]) => name !== "constants")
    .map(([name, output]) => ({
      name: `guard/${name}`,
      fn: "KiloSessionProcessor.offlineGuard({ stallMs: 200, tickMs: 20 }).watch",
      input: name,
      output,
    })),
  {
    name: "lifecycle/ask-restore-reply-reject-abort",
    fn: "SessionNetwork.ask, restore, reply, reject, abort",
    input: null,
    output: lifecycle,
  },
]

await write({
  sources: [
    "packages/opencode/src/session/retry.ts",
    "packages/opencode/src/session/network.ts",
    "packages/opencode/src/session/message-v2.ts",
    "packages/opencode/src/session/processor.ts",
    "packages/opencode/src/kilocode/session/processor.ts",
  ],
  constants: {
    ...Object.fromEntries(
      [
        "RETRY_INITIAL_DELAY",
        "RETRY_BACKOFF_FACTOR",
        "RETRY_JITTER_FACTOR",
        "RETRY_MAX_DELAY_NO_HEADERS",
        "RETRY_MAX_DELAY",
        "RETRY_MAX_RETRIES",
      ].map((key) => [key, SessionRetry[key]]),
    ),
    STALL_MS: KiloSessionProcessor.STALL_MS,
    note: "Inputs with $type are built as that class (Error with cause and code, DOMException, DisconnectedError, APICallError); other inputs are plain objects. Policy steps and timelines ran with Math.random fixed to 0. '<wall-clock Date.now()>' marks the wall-clock `next` of a Reconnected status. The lifecycle case uses real timers; resolvedAfterSec is the 10 s resume window.",
  },
  cases,
})
process.exit(0)
