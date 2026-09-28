import { build } from "esbuild"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { exec } from "../../src/util/process"

export async function node(name: string, opts: { timeout: number; env?: NodeJS.ProcessEnv }) {
  const root = path.resolve(import.meta.dir, "../..")
  const dir = await mkdtemp(path.join(root, `.${name}-`))
  try {
    const file = path.join(dir, "test.cjs")
    await build({
      entryPoints: [path.join(root, `tests/fixtures/${name}.ts`)],
      outfile: file,
      bundle: true,
      platform: "node",
      format: "cjs",
      external: ["@playwright/test", "playwright-core"],
      logLevel: "silent",
    })
    return await exec("node", ["--test-reporter=tap", file], { ...opts, killSignal: "SIGKILL" }).catch(
      (error: Error & { stdout?: string; stderr?: string }) => {
        throw new Error([error.message, error.stdout, error.stderr].filter(Boolean).join("\n"), { cause: error })
      },
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
