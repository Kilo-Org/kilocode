import { chmod, copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises"
import path from "node:path"
import { requireRuntime } from "../src/runtime"

requireRuntime()
if (process.platform === "win32") throw new Error("The source TUI launcher currently targets macOS/Linux")
const acp = Bun.spawn([process.execPath, "--no-env-file", path.join(import.meta.dir, "build-acp.ts")], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})
if ((await acp.exited) !== 0) throw new Error("ACP bridge build failed")
const directory = path.resolve(import.meta.dir, "../dist/interactive")
await mkdir(directory, { recursive: true })
// Rebuilding with the already bundled runtime must not copy that file onto itself.
if (process.execPath !== path.join(directory, "bun")) await copyFile(process.execPath, path.join(directory, "bun"))
await chmod(path.join(directory, "bun"), 0o755)
// Reuse the tested portable bundler so normal launches do not transpile the TUI source tree.
// Publish the launcher only after the new artifact builds successfully.
const buildDirectory = await mkdtemp(path.join(directory, "build-"))
const bundle = Bun.spawn(
  [
    process.execPath,
    "--no-env-file",
    path.join(import.meta.dir, "build-portable.ts"),
    path.join(buildDirectory, "app"),
  ],
  { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
)
if ((await bundle.exited) !== 0) throw new Error("Interactive bundle build failed")
await writeFile(
  path.join(directory, "kilo2"),
  `#!/bin/sh
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
PATH="$here:$PATH"
export PATH
KILO_ACP_ARTIFACT=\${KILO_ACP_ARTIFACT:-"$here/../acp"}
export KILO_ACP_ARTIFACT
exec "$here/${path.basename(buildDirectory)}/app/kilo2" "$@"
`,
  { mode: 0o755 },
)
await chmod(path.join(directory, "kilo2"), 0o755)
