import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { fileURLToPath } from "node:url"
import os from "node:os"
import path from "node:path"
import { FIXTURE_ROOT_ENV } from "./fixture"

// Disposable sentinel roots only: the probes never touch the real HOME, and the
// env is applied to a fresh subprocess BEFORE the probe module imports, so the
// global-roots capture sees exactly the sentinel values.
const sentinel = mkdtempSync(path.join(os.tmpdir(), "kilo-fixture-guard-sentinel-"))
const probe = path.join(import.meta.dir, "guard-probe.ts")

function sentinelEnv(root: string, dataHome: string, marker = true) {
  const tmp = path.join(root, "home", "tmp")
  mkdirSync(tmp, { recursive: true })
  return {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    ...(marker ? { [FIXTURE_ROOT_ENV]: root } : {}),
    XDG_DATA_HOME: dataHome,
    XDG_CONFIG_HOME: path.join(root, "home", "config"),
    XDG_CACHE_HOME: path.join(root, "home", "cache"),
    XDG_STATE_HOME: path.join(root, "home", "state"),
    XDG_RUNTIME_DIR: path.join(root, "home", "run"),
    TMPDIR: tmp,
    TMP: tmp,
    TEMP: tmp,
    HOME: path.join(root, "home"),
    USERPROFILE: path.join(root, "home"),
    TERM: "dumb",
  }
}

// The interactive database path for a disposable data home: never the real HOME.
function sentinelDatabase(dataHome: string) {
  return path.join(dataHome, "kilo2", "interactive", "kilo2.db")
}

function runProbe(env: NodeJS.ProcessEnv) {
  const child = Bun.spawn([process.execPath, probe], { env, stdout: "pipe", stderr: "pipe", stdin: "ignore" })
  return Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
}

afterAll(() => {
  rmSync(sentinel, { recursive: true, force: true })
})

test("refuses without the wrapper marker, before any layout resolution", async () => {
  const root = path.join(sentinel, "no-marker")
  mkdirSync(path.join(root, "home", "data"), { recursive: true })
  const [code, , stderr] = await runProbe(sentinelEnv(root, path.join(root, "home", "data"), false))
  expect(code).not.toBe(0)
  expect(stderr).toContain("outside the test wrapper")
})

test("allows a wrapper root that contains every resolved store path", async () => {
  const root = path.join(sentinel, "wrapper")
  mkdirSync(path.join(root, "home", "data"), { recursive: true })
  const [code, stdout] = await runProbe(sentinelEnv(root, path.join(root, "home", "data")))
  expect(code).toBe(0)
  const printed = JSON.parse(stdout) as { data: string; database: string }
  // The store root does not exist yet (the guard is read-only), so the resolved
  // paths are compared lexically against the canonical root joined suffix.
  expect(printed.data).toBe(path.join(root, "home", "data", "kilo2", "interactive"))
  expect(printed.database).toBe(path.join(printed.data, "kilo2.db"))
})

test("refuses when a resolved store path escapes the wrapper root", async () => {
  const root = path.join(sentinel, "wrapper-escape")
  const outside = path.join(sentinel, "outside")
  mkdirSync(path.join(outside, "data"), { recursive: true })
  const [code, , stderr] = await runProbe(sentinelEnv(root, path.join(outside, "data")))
  expect(code).not.toBe(0)
  expect(stderr).toContain("escapes the fixture root")
})

test("refuses when the wrapper root symlink escapes the sentinel", async () => {
  const real = path.join(sentinel, "real-root-escape")
  mkdirSync(path.join(real, "home", "data"), { recursive: true })
  const link = path.join(sentinel, "link-root-escape")
  symlinkSync(real, link, "dir")
  const outside = path.join(sentinel, "outside-escape")
  mkdirSync(path.join(outside, "data"), { recursive: true })
  const [code, , stderr] = await runProbe(sentinelEnv(link, path.join(outside, "data")))
  expect(code).not.toBe(0)
  expect(stderr).toContain("escapes the fixture root")
})

test("refuses a storage symlink inside the fixture root that points outside it", async () => {
  const root = path.join(sentinel, "storage-link")
  const outside = path.join(sentinel, "storage-target")
  mkdirSync(path.join(root, "home"), { recursive: true })
  mkdirSync(outside)
  symlinkSync(outside, path.join(root, "home", "data"), "dir")
  const [code, , stderr] = await runProbe(sentinelEnv(root, path.join(root, "home", "data")))
  expect(code).not.toBe(0)
  expect(stderr).toContain("escapes the fixture root")
})

for (const entry of [
  "gateway-scope-acceptance-fixture.ts",
  "sidebar-bench-ui-fixture.tsx",
  "model-info-dialog-fixture.tsx",
  "gateway-protocol-fixture.ts",
  "routed-model-integration-fixture.ts",
  "model-prompt-policy-fixture.ts",
  "model-picker-ui-fixture.tsx",
]) {
  test(`direct ${entry} refuses before creating a credential database`, async () => {
    const root = path.join(sentinel, entry)
    const data = path.join(root, "home", "data")
    const env = sentinelEnv(root, data, false)
    const child = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        "--preload",
        fileURLToPath(import.meta.resolve("@opentui/solid/preload")),
        path.join(import.meta.dir, entry),
      ],
      {
        cwd: root,
        env: { ...env, TUI_BENCH_SCENARIO: "valid", TUI_MODEL_INFO_SCENARIO: "valid" },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: 15000,
      },
    )
    try {
      const [code, , stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      expect(code).not.toBe(0)
      expect(stderr).toContain("outside the test wrapper")
      expect(existsSync(sentinelDatabase(data))).toBe(false)
    } finally {
      child.kill()
      await child.exited
    }
  }, 20000)
}
