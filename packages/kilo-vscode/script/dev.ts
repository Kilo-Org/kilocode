import path from "node:path"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"

const root = path.resolve(import.meta.dir, "..")
const executable =
  process.env.VSCODE_BIN ??
  Bun.which("code") ??
  (process.platform === "darwin" ? "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" : undefined)

if (!executable || !(await Bun.file(executable).exists()))
  throw new Error("VS Code was not found. Add code to PATH or set VSCODE_BIN to its CLI executable.")

const { buildExtension } = await import("./build")
await buildExtension()

// Keep Electron/VS Code IPC paths short and stable for this checkout.
const profile = path.join(
  process.platform === "win32" ? tmpdir() : "/tmp",
  `kilo-vscode-${createHash("sha256").update(root).digest("hex").slice(0, 12)}`,
)
const env = { ...process.env }
for (const key of [
  "ELECTRON_RUN_AS_NODE",
  "NODE_OPTIONS",
  "VSCODE_IPC_HOOK_CLI",
  "VSCODE_PID",
  "VSCODE_CWD",
  "VSCODE_NLS_CONFIG",
  "VSCODE_PORTABLE",
  "VSCODE_APPDATA",
])
  delete env[key]
const child = Bun.spawn(
  [
    executable,
    "--new-window",
    "--skip-welcome",
    "--skip-release-notes",
    `--user-data-dir=${path.join(profile, "user")}`,
    `--extensions-dir=${path.join(profile, "extensions")}`,
    `--extensionDevelopmentPath=${root}`,
    path.resolve(root, "../.."),
  ],
  { env, stdin: "inherit", stdout: "inherit", stderr: "inherit" },
)
process.exit(await child.exited)
