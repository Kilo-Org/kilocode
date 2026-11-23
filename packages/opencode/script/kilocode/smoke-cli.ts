import { $ } from "bun"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

function smokeEnv(root: string) {
  const env = { ...process.env }
  delete env.KILO_MODELS_PATH
  delete env.KILO_MODELS_URL
  delete env.KILO_CONFIG
  delete env.KILO_CONFIG_DIR
  return {
    ...env,
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_STATE_HOME: path.join(root, "state"),
    KILO_DISABLE_MODELS_FETCH: "1",
    KILO_DISABLE_PROJECT_CONFIG: "1",
    KILO_CONFIG_CONTENT: JSON.stringify({ enabled_providers: ["anthropic"] }),
    ANTHROPIC_API_KEY: "dummy",
  }
}

export async function smokeCli(binaryPath: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-cli-"))
  try {
    const versionOutput = await $`${binaryPath} --version`.env(smokeEnv(root)).text()
    console.log(`Smoke test passed: ${versionOutput.trim()}`)
    console.log(`Running smoke test: ${binaryPath} --pure models anthropic`)
    const out = await $`${binaryPath} --pure models anthropic`.env(smokeEnv(root)).text()
    if (out.split(/\r?\n/).some((line) => line.startsWith("anthropic/"))) return
    throw new Error("Compiled binary did not list Anthropic models from the embedded snapshot")
  } finally {
    await fs
      .rm(root, { recursive: true, force: true })
      .catch((err) => console.warn(`Failed to remove smoke test directory ${root}`, err))
  }
}
