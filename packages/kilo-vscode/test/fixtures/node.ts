import { build } from "esbuild"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { exec } from "../../src/util/process"

// Playwright starts Chromium in its own process group, so killing the Node child with SIGKILL leaves Chromium running.
// Ask the fixture to close its browser with SIGTERM first, then escalate to SIGKILL after this grace period.
const GRACE = 5000

export async function node(name: string, opts: { timeout: number; env?: NodeJS.ProcessEnv }) {
  const root = path.resolve(import.meta.dir, "../..")
  const dir = await mkdtemp(path.join(root, `.${name}-`))
  const terminate = new AbortController()
  const expiry = setTimeout(() => terminate.abort(), Math.max(opts.timeout - GRACE, 0))
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
    // SIGTERM lets the fixture close its browser; `killSignal` escalates after `timeout`, which bounds a child that
    // ignores SIGTERM and keeps the wrapper from hanging.
    return await exec("node", ["--test-reporter=tap", file], {
      ...opts,
      signal: terminate.signal,
      killSignal: "SIGKILL",
      timeout: opts.timeout,
    }).catch((error: Error & { stdout?: string; stderr?: string }) => {
      throw new Error([error.message, error.stdout, error.stderr].filter(Boolean).join("\n"), { cause: error })
    })
  } finally {
    clearTimeout(expiry)
    await rm(dir, { recursive: true, force: true })
  }
}
