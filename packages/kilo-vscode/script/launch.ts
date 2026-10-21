// Builds the extension and opens it in a separate VS Code instance: own user data, own extensions, and a server
// profile under `.kilo-dev/` (or `--fresh` for a temporary one). Usage: bun run extension [--fresh] [workspace]
import { existsSync } from "node:fs"
import { mkdir, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const args = Bun.argv.slice(2)
const fresh = args.includes("--fresh")
const workspace = path.resolve(args.find((arg) => !arg.startsWith("--")) ?? process.env.INIT_CWD ?? process.cwd())
const state = fresh ? await mkdtemp(path.join(tmpdir(), "kilo-vscode-v2-")) : path.join(root, ".kilo-dev")
await mkdir(state, { recursive: true })

const build = Bun.spawn([process.execPath, path.join(root, "script/build.ts")], { stdout: "inherit", stderr: "inherit" })
if ((await build.exited) !== 0) process.exit(1)

const code = [
  process.env.VSCODE_EXEC_PATH,
  "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
  "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders",
].find((file) => file && existsSync(file)) ?? "code"

console.log(`workspace: ${workspace}\nstate: ${state}`)
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
    env: { ...process.env, KILO_V2_PROFILE: process.env.KILO_V2_PROFILE ?? path.join(state, "profile") },
    stdout: "inherit",
    stderr: "inherit",
  },
)
process.exit(await child.exited)
