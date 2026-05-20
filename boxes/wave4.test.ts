import { describe, expect, test } from "bun:test"
import { call } from "./call"
import { isPlain } from "./is-plain"
import { escHtml } from "./esc-html"
import { cleanup } from "./cleanup"
import { thunk } from "./thunk"
import { latch } from "./latch"
import { rfind } from "./rfind"
import { bisect, sortedInsert } from "./bisect"
import { genName } from "./gen-name"
import { compact } from "./compact"
import { chop, chopMid } from "./chop"
import { plural } from "./plural"
import { title } from "./title"
import { time, datetime, todayOrFull } from "./clock"
import { filename, dirname, extname, truncName } from "./path-parts"
import { parseRef, hrefToPath } from "./parse-ref"
import { escRe } from "./esc-re"
import { clamp } from "./clamp"
import { debounce } from "./debounce"
import { throttle } from "./throttle"
import { retry } from "./retry"
import { b64Enc, b64Dec, fnv1a, sampledHash } from "./b64"
import { sha1 } from "./sha"
import { abortAfter, abortAny } from "./abort"
import { race } from "./race"
import { scope } from "./scope"
import { globMatch, globBest, globStructured } from "./wildcard"
import { redact } from "./redact"
import { merge, stripNulls } from "./merge"

// ── Tier 1: pure functions ─────────────────────────────────

describe("call", () => {
  test("invokes immediately", () => { expect(call(() => 42)).toBe(42) })
  test("captures scope", () => { const x = 7; expect(call(() => x * 2)).toBe(14) })
})

describe("is-plain", () => {
  test("plain object", () => { expect(isPlain({ a: 1 })).toBe(true) })
  test("array is not plain", () => { expect(isPlain([1, 2])).toBe(false) })
  test("null is not plain", () => { expect(isPlain(null)).toBe(false) })
  test("primitive is not plain", () => { expect(isPlain("hi")).toBe(false) })
})

describe("esc-html", () => {
  test("escapes all three", () => { expect(escHtml("a<b>&c")).toBe("a&lt;b&gt;&amp;c") })
  test("no changes needed", () => { expect(escHtml("hello")).toBe("hello") })
})

describe("cleanup", () => {
  test("sync dispose", () => {
    let ok = false
    const d = cleanup(() => { ok = true })
    d[Symbol.dispose]()
    expect(ok).toBe(true)
  })
  test("async dispose", async () => {
    let ok = false
    const d = cleanup(async () => { ok = true })
    await d[Symbol.asyncDispose]()
    expect(ok).toBe(true)
  })
})

describe("thunk", () => {
  test("computes once", () => {
    let n = 0
    const get = thunk(() => ++n)
    expect(get()).toBe(1)
    expect(get()).toBe(1)
  })
})

describe("latch", () => {
  test("trip resolves wait", async () => {
    const l = latch()
    l.trip()
    await l.wait()
  })
})

describe("rfind", () => {
  test("finds last match", () => {
    expect(rfind([1, 2, 3, 4], (v) => v % 2 === 0)).toBe(4)
  })
  test("returns undefined on no match", () => {
    expect(rfind([1, 3, 5], (v) => v % 2 === 0)).toBeUndefined()
  })
})

describe("bisect", () => {
  test("found", () => {
    const arr = [{ k: "a" }, { k: "c" }, { k: "e" }]
    expect(bisect(arr, "c", (x) => x.k)).toEqual({ hit: true, idx: 1 })
  })
  test("not found", () => {
    const arr = [{ k: "a" }, { k: "c" }]
    expect(bisect(arr, "b", (x) => x.k)).toEqual({ hit: false, idx: 1 })
  })
})

describe("sortedInsert", () => {
  test("maintains order", () => {
    const arr: number[] = []
    sortedInsert(arr, 3, (n) => String(n))
    sortedInsert(arr, 1, (n) => String(n))
    sortedInsert(arr, 2, (n) => String(n))
    expect(arr).toEqual([1, 2, 3])
  })
})

describe("gen-name", () => {
  test("format", () => { expect(genName()).toMatch(/^[a-z]+-[a-z]+$/) })
  test("unique", () => {
    const names = new Set(Array.from({ length: 20 }, genName))
    expect(names.size).toBeGreaterThan(1)
  })
})

describe("compact", () => {
  test("small", () => { expect(compact(999)).toBe("999") })
  test("thousands", () => { expect(compact(1500)).toBe("1.5K") })
  test("millions", () => { expect(compact(2_500_000)).toBe("2.5M") })
})

describe("chop", () => {
  test("short string unchanged", () => { expect(chop("hi", 10)).toBe("hi") })
  test("truncates", () => { expect(chop("hello world", 6)).toBe("hello…") })
})

describe("chopMid", () => {
  test("short string unchanged", () => { expect(chopMid("hi", 10)).toBe("hi") })
  test("truncates middle", () => { const r = chopMid("abcdefghij", 5); expect(r).toContain("…") })
})

describe("plural", () => {
  test("singular", () => { expect(plural(1, "{} item", "{} items")).toBe("1 item") })
  test("plural", () => { expect(plural(3, "{} item", "{} items")).toBe("3 items") })
})

describe("title", () => {
  test("capitalizes words", () => { expect(title("hello world")).toBe("Hello World") })
})

describe("clock", () => {
  test("time returns string", () => { expect(typeof time(Date.now())).toBe("string") })
  test("datetime returns string", () => { expect(typeof datetime(Date.now())).toBe("string") })
  test("todayOrFull for now returns time", () => { expect(typeof todayOrFull(Date.now())).toBe("string") })
})

describe("path-parts", () => {
  test("filename", () => { expect(filename("/foo/bar/baz.ts")).toBe("baz.ts") })
  test("dirname", () => { expect(dirname("/foo/bar/baz.ts")).toBe("/foo/bar/") })
  test("extname", () => { expect(extname("test.ts")).toBe("ts") })
  test("truncName short", () => { expect(truncName("a.ts", 20)).toBe("a.ts") })
  test("truncName long", () => { const n = truncName("very-long-filename-here.ts", 15); expect(n).toContain("…"); expect(n).toContain(".ts") })
})

describe("parse-ref", () => {
  test("unix path with line", () => {
    expect(parseRef("src/foo.ts:42")).toEqual({ path: "src/foo.ts", line: 42, col: undefined })
  })
  test("rejects url", () => { expect(parseRef("https://x.com")).toBeUndefined() })
  test("rejects spaces", () => { expect(parseRef("has space.ts")).toBeUndefined() })
})

describe("hrefToPath", () => {
  test("file url", () => { expect(hrefToPath("file:///home/user/a.txt")).toBe("/home/user/a.txt") })
  test("http url rejected", () => { expect(hrefToPath("https://x.com")).toBeUndefined() })
  test("anchor rejected", () => { expect(hrefToPath("#top")).toBeUndefined() })
  test("relative path", () => { expect(hrefToPath("docs/guide.md")).toBe("docs/guide.md") })
})

describe("esc-re", () => {
  test("escapes specials", () => { expect(escRe("a.b*c")).toBe("a\\.b\\*c") })
  test("no specials", () => { expect(escRe("abc")).toBe("abc") })
})

describe("clamp", () => {
  test("within range", () => { expect(clamp(5, 0, 10)).toBe(5) })
  test("below min", () => { expect(clamp(-1, 0, 10)).toBe(0) })
  test("above max", () => { expect(clamp(15, 0, 10)).toBe(10) })
})

describe("debounce", () => {
  test("calls after delay", async () => {
    let val = 0
    const fn = debounce((n: number) => { val = n }, 10)
    fn.call(1)
    fn.call(2)
    fn.call(3)
    await new Promise((r) => setTimeout(r, 50))
    expect(val).toBe(3)
  })
  test("cancel prevents call", async () => {
    let val = 0
    const fn = debounce((n: number) => { val = n }, 10)
    fn.call(1)
    fn.cancel()
    await new Promise((r) => setTimeout(r, 50))
    expect(val).toBe(0)
  })
})

describe("throttle", () => {
  test("calls immediately", () => {
    let val = 0
    const fn = throttle((n: number) => { val = n }, 100)
    fn.call(42)
    expect(val).toBe(42)
  })
  test("flush pending", async () => {
    let calls = 0
    const fn = throttle(() => { calls++ }, 100)
    fn.call()
    fn.call()
    fn.flush()
    expect(calls).toBe(2)
  })
})

// ── Tier 2: Node builtins ─────────────────────────────────

describe("retry", () => {
  test("succeeds on first try", async () => {
    expect(await retry(() => Promise.resolve("ok"))).toBe("ok")
  })
  test("retries on transient error", async () => {
    let attempt = 0
    const result = await retry(
      () => { attempt++; if (attempt < 2) throw new Error("load failed"); return "done" },
      { attempts: 3, delay: 1 },
    )
    expect(result).toBe("done")
    expect(attempt).toBe(2)
  })
  test("throws on non-transient", async () => {
    await expect(retry(() => { throw new Error("fatal") }, { attempts: 2, delay: 1, retryIf: () => false }))
      .rejects.toThrow("fatal")
  })
})

describe("b64", () => {
  test("round-trip", () => { expect(b64Dec(b64Enc("hello world"))).toBe("hello world") })
  test("url-safe", () => { const e = b64Enc("\xff\xfe"); expect(e).not.toContain("+"); expect(e).not.toContain("/") })
  test("fnv1a consistent", () => { expect(fnv1a("abc")).toBe(fnv1a("abc")) })
  test("fnv1a empty", () => { expect(fnv1a("")).toBeUndefined() })
  test("sampledHash short", () => { expect(sampledHash("hi")).toBe(fnv1a("hi")) })
  test("sampledHash long", () => {
    const s = "a".repeat(600_000)
    const h = sampledHash(s)
    expect(h).toContain("600000:")
  })
})

describe("sha", () => {
  test("produces hex", () => { expect(sha1("hello")).toMatch(/^[0-9a-f]{40}$/) })
  test("deterministic", () => { expect(sha1("test")).toBe(sha1("test")) })
})

describe("abort", () => {
  test("not aborted initially", () => {
    const { signal, clear } = abortAfter(5000)
    expect(signal.aborted).toBe(false)
    clear()
  })
  test("aborts after timeout", async () => {
    const { signal } = abortAfter(10)
    await new Promise((r) => setTimeout(r, 30))
    expect(signal.aborted).toBe(true)
  })
})

describe("abortAny", () => {
  test("combined signal", () => {
    const { signal, clear } = abortAny(5000)
    expect(signal.aborted).toBe(false)
    clear()
  })
})

describe("race", () => {
  test("resolves first", async () => {
    expect(await race(Promise.resolve(42), 1000)).toBe(42)
  })
  test("rejects on timeout", async () => {
    await expect(race(new Promise(() => {}), 10)).rejects.toThrow("timed out")
  })
})

describe("scope", () => {
  test("provide and use", () => {
    const ctx = scope<number>("test")
    ctx.provide(99, () => { expect(ctx.use()).toBe(99) })
  })
  test("throws when missing", () => {
    const ctx = scope<number>("orphan")
    expect(() => ctx.use()).toThrow()
  })
})

// ── Tier 3: refactored ────────────────────────────────────

describe("wildcard", () => {
  test("star match", () => { expect(globMatch("foo.ts", "*.ts")).toBe(true) })
  test("question match", () => { expect(globMatch("a.ts", "?.ts")).toBe(true) })
  test("no match", () => { expect(globMatch("a.js", "*.ts")).toBe(false) })
  test("case-insensitive", () => { expect(globMatch("FOO.TS", "*.ts", true)).toBe(true) })
  test("globBest", () => { expect(globBest("a.ts", { "*.ts": 1, "*.js": 2 })).toBe(1) })
  test("globStructured", () => {
    const r = globStructured({ head: "git", tail: ["status"] }, { "git *": "yes" })
    expect(r).toBe("yes")
  })
})

describe("redact", () => {
  test("strips url", () => { expect(redact("see https://example.com/path")).not.toContain("example.com") })
  test("strips email", () => { expect(redact("email user@host.com here")).not.toContain("user@host.com") })
  test("strips ip", () => { expect(redact("connect to 192.168.1.1")).not.toContain("192.168.1.1") })
  test("empty returns empty", () => { expect(redact("")).toBe("") })
  test("non-string input", () => { expect(redact(null as any)).toBe("null") })
})

describe("merge", () => {
  test("flat merge", () => {
    expect(merge({ a: 1, b: 2 }, { b: 3 } as any)).toEqual({ a: 1, b: 3 })
  })
  test("deep merge", () => {
    expect(merge({ nested: { x: 1, y: 2 } } as any, { nested: { y: 3 } } as any))
      .toEqual({ nested: { x: 1, y: 3 } })
  })
  test("stripNulls", () => {
    expect(stripNulls({ a: 1, b: null, c: { d: null, e: 2 } } as any))
      .toEqual({ a: 1, c: { e: 2 } })
  })
})
