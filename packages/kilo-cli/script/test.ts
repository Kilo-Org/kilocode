import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { requireRuntime } from "../src/runtime"

requireRuntime()
const directory = path.resolve(import.meta.dir, "..")
const artifact = await mkdtemp(path.join(os.tmpdir(), "kilo-test-artifact-"))
try {
  const build = Bun.spawn([process.execPath, "--no-env-file", path.join(import.meta.dir, "build.ts"), artifact], {
    cwd: directory,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  const built = await build.exited
  if (built !== 0) throw new Error(`Preview test build failed (${built})`)
  const acp = Bun.spawn(
    [process.execPath, "--no-env-file", path.join(import.meta.dir, "build-acp.ts"), path.join(artifact, "acp")],
    {
      cwd: directory,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  )
  if ((await acp.exited) !== 0) throw new Error("ACP test build failed")
  const tests = Bun.spawn(
    [process.execPath, "test", "--preload", "@opentui/solid/preload", "--timeout", "30000", ...process.argv.slice(2)],
    {
      cwd: directory,
      env: { ...process.env, KILO_CLI_TEST_ARTIFACT_DIR: artifact, KILO_ACP_ARTIFACT: path.join(artifact, "acp") },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  )
  process.exitCode = await tests.exited
} finally {
  await rm(artifact, { recursive: true, force: true })
}
