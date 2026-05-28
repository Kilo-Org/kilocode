import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"

const script = join(import.meta.dir, "..", "..", "bin", "kilo")

describe("bin/kilo tree-sitter resources", () => {
  async function setup(root: string, nested: boolean) {
    const dir = nested
      ? join(root, "node_modules", "@kilocode", "cli-darwin-arm64", "bin")
      : join(root, "node_modules", "@kilocode", "cli", "bin")
    const wasm = join(dir, "tree-sitter")
    const bin = join(dir, nested ? "kilo" : ".kilo")
    const log = join(root, nested ? "nested-env.txt" : "cached-env.txt")

    await mkdir(wasm, { recursive: true })
    await writeFile(join(wasm, "tree-sitter.wasm"), "wasm")
    await writeFile(bin, "binary")

    return { bin, log, wasm, wrapper: join(dir, "kilo") }
  }

  async function run(root: string, bin: string | undefined, log: string, wrapper?: string) {
    const capture = `
const kiloFs = require("fs")
const kiloChild = require("child_process")
const log = process.argv[1]
const wrapper = process.argv[2]
const realpathSync = kiloFs.realpathSync
kiloFs.realpathSync = (file) => wrapper && file === __filename ? wrapper : realpathSync(file)
kiloChild.spawnSync = () => {
  kiloFs.writeFileSync(log, process.env.KILO_TREE_SITTER_WASM_DIR || "")
  return { status: 0 }
}
`
    const source = (await Bun.file(script).text()).replace(/^#!.*\n/, "")
    return Bun.spawnSync(["node", "--input-type=commonjs", "--eval", capture + source, log, wrapper ?? ""], {
      cwd: root,
      env: {
        PATH: process.env.PATH ?? "",
        ...(bin ? { KILO_BIN_PATH: bin } : {}),
      },
    })
  }

  test("exports co-located tree-sitter WASM dir for optional package binary", async () => {
    const root = await mkdtemp(join(tmpdir(), "kilo-bin-tree-sitter-"))
    try {
      const item = await setup(root, true)
      const proc = await run(root, item.bin, item.log)

      expect(proc.exitCode).toBe(0)
      expect(await Bun.file(item.log).text()).toBe(item.wasm)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("exports co-located tree-sitter WASM dir for cached postinstall binary", async () => {
    const root = await mkdtemp(join(tmpdir(), "kilo-bin-tree-sitter-"))
    try {
      const item = await setup(root, false)
      const proc = await run(root, undefined, item.log, item.wrapper)

      expect(proc.exitCode).toBe(0)
      expect(await Bun.file(item.log).text()).toBe(item.wasm)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
