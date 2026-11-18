import { afterAll, beforeAll, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import type { Profile } from "../src/profile"
import { root, target } from "../src/nono-binary"

const state = mkdtempSync(path.join(os.tmpdir(), "kilo-nono-backend-"))
const fake = path.join(state, "fake-nono")
const manifest = path.join(state, "manifest.json")
const credentials = path.join(state, "credentials.json")
const profiles = path.join(state, "profiles")

const backend = await import("../src/backend")
const context = await import("../src/context")
const proxy = await import("../src/proxy")

const mac = process.platform === "darwin"
const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex")

beforeAll(() => {
  writeFileSync(fake, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "nono 0.82.0"; fi\nexit 0\n')
  chmodSync(fake, 0o755)
  process.env.KILO_V2_DEV = "1"
  process.env.KILO_SANDBOX_BACKEND = "nono"
  process.env.KILO_NONO_PATH = fake
  process.env.KILO_NONO_STATE = state
  process.env.KILO_NONO_HOME = path.join(state, "nono")
})

afterAll(() => {
  for (const key of [
    "KILO_V2_DEV",
    "KILO_SANDBOX_BACKEND",
    "KILO_NONO_PATH",
    "KILO_NONO_STATE",
    "KILO_NONO_HOME",
    "KILO_NONO_MANIFEST",
    "KILO_NONO_CREDENTIALS",
  ]) {
    delete process.env[key]
  }
  rmSync(state, { recursive: true, force: true })
})

function profile(network: Profile["network"] = { mode: "deny", allowedHosts: [] }): Profile {
  return {
    filesystem: {
      allowWrite: [{ path: "/workspace", kind: "subtree" }],
      denyWrite: [{ path: state, kind: "subtree" }],
      denyNames: [".git"],
      temporaryDirectory: "/tmp/kilo-tmp",
    },
    network,
    environment: { deny: ["KILO_CONFIG"], set: { TMPDIR: "/tmp/kilo-tmp" } },
  }
}

const launch = {
  command: "echo",
  args: ["hello"],
  cwd: "/workspace",
  environment: { PATH: "/usr/bin:/bin", HOME: "/Users/poc" },
}

const runtime = {
  url: "http://127.0.0.1:1",
  token: "poc",
  allowedHosts: ["example.com:443"],
  close: async () => {},
}

function generated(result: Awaited<ReturnType<typeof prepare>>) {
  return JSON.parse(readFileSync(result.args[result.args.indexOf("--profile") + 1], "utf8"))
}

function effect(
  network: Profile["network"] = { mode: "deny", allowedHosts: [] },
  environment: Record<string, string> = launch.environment,
) {
  return Effect.scoped(context.run(profile(network), backend.prepare({ ...launch, environment }))).pipe(
    Effect.provideService(proxy.CurrentProxyFactory, async () => runtime),
  )
}

function prepare(network?: Profile["network"], environment?: Record<string, string>) {
  return Effect.runPromise(effect(network, environment))
}

/** Writes a manifest whose binary digest is `value` for the running target. */
function pin(value = digest(fake)) {
  const name = target()
  if (!name) throw new Error("no nono target for this platform")
  writeFileSync(
    manifest,
    JSON.stringify({
      targets: {
        [name]: {
          tag: "v0.82.0",
          asset: "fixture",
          url: "https://example.invalid/fixture",
          sha256: "0".repeat(64),
          binary_sha256: value,
        },
      },
    }),
  )
  process.env.KILO_NONO_MANIFEST = manifest
}

function staged() {
  const dir = path.join(state, "bin", "nono", "0.82.0")
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, "nono")
  writeFileSync(file, readFileSync(fake))
  chmodSync(file, 0o755)
  return file
}

test.skipIf(!mac)("launches the command through nono with a generated profile", async () => {
  const result = await prepare()
  expect(result.command).toBe(fake)
  expect(result.args.slice(0, 4)).toEqual(["--silent", "run", "--no-audit", "--allow-cwd"])
  const separator = result.args.indexOf("--")
  expect(result.args.slice(separator)).toEqual(["--", "echo", "hello"])
  const profile = generated(result)
  expect(profile.network).toEqual({ block: true })
  expect(profile.filesystem.deny).toContain(realpathSync.native(state))
  expect(profile.workdir).toEqual({ access: "readwrite" })
})

test.skipIf(!mac)("does not grant a launch directory the profile does not cover", async () => {
  const result = await prepare()
  expect(result.args).toContain("--allow-cwd")
  const outside = await Effect.runPromise(
    Effect.scoped(context.run(profile(), backend.prepare({ ...launch, cwd: "/elsewhere" }))).pipe(
      Effect.provideService(proxy.CurrentProxyFactory, async () => runtime),
    ),
  )
  expect(outside.args).not.toContain("--allow-cwd")
  expect(generated(outside).workdir).toEqual({ access: "none" })
})

test.skipIf(!mac)("points nono at its own roots and keeps them present", async () => {
  const result = await prepare()
  for (const root of ["config", "state", "cache", "data"]) {
    const dir = path.join(state, "nono", root)
    expect(result.environment?.[`XDG_${root.toUpperCase()}_HOME`]).toBe(dir)
    expect(existsSync(dir)).toBe(true)
  }
})

test.skipIf(!mac)("recreates a root that disappears between launches", async () => {
  await prepare()
  const data = path.join(state, "nono", "data")
  rmSync(data, { recursive: true, force: true })
  await prepare()
  expect(existsSync(data)).toBe(true)
})

test.skipIf(!mac)("keeps Kilo's proxy out of a sandboxed child", async () => {
  const result = await prepare({ mode: "proxy", allowedHosts: ["example.com:443"] })
  expect(result.environment?.HTTP_PROXY).toBeUndefined()
  expect(result.environment?.HTTPS_PROXY).toBeUndefined()
  expect(generated(result).network).toEqual({ allow_domain: ["example.com"] })
})

test.skipIf(!mac)("masks a credential the profile cannot route", async () => {
  writeFileSync(
    credentials,
    JSON.stringify({
      credentials: [{ name: "demo", source: "env://DEMO_TOKEN", upstream: "https://example.com" }],
    }),
  )
  process.env.KILO_NONO_CREDENTIALS = credentials
  try {
    const result = await prepare(undefined, { ...launch.environment, DEMO_TOKEN: "real-secret" })
    const profile = generated(result)
    expect(profile.environment.deny_vars).toContain("DEMO_TOKEN")
    expect(profile.network).toEqual({ block: true })
  } finally {
    delete process.env.KILO_NONO_CREDENTIALS
  }
})

test.skipIf(!mac)("keeps a masked credential name out of the child environment", async () => {
  writeFileSync(
    credentials,
    JSON.stringify({
      credentials: [{ name: "options", source: "env://NODE_OPTIONS", upstream: "https://example.com" }],
    }),
  )
  process.env.KILO_NONO_CREDENTIALS = credentials
  try {
    const result = await prepare(undefined, { ...launch.environment, NODE_OPTIONS: "--max-old-space-size=4096" })
    const profile = generated(result)
    expect(profile.environment.deny_vars).toContain("NODE_OPTIONS")
    expect(profile.environment.set_vars.NODE_OPTIONS).toBeUndefined()
  } finally {
    delete process.env.KILO_NONO_CREDENTIALS
  }
})

test.skipIf(!mac)("restores the user's XDG roots to the child", async () => {
  const result = await prepare(undefined, { ...launch.environment, XDG_CONFIG_HOME: "/Users/poc/.config" })
  expect(generated(result).environment.set_vars.XDG_CONFIG_HOME).toBe("/Users/poc/.config")
})

test.skipIf(!mac)("refuses to launch when a routed credential has no value", async () => {
  writeFileSync(
    credentials,
    JSON.stringify({
      credentials: [{ name: "demo", source: "env://MISSING_TOKEN", upstream: "https://example.com" }],
    }),
  )
  process.env.KILO_NONO_CREDENTIALS = credentials
  try {
    const before = existsSync(profiles) ? readdirSync(profiles).length : 0
    await expect(prepare({ mode: "proxy", allowedHosts: ["example.com:443"] })).rejects.toBeDefined()
    expect(existsSync(profiles) ? readdirSync(profiles).length : 0).toBe(before)
  } finally {
    delete process.env.KILO_NONO_CREDENTIALS
  }
})

test.skipIf(!mac)("accepts a staged binary that matches the recorded digest", () => {
  const file = staged()
  pin(digest(file))
  delete process.env.KILO_NONO_PATH
  try {
    expect(backend.backendSupport({ mode: "deny", allowedHosts: [] })).toEqual({ available: true })
  } finally {
    process.env.KILO_NONO_PATH = fake
  }
})

test.skipIf(!mac)("rejects a staged binary that does not match the recorded digest", () => {
  staged()
  pin("0".repeat(64))
  delete process.env.KILO_NONO_PATH
  try {
    const support = backend.backendSupport({ mode: "deny", allowedHosts: [] })
    expect(support.available).toBe(false)
    expect(support.available ? "" : support.reason).toContain("does not match the recorded binary pin")
  } finally {
    process.env.KILO_NONO_PATH = fake
  }
})

/** Runs the packaged branch: the build define is a global in a source run, and the sibling is next to the executable. */
function packaged(define: string | undefined, run: () => void) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kilo-nono-packaged-"))
  const sibling = path.join(dir, "nono")
  writeFileSync(sibling, readFileSync(fake))
  chmodSync(sibling, 0o755)
  const before = (globalThis as Record<string, unknown>).KILO_NONO_SHA256
  const execPath = process.execPath
  if (define !== undefined) (globalThis as Record<string, unknown>).KILO_NONO_SHA256 = define
  Object.defineProperty(process, "execPath", { value: path.join(dir, "kilo"), configurable: true })
  delete process.env.KILO_NONO_PATH
  try {
    run()
  } finally {
    if (before === undefined) delete (globalThis as Record<string, unknown>).KILO_NONO_SHA256
    else (globalThis as Record<string, unknown>).KILO_NONO_SHA256 = before
    Object.defineProperty(process, "execPath", { value: execPath, configurable: true })
    process.env.KILO_NONO_PATH = fake
    rmSync(dir, { recursive: true, force: true })
  }
}

test.skipIf(!mac)("accepts the packaged binary next to the executable", () => {
  packaged(digest(fake), () => {
    expect(backend.backendSupport({ mode: "deny", allowedHosts: [] })).toEqual({ available: true })
  })
})

test.skipIf(!mac)("rejects a packaged binary that does not match the embedded digest", () => {
  packaged("0".repeat(64), () => {
    const support = backend.backendSupport({ mode: "deny", allowedHosts: [] })
    expect(support.available).toBe(false)
    expect(support.available ? "" : support.reason).toContain("does not match the recorded binary pin")
  })
})

test.skipIf(!mac)("reports an unusable state directory instead of throwing", () => {
  const blocker = path.join(state, "blocker")
  writeFileSync(blocker, "not a directory")
  process.env.KILO_NONO_HOME = path.join(blocker, "nono")
  try {
    const support = backend.backendSupport({ mode: "deny", allowedHosts: [] })
    expect(support.available).toBe(false)
    expect(support.available ? "" : support.reason).toContain("Could not verify")
  } finally {
    process.env.KILO_NONO_HOME = path.join(state, "nono")
  }
})

test.skipIf(!mac)("masks known aliases and equal-valued variables for a routed credential", async () => {
  writeFileSync(
    credentials,
    JSON.stringify({
      credentials: [{ name: "github", source: "env://GITHUB_TOKEN", upstream: "https://example.com" }],
    }),
  )
  process.env.KILO_NONO_CREDENTIALS = credentials
  try {
    const result = await prepare(
      { mode: "proxy", allowedHosts: ["example.com:443"] },
      { ...launch.environment, GITHUB_TOKEN: "s3cret", GH_TOKEN: "s3cret", OTHER: "s3cret" },
    )
    const profile = generated(result)
    expect(profile.environment.deny_vars).toEqual(expect.arrayContaining(["GH_TOKEN", "GITHUB_OAUTH_TOKEN", "OTHER"]))
    expect(profile.environment.deny_vars).not.toContain("GITHUB_TOKEN")
    expect(profile.network.credentials).toEqual(["github"])
  } finally {
    delete process.env.KILO_NONO_CREDENTIALS
  }
})

test.skipIf(!mac)("keeps every active credential variable when routes share a value", async () => {
  writeFileSync(
    credentials,
    JSON.stringify({
      credentials: [
        { name: "one", source: "env://DEMO_A", upstream: "https://example.com" },
        { name: "two", source: "env://DEMO_B", upstream: "https://example.com" },
      ],
    }),
  )
  process.env.KILO_NONO_CREDENTIALS = credentials
  try {
    const result = await prepare(
      { mode: "proxy", allowedHosts: ["example.com:443"] },
      { ...launch.environment, DEMO_A: "shared", DEMO_B: "shared", OTHER: "shared" },
    )
    const profile = generated(result)
    expect(profile.environment.deny_vars).not.toContain("DEMO_A")
    expect(profile.environment.deny_vars).not.toContain("DEMO_B")
    expect(profile.environment.deny_vars).toContain("OTHER")
  } finally {
    delete process.env.KILO_NONO_CREDENTIALS
  }
})

test.skipIf(!mac)("masks a credential when proxy mode emits no route", async () => {
  writeFileSync(
    credentials,
    JSON.stringify({
      credentials: [{ name: "github", source: "env://GITHUB_TOKEN", upstream: "https://example.com" }],
    }),
  )
  process.env.KILO_NONO_CREDENTIALS = credentials
  try {
    const network = { mode: "proxy", allowedHosts: [] } satisfies Profile["network"]
    const result = await Effect.runPromise(
      Effect.scoped(
        context.run(
          profile(network),
          backend.prepare({ ...launch, environment: { ...launch.environment, GITHUB_TOKEN: "s3cret" } }),
        ),
      ).pipe(Effect.provideService(proxy.CurrentProxyFactory, async () => ({ ...runtime, allowedHosts: [] }))),
    )
    const generated = JSON.parse(readFileSync(result.args[result.args.indexOf("--profile") + 1], "utf8"))
    expect(generated.network).toEqual({ block: true })
    expect(generated.environment.deny_vars).toContain("GITHUB_TOKEN")
  } finally {
    delete process.env.KILO_NONO_CREDENTIALS
  }
})

test.skipIf(!mac)("keeps the sandbox state absolute when the XDG root is relative", () => {
  const previousState = process.env.XDG_STATE_HOME
  const previousExplicit = process.env.KILO_NONO_STATE
  process.env.XDG_STATE_HOME = "rel-state"
  delete process.env.KILO_NONO_STATE
  try {
    expect(path.isAbsolute(root())).toBe(true)
    expect(root()).toContain(`${path.sep}rel-state${path.sep}`)
  } finally {
    if (previousState === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = previousState
    if (previousExplicit === undefined) delete process.env.KILO_NONO_STATE
    else process.env.KILO_NONO_STATE = previousExplicit
  }
})

test.skipIf(!mac)("writes one content-addressed profile for identical inputs", async () => {
  const variant: Profile = {
    ...profile(),
    filesystem: {
      ...profile().filesystem,
      allowWrite: [...profile().filesystem.allowWrite, { path: "/tmp/extra-space", kind: "subtree" }],
    },
  }
  const effect = Effect.scoped(context.run(variant, backend.prepare(launch))).pipe(
    Effect.provideService(proxy.CurrentProxyFactory, async () => runtime),
  )
  const first = await Effect.runPromise(effect)
  const second = await Effect.runPromise(effect)
  const file = second.args[second.args.indexOf("--profile") + 1]
  expect(file).toBe(first.args[first.args.indexOf("--profile") + 1])
  expect(existsSync(file)).toBe(true)
  expect(readdirSync(profiles)).toContain(path.basename(file))
  expect(readdirSync(profiles).some((entry) => entry.endsWith(".tmp"))).toBe(false)
})

test.skipIf(!mac)("drops a profile no launch can still be reading", async () => {
  mkdirSync(profiles, { recursive: true })
  const stale = path.join(profiles, "stale.json")
  writeFileSync(stale, "{}")
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
  utimesSync(stale, old, old)
  await prepare()
  expect(existsSync(stale)).toBe(false)
})

test.skipIf(!mac)("keeps nono's own roots outside the launch directory", async () => {
  // Under the real home: a state root below the system temporary directory is refused for another reason.
  const project = mkdtempSync(path.join(os.homedir(), ".kilo-nono-project-"))
  const previousState = process.env.XDG_STATE_HOME
  const previousHome = process.env.KILO_NONO_HOME
  process.env.XDG_STATE_HOME = path.join(project, "state")
  delete process.env.KILO_NONO_HOME
  try {
    const granted: Profile = {
      ...profile(),
      filesystem: { ...profile().filesystem, allowWrite: [{ path: project, kind: "subtree" }] },
    }
    const result = await Effect.runPromise(
      Effect.scoped(context.run(granted, backend.prepare({ ...launch, cwd: project }))).pipe(
        Effect.provideService(proxy.CurrentProxyFactory, async () => runtime),
      ),
    )
    for (const key of ["XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME"]) {
      expect(result.environment?.[key]?.startsWith(project)).toBe(false)
    }
  } finally {
    if (previousState === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = previousState
    if (previousHome !== undefined) process.env.KILO_NONO_HOME = previousHome
    rmSync(project, { recursive: true, force: true })
  }
})

test.skipIf(!mac)("refuses a launch directory that holds every nono state root", async () => {
  const previousState = process.env.XDG_STATE_HOME
  const previousHome = process.env.KILO_NONO_HOME
  delete process.env.XDG_STATE_HOME
  delete process.env.KILO_NONO_HOME
  try {
    const failure = await Effect.runPromise(
      Effect.scoped(context.run(profile(), backend.prepare({ ...launch, cwd: os.homedir() }))).pipe(
        Effect.provideService(proxy.CurrentProxyFactory, async () => runtime),
      ),
    ).catch((cause) => cause)
    expect(String(failure)).toContain("KILO_NONO_HOME")
  } finally {
    if (previousState === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = previousState
    if (previousHome !== undefined) process.env.KILO_NONO_HOME = previousHome
  }
})

test.skipIf(mac)("reports that nono is macOS only off macOS", () => {
  const support = backend.backendSupport({ mode: "deny", allowedHosts: [] })
  expect(support.available).toBe(false)
  expect(support.available ? "" : support.reason).toContain("macOS only")
})

test.skipIf(!mac)("does not re-probe a binary that hangs", () => {
  const marker = path.join(state, "hung-runs")
  const hung = path.join(state, "hung-nono")
  writeFileSync(
    hung,
    `#!/bin/sh\necho run >> "${marker}"\nif [ "$1" = "--version" ]; then exec sleep 30; fi\nexit 0\n`,
  )
  chmodSync(hung, 0o755)
  const previous = process.env.KILO_NONO_PATH
  process.env.KILO_NONO_PATH = hung
  try {
    const first = backend.backendSupport({ mode: "deny", allowedHosts: [] })
    expect(first.available).toBe(false)
    const runs = readFileSync(marker, "utf8").trim().split("\n").length
    const second = backend.backendSupport({ mode: "deny", allowedHosts: [] })
    expect(second.available ? "" : second.reason).toBe(first.available ? "" : first.reason)
    expect(readFileSync(marker, "utf8").trim().split("\n").length).toBe(runs)
  } finally {
    if (previous === undefined) delete process.env.KILO_NONO_PATH
    else process.env.KILO_NONO_PATH = previous
    rmSync(hung, { force: true })
    rmSync(marker, { force: true })
  }
}, 20000)
