// kilocode_change - new file
import path from "path"
import fs from "fs/promises"
import fsSync from "fs"
import crypto from "crypto"

export namespace TestCli {
  export const ENV = "KILO_TEST_CLI_PATH"

  async function fingerprint(root: string): Promise<string> {
    const hash = crypto.createHash("sha256")
    const repo = path.resolve(root, "../..")
    const pkgs = path.join(repo, "packages")

    const lock = path.join(repo, "bun.lock")
    if (fsSync.existsSync(lock)) {
      const st = fsSync.statSync(lock)
      hash.update("bun.lock").update(String(st.mtimeMs)).update(String(st.size))
    }

    const ignored = new Set(["kilo-vscode", "kilo-jetbrains", "kilo-docs"])
    const entries = fsSync.readdirSync(pkgs, { withFileTypes: true })

    for (const ent of entries) {
      if (!ent.isDirectory() || ignored.has(ent.name)) continue
      const dir = path.join(pkgs, ent.name)
      const targets =
        ent.name === "sdk"
          ? [path.join(dir, "js", "src"), path.join(dir, "js", "package.json")]
          : [path.join(dir, "src"), path.join(dir, "migration"), path.join(dir, "package.json")]

      for (const target of targets) {
        if (!fsSync.existsSync(target)) continue
        const st = fsSync.statSync(target)
        if (st.isDirectory()) {
          const glob = new Bun.Glob("**/*.{ts,tsx,sql,json,txt}")
          for await (const file of glob.scan({ cwd: target })) {
            const p = path.join(target, file)
            const fst = fsSync.statSync(p)
            hash.update(`${ent.name}:${file}`).update(String(fst.mtimeMs)).update(String(fst.size))
          }
        } else {
          hash.update(`${ent.name}:pkg`).update(String(st.mtimeMs)).update(String(st.size))
        }
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
      } catch (err) {
        console.warn("[test-cli] failed to read fingerprint cache:", err)
      }
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
    // Resolve through Bun's ESM-aware lookup: OpenTUI 0.4 no longer exposes a
    // CommonJS entry, and the isolated layout differs across platforms.
    const core = path.dirname(Bun.resolveSync("@opentui/core", root))
    const meta = JSON.parse(await Bun.file(path.join(core, "package.json")).text())
    const scope = path.join(dir, "node_modules/@opentui")
    await fs.mkdir(scope, { recursive: true })
    // Anchor variant lookup to the core package so links stay inside the same install tree.
    const kind = process.platform === "win32" ? "junction" : "dir"
    for (const name of Object.keys(meta.optionalDependencies ?? {})) {
      const target = await (async () => {
        try {
          return path.dirname(Bun.resolveSync(name, core))
        } catch {
          // Optional native variant is not installed for this platform.
          return
        }
      })()
      if (target) {
        const link = path.join(scope, name.replace("@opentui/", ""))
        try {
          await fs.rm(link, { recursive: true, force: true })
          await fs.symlink(target, link, kind)
        } catch (err) {
          console.warn(`[test-cli] failed to link native variant ${name}:`, err)
        }
      }
    }

    if (!targetDir) {
      try {
        const currentHash = await fingerprint(root)
        await fs.writeFile(hashFile, currentHash)
      } catch (err) {
        console.warn("[test-cli] failed to save fingerprint hash:", err)
      }
    }

    return bin
  }
}
