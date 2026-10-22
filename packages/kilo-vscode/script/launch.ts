#!/usr/bin/env bun
// Builds the extension and opens it in a separate VS Code instance: own user data, own extensions, and a Kilo v2
// server profile under `<repo>/.kilo-dev/` (or `--fresh` for a temporary one). The extension starts the server
// through `script/dev-isolated.ts` with that profile, so the installed Kilo and its data are never used.
// Usage: bun run extension [--fresh] [--no-build] [--insiders] [workspace]
import { existsSync } from "node:fs"
import { mkdir, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const repo = path.resolve(root, "..", "..")
const args = Bun.argv.slice(2)
const fresh = args.includes("--fresh")
const insiders = args.includes("--insiders")
const workspace = path.resolve(args.find((arg) => !arg.startsWith("--")) ?? process.env.INIT_CWD ?? process.cwd())
const state = fresh ? await mkdtemp(path.join(tmpdir(), "kilo-vscode-v2-")) : path.join(repo, ".kilo-dev")
await mkdir(state, { recursive: true })

if (!args.includes("--no-build")) {
  const build = Bun.spawn([process.execPath, path.join(root, "esbuild.js")], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  })
  if ((await build.exited) !== 0) process.exit(1)
}

const stable = [
  "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
  "/usr/share/code/bin/code",
  "/usr/bin/code",
]
const preview = [
  "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders",
  "/usr/bin/code-insiders",
]
const code =
  [process.env.VSCODE_EXEC_PATH, ...(insiders ? [...preview, ...stable] : [...stable, ...preview])].find(
    (file) => file && existsSync(file),
  ) ?? (insiders ? "code-insiders" : "code")

const profile = process.env.KILO_V2_PROFILE ?? path.join(state, "profile")
console.log(`workspace: ${workspace}\nstate: ${state}\nserver profile: ${profile}`)
const child = Bun.spawn(
  [
    code,
    "--new-window",
    `--user-data-dir=${path.join(state, "user")}`,
    `--extensions-dir=${path.join(state, "extensions")}`,
    `--extensionDevelopmentPath=${root}`,
    workspace,
  ],
  {
    env: { ...process.env, KILO_V2_PROFILE: profile },
    stdout: "inherit",
    stderr: "inherit",
  },
)
process.exit(await child.exited)
