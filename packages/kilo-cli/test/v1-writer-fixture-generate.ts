import { createReadStream } from "node:fs"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const v1Checkout = process.env.KILOCODE_V1_CHECKOUT
if (!v1Checkout) throw new Error("KILOCODE_V1_CHECKOUT must point at the exact Kilo-main checkout to audit")

const output = process.env.KILO_V1_FIXTURE_SQL ?? path.join(import.meta.dir, "fixtures", "v1-writer", "kilo.db.sql")
const root = await mkdtemp(path.join(os.tmpdir(), "kilo2-v1-writer-generate-"))
const sourceDirectory = path.join(root, "source")
const source = path.join(sourceDirectory, "kilo.db")
const projectDirectory = path.join(root, "project")
const manifestPath = path.join(root, "manifest.json")

try {
  await mkdir(sourceDirectory)
  await mkdir(projectDirectory)
  const child = Bun.spawn(
    [process.execPath, "--no-env-file", path.join(import.meta.dir, "v1-writer-fixture-child.ts")],
    {
      cwd: path.join(v1Checkout, "packages/opencode"),
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: path.join(root, "home"),
        USERPROFILE: path.join(root, "home"),
        TMPDIR: path.join(root, "tmp"),
        TMP: path.join(root, "tmp"),
        TEMP: path.join(root, "tmp"),
        XDG_DATA_HOME: path.join(root, "data"),
        XDG_CONFIG_HOME: path.join(root, "config"),
        XDG_CACHE_HOME: path.join(root, "cache"),
        XDG_STATE_HOME: path.join(root, "state"),
        OPENCODE_TEST_HOME: path.join(root, "home"),
        KILO_DB: source,
        KILO_DISABLE_CHANNEL_DB: "1",
        KILO_DISABLE_DEFAULT_PLUGINS: "1",
        KILOCODE_V1_CHECKOUT: v1Checkout,
        KILO_V1_FIXTURE_PROJECT: projectDirectory,
        KILO_V1_FIXTURE_MANIFEST: manifestPath,
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
    },
  )
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`Kilo-main writer exited ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`)

  if (!Bun.which("sqlite3")) throw new Error("sqlite3 is required only to regenerate the checked-in writer dump")
  const dump = Bun.spawn(["sqlite3", source, ".dump"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [dumpCode, dumpStdout, dumpStderr] = await Promise.all([
    dump.exited,
    new Response(dump.stdout).text(),
    new Response(dump.stderr).text(),
  ])
  if (dumpCode !== 0) throw new Error(`sqlite3 dump exited ${dumpCode}: ${dumpStderr}`)

  await mkdir(path.dirname(output), { recursive: true })
  // Keep the checked-in SQL portable; this only normalizes the disposable
  // project directory that the writer received, not any session payload.
  await Bun.write(output, dumpStdout.replaceAll(projectDirectory, "/tmp/kilo-v1-writer-fixture-project"))
  const hasher = new Bun.CryptoHasher("sha256")
  for await (const chunk of createReadStream(output)) hasher.update(chunk)
  console.log(JSON.stringify({ output, sha256: hasher.digest("hex"), manifest: await Bun.file(manifestPath).json() }))
} finally {
  await rm(root, { recursive: true, force: true })
}
