import { describe, expect, test } from "bun:test"
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { dirname, join } from "path"

const source = join(import.meta.dir, "..", "..", "bin", "kilo")
const helper = join(import.meta.dir, "..", "..", "bin", "kilocode", "windows-avx2.cjs")
const node = (() => {
  const bin = Bun.which("node")
  if (!bin) throw new Error("Launcher tests require Node.js")
  return bin
})()

type Input = {
  avx2?: boolean | null
  bin?: string
  cache?: string
  code?: number
  failure?: "sync" | "async"
  host?: string
  now?: number
  signal?: boolean
  uptime?: number
  wasm?: string
}

type Output = {
  probes: string[]
  spawns: { target: string; args: string[]; wasm: string; probes: number; listeners: number[] }[]
  signals: string[]
  listeners: number[]
}

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "kilo-bin-startup-")))
  const pkg = join(root, "node_modules", "@kilocode", "cli")
  const wrapper = join(pkg, "bin", "kilo")
  const helperTarget = join(pkg, "bin", "kilocode", "windows-avx2.cjs")
  const cached = join(pkg, "bin", ".kilo")
  const optimized = join(pkg, "node_modules", "@kilocode", "cli-windows-x64", "bin", "kilo.exe")
  const baseline = join(pkg, "node_modules", "@kilocode", "cli-windows-x64-baseline", "bin", "kilo.exe")
  const home = join(root, "home")
  const cache = join(root, "cache")
  const file = join(cache, "kilo", "bin", "windows-avx2.json")
  const preload = join(root, "preload.cjs")
  const log = join(root, "trace.json")

  for (const target of [wrapper, optimized, baseline]) {
    const wasm = join(dirname(target), "tree-sitter")
    await mkdir(wasm, { recursive: true })
    await writeFile(join(wasm, "tree-sitter.wasm"), "wasm")
    await writeFile(target, "binary")
  }
  await mkdir(home)
  await copyFile(source, wrapper)
  await mkdir(dirname(helperTarget), { recursive: true })
  await copyFile(helper, helperTarget)
  await writeFile(join(pkg, "package.json"), JSON.stringify({ name: "@kilocode/cli", type: "commonjs" }))
  await writeFile(
    preload,
    `const os = require("node:os")
const fs = require("node:fs")
const child = require("node:child_process")
const events = require("node:events")
const input = JSON.parse(process.env.KILO_STARTUP_TEST)
const trace = { probes: [], spawns: [], signals: [] }
const signals = ["SIGINT", "SIGTERM", "SIGHUP"]
const listeners = () => signals.map((signal) => process.listenerCount(signal))
os.platform = () => "win32"
os.arch = () => "x64"
os.hostname = () => input.host ?? "test-host"
os.release = () => "10.0.26100"
os.cpus = () => [{ model: "test CPU" }]
os.uptime = () => input.uptime ?? 100
Date.now = () => input.now ?? 1_000_000
process.on("exit", () => fs.writeFileSync(process.env.KILO_STARTUP_LOG, JSON.stringify({ ...trace, listeners: listeners() })))
child.spawnSync = (exe) => {
  trace.probes.push(exe)
  return input.avx2 === null ? { status: 1, stdout: "" } : { status: 0, stdout: String(input.avx2 ?? true) }
}
child.spawn = (target, args) => {
  trace.spawns.push({ target, args, wasm: process.env.KILO_TREE_SITTER_WASM_DIR, probes: trace.probes.length, listeners: listeners() })
  const failure = target.endsWith(".kilo") && input.failure
  if (failure === "sync") throw new Error("cached binary failed")
  const proc = new events.EventEmitter()
  proc.kill = (signal) => trace.signals.push(target + ":" + signal)
  process.nextTick(() => {
    if (failure === "async") {
      proc.emit("error", new Error("cached binary failed"))
      return
    }
    if (input.signal) process.emit("SIGTERM")
    proc.emit("exit", input.code ?? 0)
  })
  return proc
}
`,
  )

  return {
    root,
    cached,
    optimized,
    baseline,
    home,
    cache,
    file,
    async run(input: Input = {}) {
      const proc = Bun.spawnSync([node, "--require", preload, wrapper, "debug", "paths", "--pure"], {
        cwd: root,
        windowsHide: true,
        env: {
          PATH: process.env.PATH ?? "",
          SystemRoot: process.env.SystemRoot,
          HOME: home,
          USERPROFILE: home,
          TMPDIR: root,
          TMP: root,
          TEMP: root,
          XDG_CACHE_HOME: input.cache ?? cache,
          KILO_BIN_PATH: input.bin,
          KILO_TREE_SITTER_WASM_DIR: input.wasm,
          KILO_STARTUP_TEST: JSON.stringify(input),
          KILO_STARTUP_LOG: log,
        },
      })
      expect(proc.exitCode, proc.stderr.toString()).toBe(input.code ?? 0)
      const out: Output = JSON.parse(await readFile(log, "utf8"))
      return out
    },
    [Symbol.asyncDispose]() {
      return rm(root, { recursive: true, force: true })
    },
  }
}

describe("npm launcher startup", () => {
  test("explicit binary bypasses probes and preserves arguments, resources, and exit status", async () => {
    await using item = await fixture()
    await writeFile(item.cached, "binary")
    const wasm = join(item.root, "custom-wasm")
    const out = await item.run({ bin: item.optimized, wasm, code: 7 })
    expect(out.probes).toEqual([])
    expect(out.spawns).toHaveLength(1)
    expect(out.spawns.at(0)).toMatchObject({
      target: item.optimized,
      args: ["debug", "paths", "--pure"],
      wasm,
    })
  })

  test("working cached binary bypasses probes", async () => {
    await using item = await fixture()
    await writeFile(item.cached, "binary")
    const out = await item.run()
    expect(out.probes).toEqual([])
    expect(out.spawns).toHaveLength(1)
    expect(out.spawns.at(0)).toMatchObject({ target: item.cached, wasm: join(dirname(item.cached), "tree-sitter") })
  })

  test.each([true, false])("reuses a validated AVX2 result of %j across Node processes", async (avx2) => {
    await using item = await fixture()
    expect((await item.run({ avx2 })).probes).toEqual(["powershell.exe"])
    expect(JSON.parse(await readFile(item.file, "utf8"))).toMatchObject({ avx2 })
    const out = await item.run({ avx2: !avx2 })
    expect(out.probes).toEqual([])
    expect(out.spawns.at(0)?.target).toBe(avx2 ? item.optimized : item.baseline)
  })

  test.each(["corrupt", "nonboolean", "host", "boot"])("refreshes a %s cache", async (kind) => {
    await using item = await fixture()
    await item.run()
    expect(await Bun.file(item.file).exists()).toBe(true)
    if (kind === "corrupt") await writeFile(item.file, "{")
    if (kind === "nonboolean") {
      const entry: Record<string, unknown> = JSON.parse(await readFile(item.file, "utf8"))
      await writeFile(item.file, JSON.stringify({ ...entry, avx2: "true" }))
    }
    const out = await item.run({
      avx2: false,
      ...(kind === "host" ? { host: "other-host" } : {}),
      ...(kind === "boot" ? { uptime: 5 } : {}),
    })
    expect(out.probes).toEqual(["powershell.exe"])
    expect(out.spawns.at(0)?.target).toBe(item.baseline)
  })

  test("uses a short-lived conservative cache after probe failures and retries after expiry", async () => {
    await using item = await fixture()
    const cold = await item.run({ avx2: null })
    expect(cold.probes).toEqual(["powershell.exe", "pwsh.exe", "pwsh", "powershell"])
    expect(cold.spawns.at(0)?.target).toBe(item.baseline)
    const warm = await item.run()
    expect(warm.probes).toEqual([])
    expect(warm.spawns.at(0)?.target).toBe(item.baseline)
    const retry = await item.run({ now: 1_061_000, uptime: 161 })
    expect(retry.probes).toEqual(["powershell.exe"])
    expect(retry.spawns.at(0)?.target).toBe(item.optimized)
  })

  test("continues when a file blocks the cache directory", async () => {
    await using item = await fixture()
    await writeFile(item.cache, "blocked")
    for (const avx2 of [false, true]) {
      const out = await item.run({ avx2 })
      expect(out.probes).toEqual(["powershell.exe"])
      expect(out.spawns.at(0)?.target).toBe(avx2 ? item.optimized : item.baseline)
    }
  })

  test.each(["sync", "async"] as const)("defers lookup until a cached %s spawn failure", async (failure) => {
    await using item = await fixture()
    await writeFile(item.cached, "binary")
    const out = await item.run({ failure, signal: true })
    expect(out.probes).toEqual(["powershell.exe"])
    expect(out.spawns.map((spawn) => [spawn.target, spawn.probes])).toEqual([
      [item.cached, 0],
      [item.optimized, 1],
    ])
    expect(out.spawns.at(-1)).toMatchObject({
      args: ["debug", "paths", "--pure"],
      wasm: join(dirname(item.cached), "tree-sitter"),
      listeners: [0, 0, 0],
    })
    expect(out.signals).toEqual([item.optimized + ":SIGTERM"])
    expect(out.listeners).toEqual([0, 0, 0])
  })

  test.each(["optimized", "baseline"] as const)("uses the available variant when %s is missing", async (missing) => {
    await using item = await fixture()
    await rm(item[missing])
    const target = missing === "optimized" ? item.baseline : item.optimized
    const out = await item.run({ avx2: missing === "optimized" })
    expect(out.spawns.at(0)).toMatchObject({ target, wasm: join(dirname(target), "tree-sitter") })
  })

  test.each(["relative", "newline"])("handles a %s XDG cache path", async (kind) => {
    await using item = await fixture()
    const cache = kind === "relative" ? "relative-cache" : item.cache + "\r\n"
    const root = kind === "relative" ? join(item.home, ".cache") : item.cache
    await item.run({ cache })
    expect(await Bun.file(join(root, "kilo", "bin", "windows-avx2.json")).exists()).toBe(true)
    expect((await item.run({ cache })).probes).toEqual([])
  })
})
