// Regenerates the v1 reference fixtures in test/fixtures/v1 (U-E0-05) from the real v1 code.
//
//   KILOCODE_V1_CHECKOUT=<clean v1 checkout at the pinned v1 target, after bun install> bun script/v1-fixtures.ts
//
// Each area runs in its own child process inside the v1 checkout, with its own temporary HOME, XDG and TMPDIR, so
// that no v1 code can reach the real user stores (see technical-notes/baseline/cli-fixture-storage-incident.md).
// The child calls the v1 functions and writes the cases; this script adds the provenance and writes the fixture.
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const areas = {
  "offline-wait": "U-E2-01",
  overflow: "U-E2-02",
  "slow-snapshot": "U-E2-03",
  snapshot: "U-E2-04",
}

const checkout = process.env.KILOCODE_V1_CHECKOUT
if (!checkout) throw new Error("KILOCODE_V1_CHECKOUT must point at a v1 checkout at the pinned v1 target")
const repo = path.resolve(import.meta.dir, "../../..")
const commit: string = (await Bun.file(path.join(repo, "migration-tracking/progress/features.json")).json()).pins
  .v1Target
const head = (await Bun.$`git -C ${checkout} rev-parse HEAD`.text()).trim()
if (head !== commit) throw new Error(`v1 checkout is at ${head}, the pinned v1 target is ${commit}`)
const dirty = (await Bun.$`git -C ${checkout} status --porcelain --untracked-files=no -- packages`.text()).trim()
if (dirty) throw new Error(`v1 checkout has local changes:\n${dirty}`)

const only = process.argv.slice(2)
for (const [area, unit] of Object.entries(areas).filter(([area]) => only.length === 0 || only.includes(area))) {
  const temp = await mkdtemp(path.join(os.tmpdir(), `kilo-v1-fixture-${area}-`))
  try {
    const dirs = { home: "home", tmp: "tmp", data: "data", config: "config", cache: "cache", state: "state" }
    await Promise.all(Object.values(dirs).map((dir) => mkdir(path.join(temp, dir))))
    const out = path.join(temp, "cases.json")
    const child = Bun.spawn(
      [process.execPath, "--no-env-file", path.join(import.meta.dir, "v1-fixtures", `${area}.mjs`)],
      {
        cwd: path.join(checkout, "packages/opencode"),
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: path.join(temp, "home"),
          USERPROFILE: path.join(temp, "home"),
          OPENCODE_TEST_HOME: path.join(temp, "home"),
          TMPDIR: path.join(temp, "tmp"),
          TMP: path.join(temp, "tmp"),
          TEMP: path.join(temp, "tmp"),
          XDG_DATA_HOME: path.join(temp, "data"),
          XDG_CONFIG_HOME: path.join(temp, "config"),
          XDG_CACHE_HOME: path.join(temp, "cache"),
          XDG_STATE_HOME: path.join(temp, "state"),
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: path.join(temp, "home", ".gitconfig"),
          KILO_DISABLE_CHANNEL_DB: "1",
          KILO_DISABLE_DEFAULT_PLUGINS: "1",
          KILO_V1_CHECKOUT: checkout,
          KILO_V1_FIXTURE_OUT: out,
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: 300_000,
      },
    )
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    if (code !== 0) throw new Error(`${area}: v1 child exited ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`)
    const result = await Bun.file(out).json()
    const fixture = {
      unit,
      area,
      v1: { commit, sources: result.sources },
      constants: result.constants,
      cases: result.cases,
    }
    // The temporary root is the only machine-specific value a case can carry. Replace it in each string before
    // serializing (JSON escapes Windows backslashes), in both forms (macOS resolves /var to /private/var), longest first.
    const roots = [...new Set([await realpath(temp), temp])].sort((a, b) => b.length - a.length)
    const text = JSON.stringify(
      fixture,
      (_key, value) =>
        typeof value === "string" ? roots.reduce((s, root) => s.replaceAll(root, "<tmp>"), value) : value,
      2,
    )
    const file = path.join(import.meta.dir, "../test/fixtures/v1", `${area}.json`)
    await Bun.write(file, text + "\n")
    console.log(`${area}: ${result.cases.length} cases -> ${path.relative(repo, file)}`)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}
