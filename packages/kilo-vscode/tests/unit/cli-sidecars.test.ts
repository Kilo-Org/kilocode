import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { copyCliSidecarAssets } from "../../script/cli-sidecars"

let tmp: string | undefined

afterEach(() => {
  if (tmp) {
    rmSync(tmp, { recursive: true, force: true })
    tmp = undefined
  }
})

function setup() {
  tmp = mkdtempSync(join(tmpdir(), "kilo-cli-sidecars-"))
  const sourceBin = join(tmp, "source", "bin")
  const targetBin = join(tmp, "target", "bin")
  mkdirSync(join(sourceBin, "tree-sitter"), { recursive: true })
  mkdirSync(targetBin, { recursive: true })
  const binary = join(sourceBin, process.platform === "win32" ? "kilo.exe" : "kilo")
  writeFileSync(binary, "binary")
  writeFileSync(join(sourceBin, "tree-sitter", "tree-sitter.wasm"), "runtime")
  writeFileSync(join(sourceBin, "tree-sitter", "tree-sitter-typescript.wasm"), "language")
  return { binary, targetBin }
}

describe("copyCliSidecarAssets", () => {
  it("copies tree-sitter WASM assets next to the VS Code CLI binary", () => {
    const { binary, targetBin } = setup()

    expect(copyCliSidecarAssets(binary, targetBin)).toBe(true)

    expect(readFileSync(join(targetBin, "tree-sitter", "tree-sitter.wasm"), "utf8")).toBe("runtime")
    expect(readFileSync(join(targetBin, "tree-sitter", "tree-sitter-typescript.wasm"), "utf8")).toBe("language")
  })

  it("reports missing sidecar assets without creating an empty target directory", () => {
    tmp = mkdtempSync(join(tmpdir(), "kilo-cli-sidecars-"))
    const sourceBin = join(tmp, "source", "bin")
    const targetBin = join(tmp, "target", "bin")
    mkdirSync(sourceBin, { recursive: true })
    mkdirSync(targetBin, { recursive: true })
    const binary = join(sourceBin, "kilo")
    writeFileSync(binary, "binary")

    expect(copyCliSidecarAssets(binary, targetBin)).toBe(false)
    expect(existsSync(join(targetBin, "tree-sitter"))).toBe(false)
  })
})
