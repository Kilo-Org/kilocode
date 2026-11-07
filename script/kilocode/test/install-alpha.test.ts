import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { installFiles } from "../install-alpha"

test("installs the executable and its sidecars without overwriting neighboring files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo-alpha-test-"))
  try {
    const source = path.join(root, "archive", "bin")
    const dest = path.join(root, "local", "bin")
    await mkdir(path.join(source, "tree-sitter"), { recursive: true })
    await writeFile(path.join(source, "tree-sitter", "tree-sitter.wasm"), "runtime")
    await writeFile(path.join(source, "kilo-sandbox-mutation-worker.js"), "worker")
    await writeFile(path.join(source, "kilo2"), "executable")
    await mkdir(path.join(dest, "tree-sitter"), { recursive: true })
    await writeFile(path.join(dest, "tree-sitter", "keep"), "unrelated")
    await writeFile(path.join(dest, "kilo-sandbox-mutation-worker.js"), "unrelated")
    await writeFile(path.join(dest, "custom-kilo"), "previous")

    const link = await installFiles(source, dest, "custom-kilo")
    const binary = await realpath(link)
    const release = path.dirname(binary)
    expect(link).toBe(path.join(dest, "custom-kilo"))
    expect(path.basename(binary)).toBe("kilo2")
    expect(await readFile(binary, "utf8")).toBe("executable")
    expect((await stat(binary)).mode & 0o777).toBe(0o755)
    expect(await readFile(path.join(release, "tree-sitter", "tree-sitter.wasm"), "utf8")).toBe("runtime")
    expect(await readFile(path.join(release, "kilo-sandbox-mutation-worker.js"), "utf8")).toBe("worker")
    expect(await readFile(path.join(dest, "tree-sitter", "keep"), "utf8")).toBe("unrelated")
    expect(await readFile(path.join(dest, "kilo-sandbox-mutation-worker.js"), "utf8")).toBe("unrelated")

    await writeFile(path.join(source, "kilo2"), "updated")
    await installFiles(source, dest, "custom-kilo")
    expect(await readFile(link, "utf8")).toBe("updated")
    expect(await readFile(binary, "utf8")).toBe("executable")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a missing executable leaves the existing installation intact", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo-alpha-test-"))
  try {
    const source = path.join(root, "archive", "bin")
    const dest = path.join(root, "local", "bin")
    await mkdir(path.join(source, "tree-sitter"), { recursive: true })
    await mkdir(dest, { recursive: true })
    await writeFile(path.join(dest, "kilo2"), "previous")
    await expect(installFiles(source, dest, "kilo2")).rejects.toThrow("No kilo2 executable found")
    expect(await readFile(path.join(dest, "kilo2"), "utf8")).toBe("previous")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a failed replacement preserves the existing destination", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo-alpha-test-"))
  try {
    const source = path.join(root, "archive", "bin")
    const dest = path.join(root, "local", "bin")
    await mkdir(source, { recursive: true })
    await writeFile(path.join(source, "kilo2"), "executable")
    await mkdir(path.join(dest, "kilo2"), { recursive: true })
    await writeFile(path.join(dest, "kilo2", "keep"), "previous")
    await expect(installFiles(source, dest, "kilo2")).rejects.toThrow()
    expect(await readFile(path.join(dest, "kilo2", "keep"), "utf8")).toBe("previous")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
