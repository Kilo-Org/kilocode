import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import { resolveCoreRuntimeWasmPath, resolveLanguageWasmPath } from "../../../src/tree-sitter/languageParser"

const env = "KILO_TREE_SITTER_WASM_DIR"
const prev = process.env[env]

describe("tree-sitter WASM resolution", () => {
  afterEach(() => {
    if (prev === undefined) delete process.env[env]
    if (prev !== undefined) process.env[env] = prev
  })

  test("prefers installed CLI tree-sitter resources over module resolution", async () => {
    const root = await mkdtemp(join(tmpdir(), "kilo-tree-sitter-wasm-"))
    try {
      const dir = join(root, "bin", "tree-sitter")
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, "tree-sitter.wasm"), "runtime")
      await writeFile(join(dir, "tree-sitter-typescript.wasm"), "language")

      process.env[env] = dir

      expect(resolveCoreRuntimeWasmPath()).toBe(join(dir, "tree-sitter.wasm"))
      expect(resolveLanguageWasmPath("typescript").wasmPath).toBe(join(dir, "tree-sitter-typescript.wasm"))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
