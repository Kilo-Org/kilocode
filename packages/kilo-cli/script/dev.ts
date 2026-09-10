import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(import.meta.dir, "..")
const runtime = Bun.semver.satisfies(Bun.version, ">=1.4.0")
  ? process.execPath
  : path.join(root, "dist/interactive/bun")

if (!(await Bun.file(runtime).exists()))
  throw new Error("Kilo CLI requires Bun 1.4.0 or newer, or the runtime in packages/kilo-cli/dist/interactive/bun.")

const child = Bun.spawn(
  [
    runtime,
    "--no-env-file",
    "--preload",
    fileURLToPath(import.meta.resolve("@opentui/solid/preload")),
    path.join(root, "src/tui-preview.ts"),
    ...process.argv.slice(2),
  ],
  { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
)
process.once("SIGINT", () => child.kill("SIGINT"))
process.once("SIGTERM", () => child.kill("SIGTERM"))
process.exit(await child.exited)
