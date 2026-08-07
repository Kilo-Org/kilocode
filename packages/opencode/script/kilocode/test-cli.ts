// kilocode_change - new file
import path from "path"
import fs from "fs/promises"
import fsSync from "fs"
import crypto from "crypto"
import { createRequire } from "module"

export namespace TestCli {
  export const ENV = "KILO_TEST_CLI_PATH"

  async function fingerprint(root: string): Promise<string> {
    const hash = crypto.createHash("sha256")
    const targets = [
      path.join(root, "package.json"),
      path.join(root, "src"),
      path.join(root, "migration"),
      path.join(root, "..", "core", "src"),
      path.join(root, "..", "server", "src"),
      path.join(root, "..", "tui", "src"),
      path.join(root, "..", "llm", "src"),
      path.join(root, "..", "protocol", "src"),
      path.join(root, "..", "schema", "src"),
      path.join(root, "..", "plugin", "src"),
      path.join(root, "..", "kilo-memory", "src"),
      path.join(root, "..", "kilo-indexing", "src"),
      path.join(root, "..", "kilo-gateway", "src"),
      path.join(root, "..", "kilo-sandbox", "src"),
      path.join(root, "..", "kilo-telemetry", "src"),
    ]

    for (const target of targets) {
      if (!fsSync.existsSync(target)) continue
      const st = fsSync.statSync(target)
      if (st.isDirectory()) {
        const glob = new Bun.Glob("**/*.{ts,tsx,sql,json}")
        for await (const file of glob.scan({ cwd: target })) {
          const p = path.join(target, file)
          const fileStat = fsSync.statSync(p)
          hash.update(file).update(String(fileStat.mtimeMs)).update(String(fileStat.size))
        }
      } else {
        hash.update(target).update(String(st.mtimeMs)).update(String(st.size))
      }
    }
    return hash.digest("hex")
  }

  export async function build(root: string, targetDir?: string) {
    if (path.resolve(process.cwd()) !== path.resolve(root)) {
      throw new Error(`CLI test bundle must be built from ${root}`)
    }

    const dir = targetDir ?? path.join(root, ".artifacts", "test-cli-cached")
    const out = path.join(dir, "src/storage")
    const bin = path.join(out, "cli.js")
    const hashFile = path.join(dir, ".hash")

    if (!targetDir) {
      const currentHash = await fingerprint(root)
      try {
        if (fsSync.existsSync(bin) && fsSync.existsSync(hashFile)) {
          const storedHash = fsSync.readFileSync(hashFile, "utf8").trim()
          if (storedHash === currentHash) {
            return bin
          }
        }
      } catch {}
    }

    const { createSolidTransformPlugin } = await import("@opentui/solid/bun-plugin")
    const entry = "./src/index.ts"
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

    if (!targetDir) {
      try {
        const currentHash = await fingerprint(root)
        fsSync.writeFileSync(hashFile, currentHash)
      } catch {}
    }

    return bin
  }
}
