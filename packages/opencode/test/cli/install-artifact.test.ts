// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import os from "os"
import path from "path"

const root = path.join(import.meta.dir, "..", "..")
const wrapper = path.join(root, "bin", "kilo")
const postinstall = path.join(root, "script", "postinstall.mjs")

describe("npm install artifact behavior", () => {
  test("keeps the CLI wrapper contract", async () => {
    const text = await fs.readFile(wrapper, "utf8")
    expect(text.startsWith("#!/usr/bin/env node")).toBe(true)
    expect(text).toContain("const envPath = process.env.KILO_BIN_PATH")
    expect(text).toContain('const base = "@kilocode/cli-" + platform + "-" + arch')
    expect(text).toContain("function findBinary(startDir)")
  })

  test("copies cached binary runtime resources during postinstall", async () => {
    if (process.platform === "win32") return
    const node = Bun.which("node")
    if (!node) {
      console.warn("Skipping postinstall artifact test: node is not available in PATH")
      return
    }

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-postinstall-artifact-"))
    try {
      const pkg = path.join(tmp, "node_modules", "@kilocode", "cli")
      const native = path.join(tmp, "node_modules", "@kilocode", `cli-${process.platform}-${process.arch}`)
      const bin = path.join(native, "bin")
      await fs.mkdir(path.join(pkg, "bin"), { recursive: true })
      await fs.mkdir(path.join(bin, "tree-sitter"), { recursive: true })
      await fs.mkdir(path.join(bin, "console", "assets"), { recursive: true })
      await fs.copyFile(postinstall, path.join(pkg, "postinstall.mjs"))
      await Bun.write(
        path.join(native, "package.json"),
        JSON.stringify({ name: `@kilocode/cli-${process.platform}-${process.arch}` }),
      )
      await Bun.write(path.join(bin, "kilo"), "binary")
      await Bun.write(path.join(bin, "tree-sitter", "tree-sitter.wasm"), "wasm")
      await Bun.write(path.join(bin, "console", "index.html"), "console")
      await Bun.write(path.join(bin, "console", "assets", "app.js"), "asset")

      const proc = Bun.spawn([node, path.join(pkg, "postinstall.mjs")], { cwd: pkg })
      expect(await proc.exited).toBe(0)
      expect(await Bun.file(path.join(pkg, "bin", ".kilo")).text()).toBe("binary")
      expect(await Bun.file(path.join(pkg, "bin", "tree-sitter", "tree-sitter.wasm")).text()).toBe("wasm")
      expect(await Bun.file(path.join(pkg, "bin", "console", "index.html")).text()).toBe("console")
      expect(await Bun.file(path.join(pkg, "bin", "console", "assets", "app.js")).text()).toBe("asset")
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  test("links npm bin commands to the wrapper during local install", async () => {
    const npmPath = Bun.which("npm")
    if (!npmPath) {
      console.warn("Skipping install artifact test: npm is not available in PATH")
      return
    }

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-install-artifact-"))
    try {
      const pkg = path.join(tmp, "pkg")
      const bin = path.join(pkg, "bin")
      const prefix = path.join(tmp, "prefix")
      await fs.mkdir(bin, { recursive: true })
      await fs.mkdir(prefix, { recursive: true })
      await fs.copyFile(wrapper, path.join(bin, "kilo"))
      await Bun.write(
        path.join(pkg, "package.json"),
        JSON.stringify(
          {
            name: "kilo-install-artifact-repro",
            version: "1.0.0",
            bin: {
              kilo: "./bin/kilo",
              kilocode: "./bin/kilo",
            },
          },
          null,
          2,
        ),
      )

      await $`npm install --prefix ${prefix} ${pkg} --no-package-lock --ignore-scripts --no-audit --no-fund`.quiet()

      const commands = ["kilo", "kilocode"]
      for (const name of commands) {
        const link = path.join(prefix, "node_modules", ".bin", name)
        const stat = await fs.lstat(link)
        expect(stat.isSymbolicLink() || stat.isFile()).toBe(true)
      }

      const hidden = path.join(prefix, "node_modules", ".bin", ".kilo")
      const exists = await fs
        .access(hidden)
        .then(() => true)
        .catch(() => false)
      if (!exists) return

      const stat = await fs.lstat(hidden)
      expect(stat.isFile() || stat.isSymbolicLink()).toBe(true)
      if (!stat.isSymbolicLink()) expect(stat.size).toBeGreaterThan(0)
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  }, 60_000) // kilocode_change
})
