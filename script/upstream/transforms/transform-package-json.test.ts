import { expect, test } from "bun:test"
import {
  assertBunPackageManager,
  fixCatalog,
  fixExports,
  fixPackageManager,
  fixRepository,
  fixScripts,
  fixTrustedDependencies,
  mergeWithNewestVersions,
  preserveWorkspacePackages,
  prunePatchedDependencies,
  selectBunPackageManager,
  transformDependencies,
} from "./transform-package-json"

test("fixScripts preserves Kilo's root dev and lint scripts from base", () => {
  const ours = { scripts: { dev: "bun script/dev-isolated.ts", lint: "oxlint", build: "tsc" } }
  const pkg: Record<string, unknown> = {
    scripts: { dev: "bun run script/dev.ts", lint: "oxlint && bun script/sdk-docs.ts", test: "bun test" },
  }
  const changes: string[] = []

  fixScripts(pkg, "package.json", ours, null, changes)

  const scripts = pkg.scripts as Record<string, string>
  expect(scripts.dev).toBe("bun script/dev-isolated.ts")
  expect(scripts.lint).toBe("oxlint")
  expect(scripts.test).toBe("bun test")
  expect(changes).toEqual(["scripts.dev: preserved from base", "scripts.lint: preserved from base"])
})

test("fixScripts leaves other packages untouched", () => {
  const pkg: Record<string, unknown> = { scripts: { build: "tsc" } }
  const changes: string[] = []
  fixScripts(pkg, "packages/core/package.json", null, null, changes)
  expect((pkg.scripts as Record<string, string>).build).toBe("tsc")
  expect(changes.length).toBe(0)
})

test("fixScripts and fixExports keep Kilo additions and upstream changes", () => {
  const base = {
    scripts: { test: "bun test", typecheck: "tsc -b" },
    exports: { "./run": "./src/run/index.ts" },
  }
  const ours = {
    scripts: { test: "bun test", "test:ci": "bun script/test-ci.ts", typecheck: "tsc -b" },
    exports: { "./*": "./src/*.ts", "./run": "./src/run/index.ts" },
  }
  const pkg: Record<string, unknown> = {
    scripts: { test: "bun test", typecheck: "bun check -b", "typecheck:tsc": "tsc -b" },
    exports: { "./run": "./src/run/index.ts" },
  }
  const changes: string[] = []

  fixScripts(pkg, "packages/cli/package.json", ours, base, changes)
  fixExports(pkg, ours, base, changes)

  expect(pkg.scripts).toEqual({
    test: "bun test",
    "test:ci": "bun script/test-ci.ts",
    typecheck: "bun check -b",
    "typecheck:tsc": "tsc -b",
  })
  expect(pkg.exports).toEqual({ "./run": "./src/run/index.ts", "./*": "./src/*.ts" })
  expect(Object.keys(pkg.exports as Record<string, string>)).toEqual(["./*", "./run"])
  expect(Object.keys(pkg.scripts as Record<string, string>)).toEqual(["test", "test:ci", "typecheck", "typecheck:tsc"])
  expect(changes).toEqual(["scripts.test:ci: preserved Kilo change", "exports../*: preserved Kilo change"])
})

test("fixRepository keeps Kilo metadata only when Kilo changed it from base", () => {
  const ours = { repository: { url: "kilo" }, homepage: "kilo-home", bugs: "kilo-bugs" }
  const base = { repository: { url: "kilo" }, homepage: "upstream-home", bugs: "kilo-bugs" }
  const pkg: Record<string, unknown> = {
    repository: { url: "upstream" },
    homepage: "upstream-home",
    bugs: "upstream-bugs",
  }
  const changes: string[] = []

  fixRepository(pkg, ours, base, changes)

  // repository and bugs equal the base, so upstream wins; homepage differs, so Kilo wins
  expect(pkg.repository).toEqual({ url: "upstream" })
  expect(pkg.homepage).toBe("kilo-home")
  expect(pkg.bugs).toBe("upstream-bugs")
  expect(changes).toEqual(["homepage: preserved Kilo metadata"])
})

test("fixRepository keeps Kilo metadata when the base is unknown", () => {
  const ours = { repository: { url: "kilo" }, homepage: "kilo-home", bugs: "kilo-bugs" }
  const pkg: Record<string, unknown> = {
    repository: { url: "upstream" },
    homepage: "upstream-home",
    bugs: "upstream-bugs",
  }
  const changes: string[] = []

  fixRepository(pkg, ours, null, changes)

  expect(pkg.repository).toEqual({ url: "kilo" })
  expect(pkg.homepage).toBe("kilo-home")
  expect(pkg.bugs).toBe("kilo-bugs")
  expect(changes).toEqual([
    "repository: preserved Kilo metadata",
    "homepage: preserved Kilo metadata",
    "bugs: preserved Kilo metadata",
  ])
})

test("preserveWorkspacePackages keeps Kilo packages only when they differ from base", () => {
  const base = { workspaces: { packages: ["packages/core"] } }
  const oursUnchanged = { workspaces: { packages: ["packages/core"] } }
  const upstream: Record<string, unknown> = { workspaces: { packages: ["packages/core", "packages/app"] } }
  const noChange: string[] = []

  preserveWorkspacePackages(upstream, oursUnchanged, base, "package.json", noChange)

  expect((upstream.workspaces as { packages: string[] }).packages).toEqual(["packages/core", "packages/app"])
  expect(noChange).toEqual([])

  const oursChanged = { workspaces: { packages: ["packages/core", "packages/kilo-x"] } }
  const pkg: Record<string, unknown> = { workspaces: { packages: ["packages/core"] } }
  const changes: string[] = []

  preserveWorkspacePackages(pkg, oursChanged, base, "package.json", changes)

  expect((pkg.workspaces as { packages: string[] }).packages).toEqual(["packages/core", "packages/kilo-x"])
  expect(changes).toEqual(["workspaces.packages: preserved Kilo's workspace configuration"])
})

test("mergeWithNewestVersions preserves an absent dependency section", () => {
  const changes: string[] = []
  expect(mergeWithNewestVersions(undefined, undefined, changes, "peerDependencies")).toBeUndefined()
  expect(changes).toEqual([])
})

test("mergeWithNewestVersions preserves ours' key order so kilo-only deps don't relocate", () => {
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
  expect(Object.keys(result ?? {})).toEqual(["npm-package-arg", "rotating-file-stream", "semver", "zod"])
})

test("mergeWithNewestVersions appends theirs-only keys at the end", () => {
  const ours = { a: "1.0.0", b: "1.0.0" }
  const theirs = { a: "1.0.0", c: "1.0.0" }
  const changes: string[] = []
  const result = mergeWithNewestVersions(ours, theirs, changes, "dependencies")
  expect(Object.keys(result ?? {})).toEqual(["a", "b", "c"])
})

test("transformDependencies leaves names untouched with the v2 empty tables", () => {
  const result = transformDependencies({ "@opencode/core": "workspace:*", zod: "catalog:" })
  expect(result.result).toEqual({ "@opencode/core": "workspace:*", zod: "catalog:" })
  expect(result.changes).toEqual([])
})

test("fixTrustedDependencies and fixCatalog are no-ops with the v2 empty tables", () => {
  const pkg: Record<string, unknown> = {
    trustedDependencies: ["bun-pty"],
    workspaces: { catalog: { "solid-js": "1.9.12" } },
  }
  const changes: string[] = []
  fixTrustedDependencies(pkg, "package.json", changes)
  fixCatalog(pkg, "package.json", changes)
  expect(pkg.trustedDependencies).toEqual(["bun-pty"])
  expect((pkg.workspaces as { catalog: Record<string, string> }).catalog).toEqual({ "solid-js": "1.9.12" })
  expect(changes).toEqual([])
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
  fixPackageManager(pkg, "packages/core/package.json", { packageManager: "bun@1.3.14" }, changes)
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

test("dependency merge follows upstream for values Kilo did not change", () => {
  const changes: string[] = []
  const base = { a: "1.0.0", b: "1.0.0", c: "1.0.0", d: "1.0.0" }
  const ours = { a: "1.0.0", b: "2.0.0", c: "1.0.0", k: "workspace:*" }
  const theirs = { a: "0.9.0", b: "1.0.0", d: "1.0.0" }
  // a: upstream downgrade wins, b: Kilo bump stays, c: upstream removal wins, d: Kilo removal stays, k: Kilo-only stays.
  expect(mergeWithNewestVersions(ours, theirs, changes, "dependencies", base)).toEqual({
    a: "0.9.0",
    b: "2.0.0",
    k: "workspace:*",
  })
})

test("dependency merge takes upstream for values that are not version strings", () => {
  const ours = { x: { y: "1.0.0" } } as unknown as Record<string, string>
  const theirs = { x: { y: "2.0.0" } } as unknown as Record<string, string>
  expect(mergeWithNewestVersions(ours, theirs, [], "overrides")).toEqual(theirs)
})
