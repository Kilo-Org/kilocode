import { cp, mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { binaryPath } from "@opencode-ai/pty"
import { requireRuntime } from "../src/runtime"

requireRuntime()

const outdir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(import.meta.dir, "../dist")
const native = path.join(outdir, "node_modules/@opencode-ai")
await mkdir(native, { recursive: true })
await cp(path.dirname(fileURLToPath(import.meta.resolve("@opencode-ai/pty/package.json"))), path.join(native, "pty"), {
  recursive: true,
})
if (binaryPath) {
  const directory = path.dirname(path.dirname(binaryPath))
  await cp(directory, path.join(native, path.basename(directory)), { recursive: true })
}
const result = await Bun.build({
  entrypoints: [path.resolve(import.meta.dir, "../src/index.ts")],
  target: "bun",
  plugins: [
    {
      name: "kilo-native-assets",
      setup(build) {
        build.onResolve({ filter: /^@opencode-ai\/pty$/ }, () => ({
          path: path.resolve(import.meta.dir, "../src/native-pty.ts"),
        }))
      },
    },
  ],
  format: "esm",
  minify: true,
  compile: {
    outfile: path.join(outdir, process.platform === "win32" ? "kilo2.exe" : "kilo2"),
    autoloadBunfig: false,
    autoloadDotenv: false,
    autoloadTsconfig: false,
    autoloadPackageJson: false,
  },
})
if (!result.success) throw new AggregateError(result.logs, "Failed to build the internal Kilo preview")
