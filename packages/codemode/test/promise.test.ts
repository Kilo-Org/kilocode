import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Fiber, Schema } from "effect" // kilocode_change
import { CodeMode, Tool, toolError } from "../src/index.js"

// Wave 5 acceptance suite: first-class promise values. Un-awaited tool calls start eagerly on
// supervised fibers, `await` settles them, and Promise.all/allSettled/race/resolve/reject are
// ordinary functions over arbitrary arrays mixing promises and plain values.

type Trace = {
  starts: Array<number>
  active: number
  maxActive: number
  completed: number
  interrupted: number
}

const makeTrace = (): Trace => ({ starts: [], active: 0, maxActive: 0, completed: 0, interrupted: 0 })

/** Echoes `id` after `ms` milliseconds, recording start order, live concurrency, and interruption. */
const sleepyTool = (trace: Trace) =>
  Tool.make({
    description: "Echo an id after a delay",
    input: Schema.Struct({ id: Schema.Number, ms: Schema.optionalKey(Schema.Number) }),
    output: Schema.Number,
    run: ({ id, ms }) =>
      Effect.gen(function* () {
        trace.starts.push(id)
        trace.active += 1
        trace.maxActive = Math.max(trace.maxActive, trace.active)
        yield* Effect.sleep(ms ?? 20)
        trace.active -= 1
        trace.completed += 1
        return id
      }).pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            trace.active -= 1
            trace.interrupted += 1
          }),
        ),
      ),
  })

const failingTool = Tool.make({
  description: "Always refuse",
  input: Schema.Struct({}),
  output: Schema.String,
  run: () => Effect.fail(toolError("Lookup refused")),
})

const run = (
  code: string,
  options: { trace?: Trace; limits?: CodeMode.ExecutionLimits } = {},
): Promise<CodeMode.Result> => {
  const trace = options.trace ?? makeTrace()
  return Effect.runPromise(
    CodeMode.execute({
      tools: { host: { sleepy: sleepyTool(trace), fail: failingTool } },
      code,
      ...(options.limits ? { limits: options.limits } : {}),
    }),
  )
}

const value = async (code: string, options: { trace?: Trace; limits?: CodeMode.ExecutionLimits } = {}) => {
  const result = await run(code, options)
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}

const error = async (code: string, options: { trace?: Trace; limits?: CodeMode.ExecutionLimits } = {}) => {
  const result = await run(code, options)
  if (result.ok) throw new Error(`expected failure, got value ${JSON.stringify(result.value)}`)
  return result.error
}

describe("first-class promise values", () => {
  test("an un-awaited tool call starts eagerly, in call order, before any await", async () => {
    const trace = makeTrace()
    const result = await value(
      `
        const a = tools.host.sleepy({ id: 1, ms: 40 })
        const b = tools.host.sleepy({ id: 2, ms: 40 })
        const rb = await b
        const ra = await a
        return [ra, rb]
      `,
      { trace },
    )
    expect(result).toEqual([1, 2])
    expect(trace.starts).toEqual([1, 2])
    // Both calls overlapped even though they were awaited sequentially.
    expect(trace.maxActive).toBeGreaterThan(1)
  })

  test("awaiting the same promise twice settles once and never re-runs the call", async () => {
    const result = await run(`
      const p = tools.host.sleepy({ id: 7 })
      const x = await p
      const y = await p
      return [x, y]
    `)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual([7, 7])
    expect(result.toolCalls).toStrictEqual([{ name: "host.sleepy" }])
  })

  test("await of a non-promise value is a passthrough no-op", async () => {
    expect(await value(`return await 42`)).toBe(42)
    expect(await value(`const x = await "s"; return x`)).toBe("s")
    expect(await value(`return await null`)).toBeNull()
    expect(await value(`return (await [1, 2]).length`)).toBe(2)
  })

  test("returning an un-awaited tool call resolves it (async-function return semantics)", async () => {
    expect(await value(`return tools.host.sleepy({ id: 9 })`)).toBe(9)
  })

  test("typeof a promise is 'object', and console.log renders it sensibly", async () => {
    const result = await run(`
      const p = Promise.resolve(1)
      console.log(p)
      return typeof p
    `)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBe("object")
    expect(result.logs).toStrictEqual(["[Promise (await it to get its value)]"])
  })

  test("an awaited failure is catchable exactly like a synchronous throw", async () => {
    expect(
      await value(`
      const p = tools.host.fail({})
      try {
        await p
        return "no"
      } catch (e) {
        return e.message
      }
    `),
    ).toBe("Lookup refused")
  })

  test("a fire-and-forget call completes before the execution ends", async () => {
    const trace = makeTrace()
    const result = await value(
      `
        tools.host.sleepy({ id: 1, ms: 30 })
        return "done"
      `,
      { trace },
    )
    expect(result).toBe("done")
    expect(trace.completed).toBe(1)
    expect(trace.interrupted).toBe(0)
  })

  test("a never-awaited failing call surfaces as an unhandled-rejection diagnostic", async () => {
    const diagnostic = await error(`
      tools.host.fail({})
      return "done"
    `)
    expect(diagnostic.kind).toBe("ToolFailure")
    expect(diagnostic.message).toContain("Unhandled rejection from an un-awaited tool call")
    expect(diagnostic.message).toContain("Lookup refused")
    expect(diagnostic.suggestions?.join(" ")).toContain("await tools.ns.tool(...)")
  })
})

describe("promises at data boundaries", () => {
  test("returning an un-awaited promise inside data is a clear await-hinting diagnostic", async () => {
    const diagnostic = await error(`return { result: tools.host.sleepy({ id: 1 }) }`)
    expect(diagnostic.kind).toBe("InvalidDataValue")
    expect(diagnostic.message).toContain("un-awaited Promise")
    expect(diagnostic.message).toContain("await tools.ns.tool(...)")
  })

  test("passing an un-awaited promise as a tool argument is a clear diagnostic", async () => {
    const diagnostic = await error(`return await tools.host.sleepy({ id: tools.host.sleepy({ id: 1 }) })`)
    expect(diagnostic.kind).toBe("InvalidDataValue")
    expect(diagnostic.message).toContain("un-awaited Promise")
  })

  test("JSON.stringify of a promise is a diagnostic, not '{}'", async () => {
    const diagnostic = await error(`return JSON.stringify(Promise.resolve(1))`)
    expect(diagnostic.kind).toBe("InvalidDataValue")
    expect(diagnostic.message).toContain("un-awaited Promise")
  })

  test("operators reject promise operands", async () => {
    const diagnostic = await error(`return Promise.resolve(1) + 1`)
    expect(diagnostic.kind).toBe("InvalidDataValue")
  })
})

describe("Promise.all over arbitrary arrays", () => {
  test("mixes promises and plain values, preserving order", async () => {
    expect(
      await value(`
      return await Promise.all([tools.host.sleepy({ id: 1 }), "plain", tools.host.sleepy({ id: 2 }), 42])
    `),
    ).toEqual([1, "plain", 2, 42])
  })

  test("accepts arrays built beforehand, passed as identifiers, and spread elements", async () => {
    expect(
      await value(`
      const calls = []
      calls.push(tools.host.sleepy({ id: 1 }))
      calls.push(7)
      const more = [tools.host.sleepy({ id: 2 })]
      const batch = [...calls, ...more, "x"]
      return await Promise.all(batch)
    `),
    ).toEqual([1, 7, 2, "x"])
  })

  test("runs items.map tool calls in parallel", async () => {
    const trace = makeTrace()
    const result = await value(
      `
        const ids = [1, 2, 3, 4]
        return await Promise.all(ids.map((id) => tools.host.sleepy({ id, ms: 40 })))
      `,
      { trace },
    )
    expect(result).toEqual([1, 2, 3, 4])
    // maxActive counts truly-overlapping live executions, so > 1 proves real
    // parallelism deterministically - no wall-clock assertion needed.
    expect(trace.maxActive).toBeGreaterThan(1)
  })

  test("caps live tool-call concurrency at the fixed internal constant (8)", async () => {
    const trace = makeTrace()
    const result = await value(
      `
        const ids = []
        for (let i = 0; i < 20; i += 1) ids.push(i)
        const results = await Promise.all(ids.map((id) => tools.host.sleepy({ id, ms: 10 })))
        return results.length
      `,
      { trace },
    )
    expect(result).toBe(20)
    expect(trace.maxActive).toBeGreaterThan(1)
    expect(trace.maxActive).toBeLessThanOrEqual(8)
  })

  test("resolves the empty array", async () => {
    expect(await value(`return await Promise.all([])`)).toEqual([])
  })

  test("rejects with the first failure, catchable in-program", async () => {
    expect(
      await value(`
      try {
        await Promise.all([tools.host.sleepy({ id: 1 }), tools.host.fail({})])
        return "no"
      } catch (e) {
        return e.message
      }
    `),
    ).toBe("Lookup refused")
  })

  test("a non-collection argument is a clear error", async () => {
    const diagnostic = await error(`return await Promise.all(42)`)
    expect(diagnostic.message).toContain("Promise.all expects an array")
  })

  test("exceeding maxToolCalls inside Promise.all is a ToolCallLimitExceeded diagnostic", async () => {
    const diagnostic = await error(
      `return await Promise.all([tools.host.sleepy({ id: 1 }), tools.host.sleepy({ id: 2 }), tools.host.sleepy({ id: 3 })])`,
      { limits: { maxToolCalls: 2 } },
    )
    expect(diagnostic.kind).toBe("ToolCallLimitExceeded")
  })
})

describe("Promise.allSettled", () => {
  test("reports fulfilled and rejected outcomes with catch-normalized reasons", async () => {
    expect(
      await value(`
      return await Promise.allSettled([
        tools.host.sleepy({ id: 5 }),
        tools.host.fail({}),
        "plain",
        Promise.reject(new Error("boom")),
      ])
    `),
    ).toEqual([
      { status: "fulfilled", value: 5 },
      { status: "rejected", reason: { name: "Error", message: "Lookup refused" } },
      { status: "fulfilled", value: "plain" },
      { status: "rejected", reason: { name: "Error", message: "boom" } },
    ])
  })

  test("never rejects for program-level failures", async () => {
    const result = await run(`
      const settled = await Promise.allSettled([tools.host.fail({}), tools.host.fail({})])
      return settled.filter((s) => s.status === "rejected").length
    `)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(2)
  })
})

describe("Promise.race", () => {
  test("first settlement wins and losers are interrupted", async () => {
    const trace = makeTrace()
    const result = await value(
      `
        const fast = tools.host.sleepy({ id: 1, ms: 10 })
        const slow = tools.host.sleepy({ id: 2, ms: 5000 })
        return await Promise.race([fast, slow])
      `,
      { trace },
    )
    expect(result).toBe(1)
    expect(trace.interrupted).toBe(1)
    expect(trace.completed).toBe(1)
  })

  test("awaiting an interrupted loser afterwards is a catchable program failure", async () => {
    expect(
      await value(`
      const fast = tools.host.sleepy({ id: 1, ms: 10 })
      const slow = tools.host.sleepy({ id: 2, ms: 5000 })
      const winner = await Promise.race([fast, slow])
      try {
        await slow
        return "no"
      } catch (e) {
        return { winner, caught: e.message }
      }
    `),
    ).toEqual({
      winner: 1,
      caught: "This tool call was interrupted because another value settled a Promise.race first.",
    })
  })

  test("a rejection can win the race", async () => {
    expect(
      await value(`
      try {
        await Promise.race([tools.host.fail({}), tools.host.sleepy({ id: 1, ms: 5000 })])
        return "no"
      } catch (e) {
        return e.message
      }
    `),
    ).toBe("Lookup refused")
  })

  test("a plain value wins over pending promises", async () => {
    const trace = makeTrace()
    expect(
      await value(`return await Promise.race([tools.host.sleepy({ id: 1, ms: 5000 }), "immediate"])`, { trace }),
    ).toBe("immediate")
    expect(trace.interrupted).toBe(1)
  })

  test("an empty race is a clear error instead of hanging", async () => {
    const diagnostic = await error(`return await Promise.race([])`)
    expect(diagnostic.message).toContain("never settle")
  })
})

describe("Promise.resolve / Promise.reject", () => {
  test("resolve wraps plain values and passes promises through", async () => {
    expect(await value(`return await Promise.resolve(42)`)).toBe(42)
    expect(await value(`return await Promise.resolve(Promise.resolve("nested"))`)).toBe("nested")
    expect(await value(`return await Promise.resolve(tools.host.sleepy({ id: 3 }))`)).toBe(3)
  })

  test("reject produces a promise whose await throws the reason", async () => {
    expect(
      await value(`
      try {
        await Promise.reject("nope")
        return "no"
      } catch (e) {
        return e
      }
    `),
    ).toBe("nope")
  })
})

describe("timeout interruption of forked calls", () => {
  test("the execution timeout interrupts in-flight forked fibers", async () => {
    const trace = makeTrace()
    const result = await run(
      `
        const a = tools.host.sleepy({ id: 1, ms: 60000 })
        const b = tools.host.sleepy({ id: 2, ms: 60000 })
        return await a
      `,
      { trace, limits: { timeoutMs: 100 } },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe("TimeoutExceeded")
    // Both calls started; neither escaped the timeout - the awaited one AND the abandoned one.
    expect(trace.starts).toEqual([1, 2])
    expect(trace.interrupted).toBe(2)
    expect(trace.completed).toBe(0)
  })

  test("the timeout also interrupts calls inside Promise.all", async () => {
    const trace = makeTrace()
    const result = await run(
      `return await Promise.all([tools.host.sleepy({ id: 1, ms: 60000 }), tools.host.sleepy({ id: 2, ms: 60000 })])`,
      { trace, limits: { timeoutMs: 100 } },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe("TimeoutExceeded")
    expect(trace.interrupted).toBe(2)
  })
})

describe("unsupported promise surface", () => {
  test(".then/.catch/.finally give a clear await-instead error", async () => {
    for (const method of ["then", "catch", "finally"]) {
      const diagnostic = await error(`return tools.host.sleepy({ id: 1 }).${method}((x) => x)`)
      expect(diagnostic.kind).toBe("UnsupportedSyntax")
      expect(diagnostic.message).toContain(`Promise.prototype.${method} is not supported`)
      expect(diagnostic.message).toContain("await")
    }
  })

  test("other property reads on a promise hint at the missing await", async () => {
    const diagnostic = await error(`return tools.host.sleepy({ id: 1 }).value`)
    expect(diagnostic.kind).toBe("InvalidDataValue")
    expect(diagnostic.message).toContain("un-awaited Promise")
    expect(diagnostic.message).toContain("await it first")
  })

  test("unknown Promise statics list what is available", async () => {
    const diagnostic = await error(`return await Promise.any([tools.host.sleepy({ id: 1 })])`)
    expect(diagnostic.message).toContain("Promise.any is not available")
    expect(diagnostic.message).toContain("Promise.allSettled")
  })

  test("new Promise(...) points at tool calls instead", async () => {
    const diagnostic = await error(`return new Promise((resolve) => resolve(1))`)
    expect(diagnostic.kind).toBe("UnsupportedSyntax")
    expect(diagnostic.message).toContain("new Promise(...) is not supported")
    expect(diagnostic.message).toContain("already return promises")
  })
})

// kilocode_change start
describe("interpreter wait observation", () => {
  for (const method of ["all", "allSettled", "race"] as const) {
    test(`observes Promise.${method} coordination without changing its result`, async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const first = yield* Deferred.make<string>()
          const second = yield* Deferred.make<string>()
          const started = Promise.withResolvers<void>()
          const events: boolean[] = []
          const stopped: string[] = []
          const tool = (gate: Deferred.Deferred<string>, name: string) =>
            Tool.make({
              description: name,
              input: Schema.Struct({}),
              output: Schema.String,
              run: () => Deferred.await(gate).pipe(Effect.onInterrupt(() => Effect.sync(() => stopped.push(name)))),
            })
          const running = yield* CodeMode.execute({
            tools: { first: tool(first, "first"), second: tool(second, "second") },
            code: `return await Promise.${method}([tools.first({}), tools.second({})])`,
            onWait: (waiting) => {
              events.push(waiting)
              if (waiting) started.resolve()
            },
          }).pipe(Effect.forkChild)
          yield* Effect.promise(() => started.promise)
          expect(events).toEqual([true])
          yield* Deferred.succeed(second, "second")
          if (method !== "race") {
            yield* Effect.yieldNow
            expect(events).toEqual([true])
            yield* Deferred.succeed(first, "first")
          }
          const result = yield* Fiber.join(running)
          expect(result.ok).toBe(true)
          if (!result.ok) return
          expect(result.value).toEqual(
            method === "race"
              ? "second"
              : method === "all"
                ? ["first", "second"]
                : [
                    { status: "fulfilled", value: "first" },
                    { status: "fulfilled", value: "second" },
                  ],
          )
          expect(events.at(-1)).toBe(false)
          expect(events.filter(Boolean).length).toBe(events.filter((value) => !value).length)
          expect(stopped).toEqual(method === "race" ? ["first"] : [])
          if (method === "race") expect(events).toEqual([true, false])
        }).pipe(Effect.scoped),
      )
    })
  }

  test("keeps eager computation active and skips already-settled joins", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<string>()
        const started = Promise.withResolvers<void>()
        const events: boolean[] = []
        const running = yield* CodeMode.execute({
          tools: {
            blocked: Tool.make({
              description: "Wait for a value",
              input: Schema.Struct({}),
              output: Schema.String,
              run: () => Deferred.await(gate),
            }),
            inspect: Tool.make({
              description: "Observe eager computation",
              input: Schema.Struct({ value: Schema.Number }),
              output: Schema.Number,
              run: (input) =>
                Effect.sync(() => {
                  expect(input.value).toBe(45)
                  expect(events).toEqual([])
                  return input.value
                }),
            }),
          },
          code: `
            const pending = tools.blocked({})
            let value = 0
            for (let i = 0; i < 10; i++) value += i
            tools.inspect({ value })
            await pending
            return await Promise.race([pending, Promise.resolve("other")])
          `,
          onWait: (waiting) => {
            events.push(waiting)
            if (waiting) started.resolve()
          },
        }).pipe(Effect.forkChild)
        yield* Effect.promise(() => started.promise)
        yield* Deferred.succeed(gate, "ready")
        expect(yield* Fiber.join(running)).toMatchObject({ ok: true, value: "ready" })
        expect(events).toEqual([true, false])
      }).pipe(Effect.scoped),
    )
  })

  test("balances cancellation without changing child interruption", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const started = Promise.withResolvers<void>()
        const events: boolean[] = []
        const stopped: boolean[] = []
        const running = yield* CodeMode.execute({
          tools: {
            blocked: Tool.make({
              description: "Wait until interrupted",
              input: Schema.Struct({}),
              output: Schema.String,
              run: () => Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => stopped.push(true)))),
            }),
          },
          code: "return await tools.blocked({})",
          onWait: (waiting) => {
            events.push(waiting)
            if (waiting) started.resolve()
          },
        }).pipe(Effect.forkChild)
        yield* Effect.promise(() => started.promise)
        yield* Fiber.interrupt(running)
        expect(events).toEqual([true, false])
        expect(stopped).toEqual([true])
      }).pipe(Effect.scoped),
    )
  })

  for (const fail of [false, true]) {
    test(`observer errors do not change program ${fail ? "failure" : "success"}`, async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const gate = yield* Deferred.make<void>()
          const started = Promise.withResolvers<void>()
          const events: boolean[] = []
          const running = yield* CodeMode.execute({
            tools: {
              blocked: Tool.make({
                description: "Wait before settling",
                input: Schema.Struct({}),
                output: Schema.String,
                run: () =>
                  Deferred.await(gate).pipe(
                    Effect.andThen(fail ? Effect.fail(toolError("Refused")) : Effect.succeed("done")),
                  ),
              }),
            },
            code: "return await tools.blocked({})",
            onWait: (waiting) => {
              events.push(waiting)
              if (waiting) started.resolve()
              throw new Error("Observer failed")
            },
          }).pipe(Effect.forkChild)
          yield* Effect.promise(() => started.promise)
          yield* Deferred.succeed(gate, undefined)
          expect(yield* Fiber.join(running)).toMatchObject(
            fail ? { ok: false, error: { kind: "ToolFailure", message: "Refused" } } : { ok: true, value: "done" },
          )
          expect(events).toEqual([true, false])
        }).pipe(Effect.scoped),
      )
    })
  }
})
// kilocode_change end
