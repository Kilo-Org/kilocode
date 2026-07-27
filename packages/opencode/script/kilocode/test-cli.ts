import path from "path"
import fs from "fs/promises"
import { createRequire } from "module"

export namespace TestCli {
  export const ENV = "KILO_TEST_CLI_PATH"

  export async function build(root: string, dir: string) {
    if (path.resolve(process.cwd()) !== path.resolve(root)) {
      throw new Error(`CLI test bundle must be built from ${root}`)
    }
    const { createSolidTransformPlugin } = await import("@opentui/solid/bun-plugin")
    const entry = "./src/index.ts"
    const out = path.join(dir, "src/storage")
    const result = await Bun.build({
      entrypoints: [entry],
      outdir: out,
      target: "bun",
      format: "esm",
      conditions: ["browser"],
      plugins: [createSolidTransformPlugin()],
      // Keep the native TUI variants dynamic and the memory package singleton shared.
      external: ["node-gyp", "@opentui/core-*", "@kilocode/kilo-memory", "@kilocode/kilo-memory/*"],
      naming: { entry: "cli.js", asset: "[name]-[hash].[ext]" },
    })
    if (!result.success) throw new AggregateError(result.logs, "Failed to build CLI subprocess test bundle")
    await fs.cp(path.join(root, "migration"), path.join(dir, "migration"), { recursive: true })
    // Resolve through Node's lookup from the package root: Bun's isolated layout does not
    // materialize package-level node_modules on every platform (e.g. the Windows runners).
    const req = createRequire(path.join(root, "package.json"))
    const core = path.dirname(req.resolve("@opentui/core"))
    const meta = JSON.parse(await Bun.file(path.join(core, "package.json")).text())
    const scope = path.join(dir, "node_modules/@opentui")
    await fs.mkdir(scope, { recursive: true })
    // Anchor variant lookup to the core package so links stay inside the same install tree.
    const deps = createRequire(path.join(core, "package.json"))
    const kind = process.platform === "win32" ? "junction" : "dir"
    for (const name of Object.keys(meta.optionalDependencies ?? {})) {
      const target = await (async () => {
        try {
          return path.dirname(deps.resolve(name))
        } catch {
          // Optional native variant is not installed for this platform.
          return
        }
      })()
      if (target) await fs.symlink(target, path.join(scope, name.replace("@opentui/", "")), kind)
    }
    return path.join(out, "cli.js")
  }
}
