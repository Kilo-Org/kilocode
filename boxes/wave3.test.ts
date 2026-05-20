/**
 * Full atom test suite — validates all 28 boxes are independent
 * Run: bun test (from boxes/ directory)
 */
import { describe, expect, test } from "bun:test"
import * as Age from "./age"
import * as Dur from "./dur"
import * as Fmt from "./fmt"
import * as Cmd from "./parse-cmd"
import * as Tally from "./tally"
import * as Sanitize from "./sanitize"
import * as Fm from "./frontmatter"
import * as Risk from "./risk"
import { disposable } from "./disposable"
import { gate } from "./gate"
import { memo } from "./memo"
import { Channel, pool } from "./channel"
import { cancelAfter, cancelAny } from "./cancel"
import * as RWLock from "./rwlock"
import * as Tokens from "./tokens"
import * as DataUrl from "./dataurl"
import * as Mime from "./mime"
import * as Ansi from "./ansi"
import * as Net from "./net"
import * as Err from "./err"
import * as Human from "./human"
import { splitHunks } from "./diff-split"
import { norm as punyNorm } from "./puny"
import * as Proxy from "./proxy"
import * as Bom from "./bom"
import { count as tokenCount } from "./tokens"

// ── Wave 0: original 10 ────────────────────────────────────

describe("age", () => {
  test("ago", () => { expect(Age.ago(Date.now())).toBe("today"); expect(Age.ago(Date.now() - 86_400_000)).toBe("yesterday"); expect(Age.ago(Date.now() - 5 * 86_400_000)).toBe("5 days ago") })
  test("stale", () => { expect(Age.stale(Date.now())).toBe(""); expect(Age.stale(Date.now() - 10 * 86_400_000)).toContain("10 days") })
})

describe("dur", () => { test("ms", () => { expect(Dur.ms(500)).toBe("500ms"); expect(Dur.ms(1500)).toBe("1.5s"); expect(Dur.ms(150_000)).toBe("2m30s") }) })
describe("fmt", () => { test("money", () => { expect(Fmt.money(0.0123)).toBe("$0.0123"); expect(Fmt.money(1.5)).toBe("$1.50") }) })
describe("parse-cmd", () => { test("base", () => { expect(Cmd.base("git status")).toBe("git"); expect(Cmd.base("sudo rm -rf /")).toBe("sudo"); expect(Cmd.base("MKFS.EXT4 /dev/sda")).toBe("mkfs.ext4") }) })

describe("tally", () => {
  test("accumulate", () => {
    const t = Tally.create()
    t.add("a", { tokens: 100, cost: 0.05 })
    t.add("a", { tokens: 50, cost: 0.03 })
    expect(t.get("a")).toEqual({ tokens: 150, cost: 0.08 })
    expect(t.sum("tokens")).toBe(150)
    t.reset()
    expect(t.get("a")).toBeUndefined()
  })
})

describe("sanitize", () => { test("path", () => { expect(Sanitize.path("a<b>c")).not.toContain("<") }) })
describe("frontmatter", () => { test("parse", () => { const r = Fm.parse("---\nname: x\ntype: y\n---\nbody"); expect(r.meta.name).toBe("x"); expect(r.body).toContain("body") }) })
describe("risk", () => { test("check", () => { expect(Risk.ok("ls")).toBe(true); expect(Risk.check("sudo rm -rf /").block).toBe(true) }) })

// ── Wave 1: new pure atoms ─────────────────────────────────

describe("disposable", () => {
  test("calls fn", () => {
    let called = false
    const d = disposable(() => { called = true })
    d[Symbol.dispose]()
    expect(called).toBe(true)
  })
})

describe("gate", () => {
  test("release resolves wait", async () => {
    const g = gate<number>()
    g.release(42)
    expect(await g.wait()).toBe(42)
  })
})

describe("memo", () => {
  test("lazy init", () => {
    let calls = 0
    const get = memo(() => { calls++; return calls })
    expect(get()).toBe(1)
    expect(get()).toBe(1)
    get.reset()
    expect(get()).toBe(2)
  })
})

describe("channel", () => {
  test("push/next", async () => {
    const ch = new Channel<number>()
    ch.push(1)
    ch.push(2)
    expect(await ch.next()).toBe(1)
    expect(await ch.next()).toBe(2)
  })
  test("pool", async () => {
    const results: number[] = []
    await pool(2, [1, 2, 3, 4], async (n) => results.push(n))
    expect(results.sort()).toEqual([1, 2, 3, 4])
  })
})

describe("cancel", () => {
  test("cancelAfter returns signal", () => {
    const { signal, clear } = cancelAfter(5000)
    expect(signal.aborted).toBe(false)
    clear()
  })
})

describe("rwlock", () => {
  test("concurrent reads", async () => {
    const results: string[] = []
    await Promise.all([
      (async () => { using r = await RWLock.read("k"); results.push("r1") })(),
      (async () => { using r = await RWLock.read("k"); results.push("r2") })(),
    ])
    expect(results.length).toBe(2)
  })
})

describe("tokens", () => { test("count", () => { expect(tokenCount("hello world!")).toBe(3) }) })
describe("dataurl", () => { test("decode base64", () => { expect(DataUrl.decode("data:text/plain;base64,aGVsbG8=")).toBe("hello") }) })
describe("mime", () => { test("sniff png", () => { expect(Mime.sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "?")).toBe("image/png") }) })
describe("ansi", () => { test("bold", () => { expect(Ansi.bold("#ff6600")).toContain("38;2;255;102;0") }); test("invalid", () => { expect(Ansi.bold("bad")).toBeUndefined() }) })
describe("net", () => { test("online", () => { expect(typeof Net.online()).toBe("boolean") }); test("proxied", () => { expect(typeof Net.proxied()).toBe("boolean") }) })

describe("err", () => {
  test("msg from Error", () => { expect(Err.msg(new Error("fail"))).toBe("fail") })
  test("msg from object", () => { expect(Err.msg({ message: "bad" })).toBe("bad") })
  test("msg from string", () => { expect(Err.msg("raw")).toBe("raw") })
  test("fmt stack", () => { expect(Err.fmt(new Error("x"))).toContain("Error: x") })
})

describe("human", () => {
  test("duration", () => { expect(Human.duration(90_000)).toBe("1m 30s"); expect(Human.duration(500)).toBe("500ms") })
  test("compact", () => { expect(Human.compact(1500)).toBe("1.5K"); expect(Human.compact(2_000_000)).toBe("2.0M") })
  test("truncate", () => { expect(Human.truncate("hello world", 6)).toBe("hello…") })
  test("truncateMid", () => { expect(Human.truncateMid("abcdefghij", 7)).toContain("…") })
  test("plural", () => { expect(Human.plural(1, "{} file", "{} files")).toBe("1 file"); expect(Human.plural(3, "{} file", "{} files")).toBe("3 files") })
  test("secsDuration", () => { expect(Human.secsDuration(90)).toBe("1m 30s"); expect(Human.secsDuration(3600)).toBe("1h") })
})

describe("diff-split", () => {
  test("splits unified diff", () => {
    const diff = "--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-old\n+new"
    const hunks = splitHunks(diff)
    expect(hunks.length).toBeGreaterThanOrEqual(1)
    expect(hunks[0]).toContain("-old")
  })
  test("empty diff", () => { expect(splitHunks("").length).toBe(1) })
})

describe("puny", () => {
  test("ascii unchanged", () => { expect(punyNorm("https://example.com")).toBe("https://example.com") })
  test("idn converted", () => { const r = punyNorm("https://аpitest.com/path"); expect(r).toContain("xn--") })
})

describe("proxy", () => {
  test("cleanHeaders strips hop-by-hop", () => {
    const h = Proxy.cleanHeaders({ "connection": "keep-alive", "accept": "text/html" })
    expect(h.get("connection")).toBe(null)
    expect(h.get("accept")).toBe("text/html")
  })
  test("wsTarget upgrades protocol", () => { expect(Proxy.wsTarget("http://x.com/ws")).toBe("ws://x.com/ws") })
})

describe("bom", () => {
  test("split with bom", () => { const r = Bom.split("\uFEFFhello"); expect(r.bom).toBe(true); expect(r.text).toBe("hello") })
  test("split without bom", () => { const r = Bom.split("hello"); expect(r.bom).toBe(false) })
  test("join", () => { expect(Bom.join("hello", true)).toBe("\uFEFFhello"); expect(Bom.join("hello", false)).toBe("hello") })
})
