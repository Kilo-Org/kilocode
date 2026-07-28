import { expect, test } from "bun:test"
import {
  assertBunPackageManager,
  fixCatalog,
  fixMetadata,
  fixPackageManager,
  fixRepository,
  fixScripts,
  fixTrustedDependencies,
  mergeWithNewestVersions,
  prunePatchedDependencies,
  selectBunPackageManager,
} from "./transform-package-json"

test("fixScripts preserves Kilo-only root scripts from base", () => {
  const ours = {
    scripts: {
      "dev-setup": "kilo dev-setup",
      postinstall: "bun run --cwd packages/opencode fix-node-pty && bun run script/setup-git.ts",
      extension: "bun --cwd packages/kilo-vscode script/launch.ts",
    },
  }
  const pkg: Record<string, unknown> = {
    scripts: { postinstall: "bun run --cwd packages/opencode fix-node-pty" },
  }
  const changes: string[] = []
  fixScripts(pkg, "package.json", ours, changes)
  const scripts = pkg.scripts as Record<string, string>
  expect(scripts.postinstall).toBe(ours.scripts.postinstall)
  expect(scripts["dev-setup"]).toBe(ours.scripts["dev-setup"])
  expect(scripts.extension).toBe(ours.scripts.extension)
  expect(changes.some((c) => c.includes("postinstall"))).toBe(true)
  expect(changes.some((c) => c.includes("dev-setup"))).toBe(true)
})

test("fixRepository preserves Kilo package links", () => {
  const ours = {
    repository: { url: "https://github.com/Kilo-Org/kilocode.git" },
    homepage: "https://github.com/Kilo-Org/kilocode/tree/main/packages/example",
    bugs: "https://github.com/Kilo-Org/kilocode/issues",
  }
  const pkg: Record<string, unknown> = {
    repository: { url: "https://example.com/upstream.git" },
    homepage: "https://example.com/upstream/packages/example",
    bugs: "https://example.com/upstream/issues",
  }
  const changes: string[] = []

  fixRepository(pkg, ours, changes)

  expect(pkg.repository).toEqual(ours.repository)
  expect(pkg.homepage).toBe(ours.homepage)
  expect(pkg.bugs).toBe(ours.bugs)
  expect(changes).toEqual([
    "repository: preserved Kilo metadata",
    "homepage: preserved Kilo metadata",
    "bugs: preserved Kilo metadata",
  ])
})

test("fixScripts removes upstream-only dead scripts from root", () => {
  const pkg: Record<string, unknown> = {
    scripts: {
      dev: "bun run --cwd packages/opencode src/index.ts",
      "dev:desktop": "bun --cwd packages/desktop-electron dev",
      "dev:web": "bun --cwd packages/app dev",
      "dev:console": "ulimit -n 10240 2>/dev/null; bun run --cwd packages/console/app dev",
    },
  }
  const changes: string[] = []
  fixScripts(pkg, "package.json", null, changes)
  const scripts = pkg.scripts as Record<string, string>
  expect(scripts.dev).toBeDefined()
  expect(scripts["dev:desktop"]).toBeUndefined()
  expect(scripts["dev:web"]).toBeUndefined()
  expect(scripts["dev:console"]).toBeUndefined()
  expect(changes.length).toBe(3)
})

test("fixScripts preserves opencode test scripts", () => {
  const ours = { scripts: { test: "bun test", "test:ci": "bun test --ci" } }
  const pkg: Record<string, unknown> = { scripts: { test: "vitest" } }
  const changes: string[] = []
  fixScripts(pkg, "packages/opencode/package.json", ours, changes)
  const scripts = pkg.scripts as Record<string, string>
  expect(scripts.test).toBe("bun test")
  expect(scripts["test:ci"]).toBe("bun test --ci")
})

test("fixScripts preserves dev:local and shared-package test:ci scripts", () => {
  const junit = "mkdir -p .artifacts/unit && bun test --reporter=junit --reporter-outfile=.artifacts/unit/junit.xml"
  const root: Record<string, unknown> = { scripts: { dev: "bun dev" } }
  const changes: string[] = []
  fixScripts(root, "package.json", { scripts: { "dev:local": "bun run packages/opencode/script/dev-local.ts" } }, changes)
  expect((root.scripts as Record<string, string>)["dev:local"]).toBe("bun run packages/opencode/script/dev-local.ts")

  for (const path of [
    "packages/core/package.json",
    "packages/effect-drizzle-sqlite/package.json",
    "packages/http-recorder/package.json",
    "packages/llm/package.json",
    "packages/tui/package.json",
    "packages/ui/package.json",
  ]) {
    const pkg: Record<string, unknown> = { scripts: { test: "bun test" } }
    fixScripts(pkg, path, { scripts: { "test:ci": junit } }, changes)
    expect((pkg.scripts as Record<string, string>)["test:ci"]).toBe(junit)
  }
})

test("fixTrustedDependencies removes native-build permissions against Kilo policy", () => {
  const pkg: Record<string, unknown> = { trustedDependencies: ["tree-sitter-powershell", "bun-pty"] }
  const changes: string[] = []
  fixTrustedDependencies(pkg, "package.json", changes)
  expect(pkg.trustedDependencies).toEqual(["bun-pty"])
  expect(changes.some((c) => c.includes("tree-sitter-powershell"))).toBe(true)
})

test("prunePatchedDependencies drops superseded and missing-file entries", async () => {
  const ours = {
    patchedDependencies: {
      "pacote@21.5.1": "patches/pacote@21.5.1.patch",
      "keep@1.0.0": import.meta.path,
    },
  }
  const pkg: Record<string, unknown> = {
    patchedDependencies: {
      "pacote@21.5.0": "patches/pacote@21.5.0.patch",
      "gcp-metadata@8.1.2": "patches/__does-not-exist__.patch",
      "unrelated@2.0.0": import.meta.path,
    },
  }
  const changes: string[] = []
  await prunePatchedDependencies(pkg, ours, changes)
  expect(pkg.patchedDependencies).toEqual({ "unrelated@2.0.0": import.meta.path })
  expect(changes.some((c) => c.includes("pacote@21.5.0"))).toBe(true)
  expect(changes.some((c) => c.includes("gcp-metadata@8.1.2"))).toBe(true)
})

test("fixScripts leaves unknown packages untouched", () => {
  const pkg: Record<string, unknown> = { scripts: { build: "tsc" } }
  const changes: string[] = []
  fixScripts(pkg, "packages/some-unknown/package.json", null, changes)
  expect((pkg.scripts as Record<string, string>).build).toBe("tsc")
  expect(changes.length).toBe(0)
})

test("fixCatalog removes upstream-only desktop sentry entries", () => {
  const pkg: Record<string, unknown> = {
    workspaces: {
      catalog: {
        "@sentry/solid": "10.36.0",
        "@sentry/vite-plugin": "4.6.0",
        "solid-js": "1.9.12",
      },
    },
  }
  const changes: string[] = []
  fixCatalog(pkg, "package.json", changes)
  const cat = (pkg.workspaces as { catalog: Record<string, string> }).catalog
  expect(cat["@sentry/solid"]).toBeUndefined()
  expect(cat["@sentry/vite-plugin"]).toBeUndefined()
  expect(cat["solid-js"]).toBe("1.9.12")
  expect(changes.length).toBe(2)
})

test("fixCatalog is a no-op when catalog is absent", () => {
  const pkg: Record<string, unknown> = {}
  const changes: string[] = []
  fixCatalog(pkg, "package.json", changes)
  expect(changes.length).toBe(0)
})

test("fixMetadata preserves opencode publish metadata from base", () => {
  const ours = { keywords: ["cli", "kilo", "opencode"], private: false }
  const pkg: Record<string, unknown> = { keywords: ["opencode"], private: true }
  const changes: string[] = []
  fixMetadata(pkg, "packages/opencode/package.json", ours, changes)
  expect(pkg.keywords).toEqual(ours.keywords)
  expect(pkg.private).toBe(false)
  expect(changes).toContain("keywords: preserved from base")
  expect(changes).toContain("private: preserved from base")
})

test("mergeWithNewestVersions preserves ours' key order so kilo-only deps don't relocate", () => {
  // Regression: when ours has a kilo-only dep in the middle (e.g. rotating-file-stream
  // alphabetically between npm-package-arg and semver) and theirs lacks it, the merge
  // result must keep that key in its original position. Previously this function
  // started from theirs' keys and appended ours-only keys at the end, causing git's
  // textual 3-way merge to produce a duplicate JSON key.
  const ours = {
    "npm-package-arg": "13.0.2",
    "rotating-file-stream": "3.2.9",
    semver: "^7.6.3",
    zod: "catalog:",
  }
  const theirs = {
    "npm-package-arg": "13.0.2",
    semver: "^7.6.3",
    zod: "catalog:",
  }
  const changes: string[] = []
  const result = mergeWithNewestVersions(ours, theirs, changes, "dependencies")
  expect(Object.keys(result)).toEqual(["npm-package-arg", "rotating-file-stream", "semver", "zod"])
})

test("mergeWithNewestVersions appends theirs-only keys at the end", () => {
  const ours = { a: "1.0.0", b: "1.0.0" }
  const theirs = { a: "1.0.0", c: "1.0.0" }
  const changes: string[] = []
  const result = mergeWithNewestVersions(ours, theirs, changes, "dependencies")
  expect(Object.keys(result)).toEqual(["a", "b", "c"])
})

test("selectBunPackageManager keeps the newer Bun version and prefers Kilo on ties", () => {
  expect(selectBunPackageManager("bun@1.3.14", "bun@1.3.13")).toBe("bun@1.3.14")
  expect(selectBunPackageManager("bun@1.3.14", "bun@1.3.15")).toBe("bun@1.3.15")
  expect(selectBunPackageManager("bun@1.3.14+kilo", "bun@1.3.14+upstream")).toBe("bun@1.3.14+kilo")
})

test("selectBunPackageManager preserves valid versions over malformed values", () => {
  expect(selectBunPackageManager("bun@1.3.14", "bun@latest")).toBe("bun@1.3.14")
  expect(selectBunPackageManager("bun@latest", "bun@1.3.15")).toBe("bun@1.3.15")
  expect(selectBunPackageManager("bun@latest", "npm@11.0.0")).toBeUndefined()
})

test("fixPackageManager prevents root Bun downgrades", () => {
  const pkg: Record<string, unknown> = { packageManager: "bun@1.3.13" }
  const ours = { packageManager: "bun@1.3.14" }
  const changes: string[] = []
  fixPackageManager(pkg, "package.json", ours, changes)
  expect(pkg.packageManager).toBe("bun@1.3.14")
  expect(changes).toEqual(["packageManager: bun@1.3.13 -> bun@1.3.14 (preserved Kilo pin)"])
})

test("fixPackageManager restores a valid Kilo pin over malformed upstream", () => {
  const pkg: Record<string, unknown> = { packageManager: "bun@latest" }
  const changes: string[] = []
  fixPackageManager(pkg, "package.json", { packageManager: "bun@1.3.14" }, changes)
  expect(pkg.packageManager).toBe("bun@1.3.14")
  expect(changes).toEqual(["packageManager: bun@latest -> bun@1.3.14 (preserved Kilo pin)"])
})

test("fixPackageManager accepts upstream Bun upgrades", () => {
  const pkg: Record<string, unknown> = { packageManager: "bun@1.3.15" }
  const changes: string[] = []
  fixPackageManager(pkg, "package.json", { packageManager: "bun@1.3.14" }, changes)
  expect(pkg.packageManager).toBe("bun@1.3.15")
  expect(changes).toEqual([])
})

test("fixPackageManager ignores nested package.json files", () => {
  const pkg: Record<string, unknown> = { packageManager: "bun@1.3.13" }
  const changes: string[] = []
  fixPackageManager(pkg, "packages/opencode/package.json", { packageManager: "bun@1.3.14" }, changes)
  expect(pkg.packageManager).toBe("bun@1.3.13")
  expect(changes).toEqual([])
})

test("assertBunPackageManager rejects merged downgrades and invalid values", () => {
  expect(() => assertBunPackageManager("bun@1.3.13", "bun@1.3.14", "bun@1.3.12")).toThrow(
    "Bun packageManager downgrade detected",
  )
  expect(() => assertBunPackageManager("bun@latest", "bun@1.3.14", "bun@1.3.15")).toThrow(
    "Bun packageManager validation failed",
  )
})

test("assertBunPackageManager accepts the newest input or a newer result", () => {
  expect(() => assertBunPackageManager("bun@1.3.15", "bun@1.3.14", "bun@1.3.15")).not.toThrow()
  expect(() => assertBunPackageManager("bun@1.3.16", "bun@1.3.14", "bun@1.3.15")).not.toThrow()
})
