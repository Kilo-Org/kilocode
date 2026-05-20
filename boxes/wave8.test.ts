/**
 * wave8.test.ts — n8n workflow, MCP protocol, A2A task, Effect-TS patterns
 */
import { describe, test, expect } from "bun:test"
import { topologicalSort, executeDag } from "./dag"
import { scheduleToCron, parseCronField, cronNextMs, createIntervalTrigger, createCronTrigger } from "./trigger"
import { createRequest, createResponse, createError, LineFramer, isRequest, PARSE_ERROR } from "./json-rpc"
import { createTask, transition, isTerminal, handleMessage } from "./a2a-task"
import { ok, err, isOk, map, flatMap, mapError, recover, match, fromThrowable, zip } from "./result-chain"
import { exponential, fibonacci, capDelay, retryWith } from "./schedule"

// ── dag ────────────────────────────────────────────

describe("dag", () => {
  test("topologicalSort linear chain", () => {
    const order = topologicalSort(["a", "b", "c"], [{ from: "a", to: "b" }, { from: "b", to: "c" }])
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"))
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"))
  })

  test("topologicalSort diamond", () => {
    const order = topologicalSort(["a", "b", "c", "d"], [
      { from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "d" }, { from: "c", to: "d" },
    ])
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"))
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("c"))
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("d"))
    expect(order.indexOf("c")).toBeLessThan(order.indexOf("d"))
  })

  test("topologicalSort throws on cycle", () => {
    expect(() => topologicalSort(["a", "b"], [{ from: "a", to: "b" }, { from: "b", to: "a" }])).toThrow("Cycle")
  })

  test("executeDag runs in dependency order", async () => {
    const log: string[] = []
    const results = await executeDag(
      ["a", "b", "c"],
      [{ from: "a", to: "b" }, { from: "b", to: "c" }],
      async (id, inputs) => { log.push(id); return id.toUpperCase() },
    )
    expect(results.get("c")).toBe("C")
    expect(log.indexOf("a")).toBeLessThan(log.indexOf("b"))
  })
})

// ── trigger ────────────────────────────────────────

describe("trigger", () => {
  test("scheduleToCron minute", () => {
    const cron = scheduleToCron({ mode: "minute" })
    expect(cron.split(/\s+/).length).toBe(5)
  })

  test("scheduleToCron hour", () => {
    const cron = scheduleToCron({ mode: "hour", minute: 30 })
    expect(cron).toContain("30")
  })

  test("parseCronField wildcard", () => {
    expect(parseCronField("*", 0, 5)).toEqual([0, 1, 2, 3, 4, 5])
  })

  test("parseCronField step", () => {
    expect(parseCronField("*/15", 0, 59)).toEqual([0, 15, 30, 45])
  })

  test("cronNextMs returns positive", () => {
    expect(cronNextMs("0 * * * *")).toBeGreaterThan(0)
  })

  test("createIntervalTrigger fires and cancels", async () => {
    let count = 0
    const cancel = createIntervalTrigger(20, () => { count++ })
    await new Promise(r => setTimeout(r, 70))
    cancel()
    expect(count).toBeGreaterThanOrEqual(2)
  })
})

// ── json-rpc ───────────────────────────────────────

describe("json-rpc", () => {
  test("createRequest has jsonrpc version", () => {
    const req = createRequest("tools/list")
    expect(req.jsonrpc).toBe("2.0")
    expect(req.method).toBe("tools/list")
  })

  test("createResponse wraps result", () => {
    const res = createResponse(1, { tools: [] })
    expect(res.result).toEqual({ tools: [] })
  })

  test("createError has code and message", () => {
    const err = createError(1, PARSE_ERROR, "bad")
    expect(err.error?.code).toBe(-32700)
  })

  test("isRequest detects requests", () => {
    expect(isRequest(createRequest("test"))).toBe(true)
    expect(isRequest(createResponse(1, null))).toBe(false)
  })

  test("LineFramer splits on newline", () => {
    const framer = new LineFramer()
    const msgs = framer.push('{"jsonrpc":"2.0","method":"a","id":1}\n{"jsonrpc":"2.0","method":"b","id":2}\n')
    expect(msgs.length).toBe(2)
    expect(msgs[0].method).toBe("a")
  })

  test("LineFramer accumulates partial", () => {
    const framer = new LineFramer()
    expect(framer.push('{"jsonrpc":"2.0","me').length).toBe(0)
    const msgs = framer.push('thod":"a","id":1}\n')
    expect(msgs.length).toBe(1)
  })
})

// ── a2a-task ───────────────────────────────────────

describe("a2a-task", () => {
  test("createTask starts as submitted", () => {
    const t = createTask("t1")
    expect(t.state).toBe("submitted")
    expect(t.id).toBe("t1")
  })

  test("transition follows valid path", () => {
    let t = createTask("t1")
    t = transition(t, "working")
    expect(t.state).toBe("working")
    t = transition(t, "completed")
    expect(t.state).toBe("completed")
    expect(isTerminal(t.state)).toBe(true)
  })

  test("transition rejects invalid path", () => {
    const t = createTask("t1")
    expect(() => transition(t, "completed")).toThrow("Invalid")
  })

  test("cannot transition from terminal", () => {
    let t = createTask("t1")
    t = transition(t, "working")
    t = transition(t, "completed")
    expect(() => transition(t, "working")).toThrow("already terminal")
  })

  test("handleMessage cancels task", () => {
    let tasks = new Map([["t1", createTask("t1")]])
    tasks = handleMessage(tasks, { kind: "cancel", taskId: "t1" })
    expect(tasks.get("t1")!.state).toBe("canceled")
  })

  test("handleMessage resumes from input-required", () => {
    let t = createTask("t1")
    t = transition(t, "working")
    t = transition(t, "input-required")
    let tasks = new Map([["t1", t]])
    tasks = handleMessage(tasks, { kind: "send", taskId: "t1", payload: "data" })
    expect(tasks.get("t1")!.state).toBe("working")
  })
})

// ── result-chain ───────────────────────────────────

describe("result-chain", () => {
  test("ok creates success", () => { expect(isOk(ok(42))).toBe(true) })
  test("err creates failure", () => { expect(isOk(err("fail"))).toBe(false) })

  test("map transforms success", () => {
    expect(map(ok(10), x => x * 2)).toEqual({ ok: true, value: 20 })
  })

  test("map skips error", () => {
    expect(map(err("bad"), x => x)).toEqual({ ok: false, error: "bad" })
  })

  test("flatMap chains", () => {
    const r = flatMap(ok(5), x => ok(x + 1))
    expect(r).toEqual({ ok: true, value: 6 })
  })

  test("flatMap propagates error", () => {
    const r = flatMap(err("e"), (x: number) => ok(x + 1))
    expect(isOk(r)).toBe(false)
  })

  test("recover from error", () => {
    const r = recover(err("e"), () => ok("recovered"))
    expect(r).toEqual({ ok: true, value: "recovered" })
  })

  test("match branches", () => {
    expect(match(ok(1), v => `ok:${v}`, e => `err:${e}`)).toBe("ok:1")
    expect(match(err("x"), v => `ok:${v}`, e => `err:${e}`)).toBe("err:x")
  })

  test("fromThrowable catches", () => {
    expect(isOk(fromThrowable(() => JSON.parse("bad{")))).toBe(false)
    expect(fromThrowable(() => 42)).toEqual({ ok: true, value: 42 })
  })

  test("zip combines two successes", () => {
    expect(zip(ok(1), ok(2))).toEqual({ ok: true, value: [1, 2] })
  })

  test("zip propagates first error", () => {
    expect(isOk(zip(err("a"), ok(2)))).toBe(false)
  })
})

// ── schedule ───────────────────────────────────────

describe("schedule", () => {
  test("exponential increases delay", () => {
    const s = exponential(100, 2)
    const s0 = s.next()
    const s1 = s.next()
    const s2 = s.next()
    expect(s0.delay).toBe(100)
    expect(s1.delay).toBe(200)
    expect(s2.delay).toBe(400)
  })

  test("exponential respects maxRetries", () => {
    const s = exponential(100, 2, 2)
    s.next(); s.next()
    expect(s.next().done).toBe(true)
  })

  test("fibonacci sequence", () => {
    const s = fibonacci(100)
    expect(s.next().delay).toBe(0)
    expect(s.next().delay).toBe(100)
    expect(s.next().delay).toBe(100)
    expect(s.next().delay).toBe(200)
    expect(s.next().delay).toBe(300)
  })

  test("capDelay limits max delay", () => {
    const s = capDelay(500, exponential(100, 3))
    s.next() // 100
    s.next() // 300
    const step = s.next() // would be 900
    expect(step.delay).toBe(500)
  })

  test("retryWith succeeds eventually", async () => {
    let attempts = 0
    const result = await retryWith(async () => {
      attempts++
      if (attempts < 3) throw new Error("not yet")
      return "done"
    }, exponential(1, 1))
    expect(result).toBe("done")
    expect(attempts).toBe(3)
  })

  test("retryWith exhausts retries", async () => {
    await expect(retryWith(async () => { throw new Error("fail") }, exponential(1, 1, 3))).rejects.toThrow("exhausted")
  })
})
