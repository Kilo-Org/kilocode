import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { wasmDirectory } from "../src/indexing/tree-sitter"

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5 })))
})

async function layout(files: string[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo-tree-sitter-"))
  dirs.push(root)
  await Promise.all(files.map((file) => Bun.write(path.join(root, file), "")))
  return root
}

test("an explicit KILO_TREE_SITTER_WASM_DIR wins", async () => {
  expect(wasmDirectory("/x/bin/kilo2", { KILO_TREE_SITTER_WASM_DIR: "/grammars" })).toBe("/grammars")
})

test("grammars next to the executable need no override", async () => {
  const root = await layout(["cli-darwin-arm64/bin/kilo2", "cli-darwin-arm64/bin/tree-sitter/tree-sitter.wasm"])
  expect(wasmDirectory(path.join(root, "cli-darwin-arm64/bin/kilo2"), {})).toBeUndefined()
})

test("the launcher finds the grammars of a nested platform package", async () => {
  const root = await layout(["cli/bin/kilo2.exe", "cli/node_modules/@kilocode/cli-linux-x64/bin/tree-sitter/tree-sitter.wasm"])
  expect(wasmDirectory(path.join(root, "cli/bin/kilo2.exe"), {})).toBe(
    path.join(root, "cli/bin/../node_modules/@kilocode/cli-linux-x64/bin/tree-sitter"),
  )
})

test("the launcher finds the grammars of a hoisted platform package", async () => {
  const root = await layout(["@kilocode/cli/bin/kilo2.exe", "@kilocode/cli-linux-x64/bin/tree-sitter/tree-sitter.wasm"])
  await mkdir(path.join(root, "@kilocode/cli/node_modules"), { recursive: true })
  expect(path.resolve(wasmDirectory(path.join(root, "@kilocode/cli/bin/kilo2.exe"), {})!)).toBe(
    path.join(root, "@kilocode/cli-linux-x64/bin/tree-sitter"),
  )
})

test("no grammars anywhere leaves the engine defaults", async () => {
  const root = await layout(["cli/bin/kilo2.exe"])
  expect(wasmDirectory(path.join(root, "cli/bin/kilo2.exe"), {})).toBeUndefined()
})
