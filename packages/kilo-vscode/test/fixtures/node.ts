import { build } from "esbuild"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { spawn } from "../../src/util/process"

// Playwright starts Chromium in its own process group, so killing the Node child with SIGKILL leaves Chromium running.
// Ask the fixture to close its browser with SIGTERM first, and only escalate to SIGKILL after this grace period.
const GRACE = 5000

// Bun resolves `exec` with the kill signal as soon as it kills, so its `timeout`/`killSignal` options cannot give the
// fixture time to close its browser. Drive the two signals here instead.
export async function node(name: string, opts: { timeout: number; env?: NodeJS.ProcessEnv }) {
  const root = path.resolve(import.meta.dir, "../..")
  const dir = await mkdtemp(path.join(root, `.${name}-`))
  try {
    const file = path.join(dir, "test.cjs")
    await build({
      entryPoints: [path.join(root, `test/fixtures/${name}.ts`)],
      outfile: file,
      bundle: true,
      platform: "node",
      format: "cjs",
      external: ["@playwright/test", "playwright-core"],
      logLevel: "silent",
    })
    return await exec(["--test-reporter=tap", file], opts)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function exec(args: string[], opts: { timeout: number; env?: NodeJS.ProcessEnv }) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("node", args, { env: opts.env, stdio: ["ignore", "pipe", "pipe"] })
    const output = { stdout: "", stderr: "" }
    // The fixture closes its browser and exits 0 on SIGTERM, so any SIGTERM we send means the run overran its budget.
    let asked = false
    child.stdout!.setEncoding("utf8").on("data", (data: string) => (output.stdout += data))
    child.stderr!.setEncoding("utf8").on("data", (data: string) => (output.stderr += data))
    // A child that ignores SIGTERM is killed for real at the timeout, which also bounds the grace period.
    const terminate = setTimeout(() => {
      asked = true
      child.kill("SIGTERM")
    }, Math.max(opts.timeout - GRACE, 0))
    const escalate = setTimeout(() => child.kill("SIGKILL"), opts.timeout)
    const stop = () => {
      clearTimeout(terminate)
      clearTimeout(escalate)
    }
    const fail = (error: Error) => {
      stop()
      reject(new Error([error.message, output.stdout, output.stderr].filter(Boolean).join("\n"), { cause: error }))
    }
    child.on("error", fail)
    child.on("close", (code, signal) => {
      stop()
      if (code === 0 && !asked) return resolve(output)
      fail(new Error(`Command failed: node ${args.join(" ")} ${asked ? "timed out" : (signal ?? code)}`))
    })
  })
}
