import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { TestCli } from "../../script/kilocode/test-cli"
import { tmpdir } from "../fixture/fixture"

test("warm npm launcher and real CLI startup stay within budget", async () => {
  const root = path.resolve(import.meta.dir, "../..")
  const entry = process.env[TestCli.ENV] ?? (await TestCli.build(root))
  const node = Bun.which("node")
  if (!node) throw new Error("Startup test requires Node.js")
  await using dir = await tmpdir()
  const platform = process.platform === "win32" ? "windows" : process.platform
  const modules = path.join(dir.path, "node_modules", "@kilocode")
  const wrapper = path.join(modules, "cli", "bin", "kilo")
  const helper = path.join(modules, "cli", "bin", "kilocode", "windows-avx2.cjs")
  const binary = path.join(
    modules,
    `cli-${platform}-${process.arch}`,
    "bin",
    process.platform === "win32" ? "kilo.exe" : "kilo",
  )
  await fs.mkdir(path.dirname(wrapper), { recursive: true })
  await fs.mkdir(path.dirname(helper), { recursive: true })
  await fs.mkdir(path.dirname(binary), { recursive: true })
  await fs.copyFile(path.join(root, "bin", "kilo"), wrapper)
  await fs.copyFile(path.join(root, "bin", "kilocode", "windows-avx2.cjs"), helper)
  await fs.copyFile(process.execPath, binary)
  const env: Record<string, string> = {}
  for (const key of ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "SystemDrive"]) {
    if (process.env[key]) env[key] = process.env[key]
  }
  for (const key of [
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "XDG_CACHE_HOME",
    "XDG_RUNTIME_DIR",
    "TMP",
    "TEMP",
    "TMPDIR",
  ]) {
    env[key] = path.join(dir.path, key)
    await fs.mkdir(env[key], { recursive: true })
  }
  Object.assign(env, {
    KILO_TELEMETRY_LEVEL: "off",
    DO_NOT_TRACK: "1",
    OTEL_SDK_DISABLED: "true",
    KILO_DISABLE_MODELS_FETCH: "1",
    KILO_DISABLE_AUTOUPDATE: "1",
    KILO_DISABLE_PROJECT_CONFIG: "1",
    KILO_CONFIG_CONTENT: "{}",
    KILO_AUTH_CONTENT: "{}",
    KILO_PURE: "1",
  })
  // Reuse the real test bundle, not a fake child or a downloaded release.
  // This guards launcher + CLI entry imports/exit, not full bootstrap or the release loader.
  const samples = []
  for (let i = 0; i < 4; i++) {
    const start = performance.now()
    const proc = Bun.spawn([node, wrapper, "run", entry, "--version"], {
      cwd: dir.path,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    })
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const elapsed = performance.now() - start
    expect(code, stderr).toBe(0)
    expect(stdout.trim()).toMatch(/^(local|\d+\.\d+\.\d+.*)$/)
    samples.push(elapsed)
  }
  // One warm-up, then a median with headroom for shared CI runners. The old
  // Windows probe alone took about 3.3s; warm native --version took 0.6s.
  // Loaded macOS CI measured a 2.1s median with a 2.9s sample; allow more noise there.
  const budget = process.platform === "darwin" ? 5000 : 3000
  const warm = samples.slice(1)
  const median = warm.toSorted((a, b) => a - b).at(1) ?? Infinity
  console.log(
    `Startup (${process.platform}): ${warm.map((value) => value.toFixed(0)).join(", ")} ms; median ${median.toFixed(0)} ms`,
  )
  await Bun.write(
    path.join(root, ".artifacts/unit/startup.json"),
    JSON.stringify(
      {
        platform: process.platform,
        arch: process.arch,
        bun: Bun.version,
        warmup: samples.at(0),
        samples: warm,
        median,
        budget,
      },
      null,
      2,
    ),
  )
  expect(median).toBeLessThan(budget)
}, 60_000)
