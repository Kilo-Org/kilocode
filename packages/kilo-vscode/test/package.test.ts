import { expect, test } from "bun:test"
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  findVsceBinary,
  sanitizePackageJson,
  validateVsix,
  packageExtension,
  listVsixEntries,
  readVsixPackageJson,
} from "../script/package"

test("findVsceBinary discovers cached @vscode/vsce binary", () => {
  const vsceBin = findVsceBinary()
  expect(vsceBin).toBeTruthy()
  expect(typeof vsceBin).toBe("string")

  // Verify it executes --version
  const child = Bun.spawnSync([vsceBin, "--version"])
  expect(child.exitCode).toBe(0)
  expect(child.stdout.toString().trim()).toMatch(/^\d+\.\d+\.\d+/)
})

test("sanitizePackageJson strips workspace:* dependencies, devDependencies, and private flag", () => {
  const raw = {
    name: "kilo-code-v2-preview",
    displayName: "Kilo Code (v2 Preview)",
    version: "0.0.1",
    private: true,
    publisher: "kilocode",
    main: "./dist/extension.cjs",
    dependencies: {
      "@kilocode/kilo-ui": "workspace:*",
      "@opencode-ai/client": "workspace:*",
      "@opencode-ai/protocol": "workspace:*",
      "solid-js": "catalog:",
    },
    devDependencies: {
      vite: "8.2.2",
    },
    scripts: {
      build: "bun script/build.ts",
    },
    contributes: {
      commands: [{ command: "kilo-code.new.newTask", title: "New Task" }],
    },
  }

  const sanitized = sanitizePackageJson(raw)
  expect(sanitized.private).toBeUndefined()
  expect(sanitized.devDependencies).toBeUndefined()
  expect(sanitized.scripts).toBeUndefined()
  expect(sanitized.dependencies).toBeUndefined()
  expect(sanitized.main).toBe("./dist/extension.cjs")
  expect(sanitized.name).toBe("kilo-code-v2-preview")
  expect(sanitized.publisher).toBe("kilocode")
  expect(sanitized.contributes).toBeDefined()
})

test("packageExtension generates a complete, self-contained VSIX without workspace:* leaks", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "kilo-vsix-test-"))
  const outVsix = path.join(tmpDir, "kilo-preview-packaged.vsix")

  try {
    const result = await packageExtension({ out: outVsix })

    expect(result.vsixPath).toBe(outVsix)
    expect(result.sizeBytes).toBeGreaterThan(1024 * 1024) // > 1 MB
    expect(result.version).toBe("0.0.1")

    const stat = await lstat(outVsix)
    expect(stat.isFile()).toBe(true)
    expect(stat.size).toBe(result.sizeBytes)

    // Validate archive contents
    const validation = await validateVsix(outVsix)
    expect(validation.valid).toBe(true)
    expect(validation.fileCount).toBeGreaterThan(50)

    const entries = await listVsixEntries(outVsix)

    // Required files
    expect(entries).toContain("extension/package.json")
    expect(entries).toContain("extension/dist/extension.cjs")
    expect(entries).toContain("extension/dist/webview.js")
    expect(entries).toContain("extension/assets/kilo.svg")
    expect(entries).toContain("extension.vsixmanifest")

    expect(entries.some((e) => e.startsWith("extension/dist/web/"))).toBe(false)
    // Excluded files
    expect(entries.some((e) => e.startsWith("extension/src/"))).toBe(false)
    expect(entries.some((e) => e.startsWith("extension/web/"))).toBe(false)
    expect(entries.some((e) => e.startsWith("extension/test/"))).toBe(false)
    expect(entries.some((e) => e.startsWith("extension/script/"))).toBe(false)
    expect(entries.some((e) => e.startsWith("extension/tsconfig"))).toBe(false)
    expect(entries.some((e) => e.startsWith("extension/vite.config"))).toBe(false)

    // Package.json inside VSIX
    const innerPkg = await readVsixPackageJson(outVsix)
    expect(innerPkg.name).toBe("kilo-code-v2-preview")
    expect(innerPkg.main).toBe("./dist/extension.cjs")
    expect(innerPkg.private).toBeUndefined()

    // No workspace:* dependencies leak
    const innerDeps = (innerPkg.dependencies ?? {}) as Record<string, string>
    for (const [dep, ver] of Object.entries(innerDeps)) {
      expect(ver.startsWith("workspace:")).toBe(false)
      expect(ver.startsWith("catalog:")).toBe(false)
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
})
