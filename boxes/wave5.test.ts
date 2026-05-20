import { describe, expect, test } from "bun:test"
import { toolbox } from "./toolbox"
import { createRenderer, type Renderer } from "./render"
import { prop, field, ref } from "./accessor"
import { Bits } from "./bits"
import { resolve, resolveSync, isLazy, lazy } from "./resolvable"
import { hookStream } from "./hook-stream"

// ── Pattern 1: Toolbox Injection ───────────────────────────

describe("toolbox", () => {
  test("registers and builds providers", async () => {
    const tb = toolbox()
    tb.provide("db", () => ({ query: (s: string) => s.toUpperCase() }))
    tb.provide("log", () => ({ info: (s: string) => s }))
    const ctx = await tb.build()
    expect((ctx.db as any).query("hello")).toBe("HELLO")
    expect((ctx.log as any).info("ok")).toBe("ok")
  })

  test("caches providers across builds", async () => {
    let calls = 0
    const tb = toolbox()
    tb.provide("counter", () => { calls++; return calls })
    await tb.build()
    await tb.build()
    expect(calls).toBe(1)
  })

  test("reset forces re-initialization", async () => {
    let calls = 0
    const tb = toolbox()
    tb.provide("val", () => { calls++; return calls })
    await tb.build()
    tb.reset()
    await tb.build()
    expect(calls).toBe(2)
  })

  test("provider receives partial context", async () => {
    const tb = toolbox()
    tb.provide("first", () => "hello")
    tb.provide("second", (ctx) => `${ctx.first} world`)
    const ctx = await tb.build()
    expect(ctx.second).toBe("hello world")
  })

  test("async providers", async () => {
    const tb = toolbox()
    tb.provide("async", async () => {
      await new Promise((r) => setTimeout(r, 5))
      return "done"
    })
    const ctx = await tb.build()
    expect(ctx.async).toBe("done")
  })
})

// ── Pattern 2: Renderer Strategy ───────────────────────────

describe("renderer", () => {
  test("selects plain renderer by default", () => {
    const rendered: string[] = []
    const r = createRenderer<string>({
      fancy: { render: (d) => rendered.push("fancy:" + d) },
      plain: { render: (d) => rendered.push("plain:" + d) },
    })
    r.render("test")
    expect(rendered).toEqual(["plain:test"])
  })

  test("selects fancy renderer when TTY", () => {
    const rendered: string[] = []
    const r = createRenderer<string>({
      fancy: { render: (d) => rendered.push("fancy:" + d) },
      plain: { render: (d) => rendered.push("plain:" + d) },
      isTTY: () => true,
    })
    r.render("hi")
    expect(rendered).toEqual(["fancy:hi"])
  })

  test("selects JSON renderer when isJSON", () => {
    const rendered: string[] = []
    const r = createRenderer<string>({
      fancy: { render: (d) => rendered.push("fancy:" + d) },
      plain: { render: (d) => rendered.push("plain:" + d) },
      json: { render: (d) => rendered.push("json:" + d) },
      isJSON: () => true,
    })
    r.render("data")
    expect(rendered).toEqual(["json:data"])
  })

  test("JSON takes priority over TTY", () => {
    const rendered: string[] = []
    const r = createRenderer<string>({
      fancy: { render: (d) => rendered.push("fancy:" + d) },
      plain: { render: (d) => rendered.push("plain:" + d) },
      json: { render: (d) => rendered.push("json:" + d) },
      isTTY: () => true,
      isJSON: () => true,
    })
    r.render("x")
    expect(rendered).toEqual(["json:x"])
  })

  test("lifecycle hooks", async () => {
    const events: string[] = []
    const r = createRenderer<string>({
      fancy: {
        start() { events.push("start") },
        render(d) { events.push("render:" + d) },
        end() { events.push("end") },
      },
      plain: { render: () => {} },
      isTTY: () => true,
    })
    await r.start?.()
    r.render("data")
    await r.end?.()
    expect(events).toEqual(["start", "render:data", "end"])
  })
})

// ── Pattern 3: Accessor ────────────────────────────────────

describe("accessor", () => {
  test("prop accessor binds to object property", () => {
    const obj = { name: "alice", age: 30 }
    const name = prop(obj, "name")
    expect(name.get()).toBe("alice")
    name.set("bob")
    expect(obj.name).toBe("bob")
  })

  test("field accessor from functions", () => {
    let val = 10
    const acc = field(() => val, (v) => { val = v })
    expect(acc.get()).toBe(10)
    acc.set(20)
    expect(acc.get()).toBe(20)
  })

  test("ref accessor with mutable state", () => {
    const acc = ref("initial")
    expect(acc.get()).toBe("initial")
    acc.set("changed")
    expect(acc.get()).toBe("changed")
  })

  test("multiple refs are independent", () => {
    const a = ref(1)
    const b = ref(2)
    a.set(10)
    expect(b.get()).toBe(2)
  })
})

// ── Pattern 4: Bitmask Properties ──────────────────────────

describe("bits", () => {
  test("on/off/has", () => {
    const b = new Bits().on(0).on(3)
    expect(b.has(0)).toBe(true)
    expect(b.has(3)).toBe(true)
    expect(b.has(1)).toBe(false)
  })

  test("off clears bit", () => {
    const b = new Bits().on(0).off(0)
    expect(b.has(0)).toBe(false)
  })

  test("toggle", () => {
    const b = new Bits().on(2).toggle(2)
    expect(b.has(2)).toBe(false)
    const c = b.toggle(2)
    expect(c.has(2)).toBe(true)
  })

  test("diff", () => {
    const a = new Bits().on(0).on(1)
    const b = new Bits().on(1).on(2)
    const d = a.diff(b)
    expect(d.has(0)).toBe(true)
    expect(d.has(1)).toBe(false)
    expect(d.has(2)).toBe(true)
  })

  test("merge", () => {
    const a = new Bits().on(0)
    const b = new Bits().on(2)
    const m = a.merge(b)
    expect(m.has(0)).toBe(true)
    expect(m.has(2)).toBe(true)
  })

  test("contains", () => {
    const a = new Bits().on(0).on(1).on(2)
    const b = new Bits().on(1).on(2)
    expect(a.contains(b)).toBe(true)
    expect(b.contains(a)).toBe(false)
  })

  test("count", () => {
    expect(new Bits().on(0).on(3).on(7).count()).toBe(3)
  })

  test("empty", () => {
    expect(new Bits().empty).toBe(true)
    expect(new Bits().on(0).empty).toBe(false)
  })

  test("iterator", () => {
    const bits = new Bits().on(1).on(3).on(5)
    expect([...bits]).toEqual([1, 3, 5])
  })

  test("immutability", () => {
    const a = new Bits().on(0)
    const b = a.on(1)
    expect(a.has(1)).toBe(false)
    expect(b.has(1)).toBe(true)
  })
})

// ── Pattern 5: Resolvable<T> ───────────────────────────────

describe("resolvable", () => {
  test("resolve direct value", async () => {
    expect(await resolve(42)).toBe(42)
  })

  test("resolve promise", async () => {
    expect(await resolve(Promise.resolve("hi"))).toBe("hi")
  })

  test("resolve sync function", async () => {
    expect(await resolve(() => "fn result")).toBe("fn result")
  })

  test("resolve async function", async () => {
    expect(await resolve(async () => {
      await new Promise((r) => setTimeout(r, 5))
      return "async fn"
    })).toBe("async fn")
  })

  test("resolveSync returns promise for async fn", () => {
    const result = resolveSync(async () => "no")
    expect(result).toBeInstanceOf(Promise)
  })

  test("resolveSync handles sync values", () => {
    expect(resolveSync(10)).toBe(10)
    expect(resolveSync(() => 20)).toBe(20)
  })

  test("isLazy", () => {
    expect(isLazy(() => 1)).toBe(true)
    expect(isLazy(1)).toBe(false)
    expect(isLazy(Promise.resolve(1))).toBe(false)
  })

  test("lazy wrapper", async () => {
    const val = lazy(() => 99)
    expect(isLazy(val)).toBe(true)
    expect(await resolve(val)).toBe(99)
  })
})

// ── Pattern 6: Stream Hook ─────────────────────────────────

describe("hook-stream", () => {
  test("intercepts writes", async () => {
    const intercepted: string[] = []
    const stream = { write: (data: string) => true }
    const hook = hookStream(stream, (data) => intercepted.push(data), { debounceMs: 0 })
    stream.write("hello")
    hook.flush()
    expect(intercepted).toEqual(["hello"])
    hook.restore()
  })

  test("debounce batches writes", async () => {
    const intercepted: string[] = []
    const stream = { write: (data: string) => true }
    const hook = hookStream(stream, (data) => intercepted.push(data), { debounceMs: 50 })
    stream.write("a")
    stream.write("b")
    stream.write("c")
    await new Promise((r) => setTimeout(r, 100))
    expect(intercepted).toEqual(["abc"])
    hook.restore()
  })

  test("restore stops interception", () => {
    const intercepted: string[] = []
    const stream = { write: (data: string) => true }
    const hook = hookStream(stream, (data) => intercepted.push(data), { debounceMs: 0 })
    stream.write("first")
    hook.flush()
    hook.restore()
    stream.write("second")
    hook.flush()
    expect(intercepted.length).toBe(1)
    hook.restore()
  })
})
