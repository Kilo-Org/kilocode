import path from "path"
import fs from "fs/promises"

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
    return path.join(out, "cli.js")
  }
}
