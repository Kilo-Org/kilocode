// Builds the extension and opens it in a separate VS Code instance: own user data, own extensions, and a server
// profile under the state directory (or `--fresh` for a temporary one). The installed Kilo CLI login is reused.
// Usage: bun run extension [--fresh] [workspace]
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { reuse } from "./cli-login"

const root = path.resolve(import.meta.dir, "..")
const args = Bun.argv.slice(2)
const fresh = args.includes("--fresh")
const workspace = path.resolve(args.find((arg) => !arg.startsWith("--")) ?? process.env.INIT_CWD ?? process.cwd())
// The instance socket lives in the user data directory, and a unix socket path is limited to 103 characters. A deep
// worktree path would exceed that, so the default state directory is per-repo under the OS temp directory.
const state = fresh
  ? await mkdtemp(path.join(tmpdir(), "kilo-vscode-v2-"))
  : path.join(tmpdir(), `kilo-vscode-v2-${createHash("sha256").update(root).digest("hex").slice(0, 12)}`)
await mkdir(state, { recursive: true })

// Disable VS Code's built-in AI features so Copilot does not activate in the development host.
const userDir = path.join(state, "user")
await mkdir(path.join(userDir, "User"), { recursive: true })
await writeFile(
  path.join(userDir, "User", "settings.json"),
  JSON.stringify({ "chat.disableAIFeatures": true }, null, 2) + "\n",
)

const build = Bun.spawn([process.execPath, path.join(root, "script/build.ts")], { stdout: "inherit", stderr: "inherit" })
if ((await build.exited) !== 0) process.exit(1)

const profile = process.env.KILO_V2_PROFILE ?? path.join(state, "profile")
try {
  if (await reuse({ profile, workspace, script: path.resolve(root, "..", "..", "script", "dev-isolated.ts") }))
    console.log("auth: reusing the installed Kilo CLI login")
} catch (error) {
  console.warn(`auth: could not reuse the Kilo CLI login: ${error instanceof Error ? error.message : String(error)}`)
}

const code = [
  process.env.VSCODE_EXEC_PATH,
  "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
  "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders",
].find((file) => file && existsSync(file)) ?? "code"

console.log(`workspace: ${workspace}\nstate: ${state}`)
// Strip Electron/VS Code variables so the new instance does not attach to the process that started it, for example a
// VS Code task or the extension host terminal.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("ELECTRON_") && !key.startsWith("VSCODE_")),
)
const child = Bun.spawn(
  [
    code,
    "--new-window",
    `--user-data-dir=${userDir}`,
    `--extensions-dir=${path.join(state, "extensions")}`,
    `--extensionDevelopmentPath=${root}`,
    workspace,
  ],
  {
    env: { ...env, KILO_V2_PROFILE: profile },
    stdout: "inherit",
    stderr: "inherit",
  },
)
process.exit(await child.exited)
