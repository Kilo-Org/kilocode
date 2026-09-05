import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises"
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
await writeFile(
  path.join(directory, "kilo2"),
  `#!/bin/sh
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
base="$here/../.."
PATH="$here:$PATH"
export PATH
exec "$here/bun" --no-env-file --preload "$base/node_modules/@opentui/solid/scripts/preload.js" "$base/src/tui-preview.ts" "$@"
`,
  { mode: 0o755 },
)
await chmod(path.join(directory, "kilo2"), 0o755)
