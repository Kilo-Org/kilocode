#!/usr/bin/env bun
import { $ } from "bun"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"

const root = join(import.meta.dir, "..")
const repo = join(root, "..", "..")
const sdk = join(repo, "packages", "sdk", "js")
const cache = join(root, "node_modules", ".cache", "sdk-build.json")
const inputs = [
  "package.json",
  "bun.lock",
  "packages/opencode",
  "packages/core",
  "packages/effect-drizzle-sqlite",
  "packages/effect-sqlite-node",
  "packages/kilo-gateway",
  "packages/kilo-indexing",
  "packages/kilo-memory",
  "packages/kilo-sandbox",
  "packages/kilo-telemetry",
  "packages/llm",
  "packages/plugin",
  "packages/plugin-atomic-chat",
  "packages/server",
  "packages/util",
  "packages/sdk/js/package.json",
  "packages/sdk/js/tsconfig.json",
  "packages/sdk/js/script",
  "packages/kilo-vscode/script/prepare-sdk.ts",
]
const outputs = ["packages/sdk/js/src"]

function log(msg: string) {
  console.log(`[prepare-sdk] ${msg}`)
}

async function fingerprint(paths: string[]) {
  const [tree, diff, extra] = await Promise.all([
    $`git ls-tree -r HEAD -- ${paths}`.cwd(repo).quiet(),
    $`git diff --binary HEAD -- ${paths}`.cwd(repo).quiet(),
    $`git ls-files --others --exclude-standard -z -- ${paths}`.cwd(repo).quiet(),
  ])
  const hash = createHash("sha256").update(tree.text()).update(diff.text())
  const files = extra.text().split("\0").filter(Boolean).sort()

  for (const file of files) {
    hash.update(file)
    hash.update(new Uint8Array(await Bun.file(join(repo, file)).arrayBuffer()))
  }

  return hash.digest("hex")
}

async function load() {
  const file = Bun.file(cache)
  if (!(await file.exists())) return

  try {
    const value: unknown = await file.json()
    if (!value || typeof value !== "object") return
    const input = Reflect.get(value, "input")
    const output = Reflect.get(value, "output")
    if (typeof input === "string" && typeof output === "string") return { input, output }
  } catch (err) {
    log(`Ignoring invalid cache: ${err instanceof Error ? err.message : String(err)}`)
  }
}

const input = await fingerprint(inputs)
const prior = await load()
const ready = existsSync(join(sdk, "dist", "index.js")) && existsSync(join(sdk, "dist", "v2", "index.js"))

if (prior?.input === input && prior.output === (await fingerprint(outputs)) && ready) {
  log("SDK inputs and generated output are unchanged")
  process.exit(0)
}

log("SDK inputs changed, rebuilding generated client")
await $`bun run build`.cwd(sdk)

mkdirSync(dirname(cache), { recursive: true })
await Bun.write(cache, JSON.stringify({ input, output: await fingerprint(outputs) }) + "\n")
