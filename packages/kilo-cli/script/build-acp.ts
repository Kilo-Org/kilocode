import { chmod, copyFile, mkdir } from "node:fs/promises"
import path from "node:path"
import manifest from "../package.json"
import { requireRuntime } from "../src/runtime"

requireRuntime()
const outdir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(import.meta.dir, "../dist/acp")
// Build-time source path into the wrapped CLI package. Nothing resolves this at
// runtime, so the bridge needs no new package export and no private import.
const entrypoint = path.resolve(import.meta.dir, "../../cli/src/kilocode/acp.ts")
if (!(await Bun.file(entrypoint).exists())) throw new Error(`Missing the Kilo ACP bridge entrypoint: ${entrypoint}`)
await mkdir(outdir, { recursive: true })
const result = await Bun.build({
  entrypoints: [entrypoint],
  target: "bun",
  format: "esm",
  minify: true,
  outdir,
  define: { OPENCODE_VERSION: JSON.stringify(manifest.version) },
})
if (!result.success) throw new AggregateError(result.logs, "Failed to build the Kilo ACP bridge")
// The artifact carries its own runtime: a compiled kilo2's execPath is the kilo2
// binary, not Bun, so the launcher cannot borrow the caller's interpreter.
const runtime = path.join(outdir, process.platform === "win32" ? "bun.exe" : "bun")
if (process.execPath !== runtime) await copyFile(process.execPath, runtime)
if (process.platform !== "win32") await chmod(runtime, 0o755)
