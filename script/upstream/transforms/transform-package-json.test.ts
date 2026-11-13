import { expect, test } from "bun:test"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { repo, type Repo } from "../utils/testing"
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
  type PackageJsonResult,
} from "./transform-package-json"

test("fixScripts preserves Kilo root scripts when the base is unknown", () => {
  const ours = { scripts: { dev: "bun script/dev-isolated.ts", lint: "oxlint", build: "tsc" } }
  const pkg: Record<string, unknown> = {
    scripts: { dev: "bun run script/dev.ts", lint: "oxlint && bun script/sdk-docs.ts", test: "bun test" },
  }
  const changes: string[] = []

  fixScripts(pkg, "package.json", ours, null, changes)

  const scripts = pkg.scripts as Record<string, string>
  expect(scripts.dev).toBe("bun script/dev-isolated.ts")
  expect(scripts.lint).toBe("oxlint")
  expect(scripts.build).toBe("tsc")
  expect(scripts.test).toBe("bun test")
  expect(changes).toEqual([
    "scripts.dev: preserved Kilo change",
    "scripts.lint: preserved Kilo change",
    "scripts.build: preserved Kilo change",
  ])
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

test("fixScripts and fixExports preserve known-base three-way behavior", () => {
  const base = {
    scripts: { same: "base", changed: "base", deleted: "base", conflict: "base", removedUp: "base" },
    exports: {
      "./same": "base",
      "./changed": "base",
      "./deleted": "base",
      "./conflict": "base",
      "./removedUp": "base",
    },
  }
  const ours = {
    scripts: { same: "base", changed: "kilo", conflict: "kilo", removedUp: "base" },
    exports: { "./same": "base", "./changed": "kilo", "./conflict": "kilo", "./removedUp": "base" },
  }
  const pkg: Record<string, unknown> = {
    scripts: { same: "upstream", changed: "base", deleted: "base", conflict: "upstream", extra: "upstream" },
    exports: {
      "./same": "upstream",
      "./changed": "base",
      "./deleted": "base",
      "./conflict": "upstream",
      "./extra": "upstream",
    },
  }
  const changes: string[] = []

  fixScripts(pkg, "packages/cli/package.json", ours, base, changes)
  fixExports(pkg, ours, base, changes)

  expect(pkg.scripts).toEqual({ same: "upstream", changed: "kilo", conflict: "upstream", extra: "upstream" })
  expect(pkg.exports).toEqual({
    "./same": "upstream",
    "./changed": "kilo",
    "./conflict": "upstream",
    "./extra": "upstream",
  })
  expect(changes).toEqual([
    "scripts.changed: preserved Kilo change",
    "scripts.deleted: preserved Kilo removal",
    "exports../changed: preserved Kilo change",
    "exports../deleted: preserved Kilo removal",
  ])
})

test("fixScripts and fixExports treat an empty base as known", () => {
  const ours = {
    scripts: { shared: "kilo", kilo: "kilo" },
    exports: { "./shared": "kilo", "./kilo": "kilo" },
  }
  const pkg: Record<string, unknown> = {
    scripts: { shared: "upstream", upstream: "upstream" },
    exports: { "./shared": "upstream", "./upstream": "upstream" },
  }
  const changes: string[] = []

  fixScripts(pkg, "packages/cli/package.json", ours, {}, changes)
  fixExports(pkg, ours, {}, changes)

  expect(pkg.scripts).toEqual({ shared: "upstream", kilo: "kilo", upstream: "upstream" })
  expect(pkg.exports).toEqual({ "./shared": "upstream", "./kilo": "kilo", "./upstream": "upstream" })
  expect(changes).toEqual(["scripts.kilo: preserved Kilo change", "exports../kilo: preserved Kilo change"])
})

test("fixScripts preserves root exceptions when both sides changed", () => {
  const base = { scripts: { dev: "base", lint: "base", test: "base" } }
  const ours = { scripts: { dev: "kilo", lint: "kilo", test: "kilo" } }
  const pkg: Record<string, unknown> = { scripts: { dev: "upstream", lint: "upstream", test: "upstream" } }
  const changes: string[] = []

  fixScripts(pkg, "package.json", ours, base, changes)

  expect(pkg.scripts).toEqual({ dev: "kilo", lint: "kilo", test: "upstream" })
  expect(changes).toEqual(["scripts.dev: preserved from base", "scripts.lint: preserved from base"])
})

test("fixScripts and fixExports retain upstream-only entries when ours is empty or missing", () => {
  const pkg: Record<string, unknown> = {
    scripts: { build: "bun build" },
    exports: { "./upstream": "./src/upstream.ts" },
  }
  const changes: string[] = []

  fixScripts(pkg, "packages/cli/package.json", { scripts: {} }, null, changes)
  fixExports(pkg, { exports: {} }, null, changes)
  fixScripts(pkg, "packages/cli/package.json", null, null, changes)
  fixExports(pkg, null, null, changes)

  expect(pkg).toEqual({ scripts: { build: "bun build" }, exports: { "./upstream": "./src/upstream.ts" } })
  expect(changes).toEqual([])
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

const manifestPath = "packages/cli/package.json"
const ourManifest = {
  name: "@opencode/cli",
  scripts: { test: "kilo test", "test:ci": "kilo ci", noop: "" },
  exports: { "./*": "./src/*.ts", "./shared": "./src/kilo.ts", "./blocked": null },
}
const upstreamManifest = {
  name: "@opencode/cli",
  scripts: { test: "upstream test", noop: "upstream noop", pack: "upstream pack" },
  exports: { "./shared": "./src/upstream.ts", "./blocked": "./src/blocked.ts", "./new": "./src/new.ts" },
}
const expectedManifest = {
  name: "@opencode/cli",
  scripts: { test: "kilo test", "test:ci": "kilo ci", noop: "", pack: "upstream pack" },
  exports: { "./*": "./src/*.ts", "./shared": "./src/kilo.ts", "./blocked": null, "./new": "./src/new.ts" },
}
const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }

async function invoke<T extends PackageJsonResult | PackageJsonResult[]>(
  r: Repo,
  method: "transformAllPackageJson" | "reconcilePackageJsonFromRefs" | "transformPackageJson",
  args: unknown[],
): Promise<T> {
  const source = [
    `import { ${method} } from ${JSON.stringify(pathToFileURL(path.join(import.meta.dir, "transform-package-json.ts")).href)}`,
    `console.log("TRANSFORM_RESULT:" + JSON.stringify(await ${method}(...${JSON.stringify(args)})))`,
  ].join("\n")
  const child = Bun.spawn([process.execPath, "-e", source], {
    cwd: r.dir,
    env: gitEnv,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (status !== 0) throw new Error(`${stderr}\n${stdout}`)
  const result = stdout.split("\n").find((line) => line.startsWith("TRANSFORM_RESULT:"))
  if (!result) throw new Error(`Missing transform result: ${stderr}\n${stdout}`)
  return JSON.parse(result.slice("TRANSFORM_RESULT:".length)) as T
}

function expectPreserved(result: PackageJsonResult) {
  expect(result.file).toBe(manifestPath)
  expect(result.action).toBe("transformed")
  expect(result.changes).toEqual([
    "scripts.test: preserved Kilo change",
    "scripts.test:ci: preserved Kilo change",
    "scripts.noop: preserved Kilo change",
    "exports../*: preserved Kilo change",
    "exports../shared: preserved Kilo change",
    "exports../blocked: preserved Kilo change",
  ])
}

test("transformAllPackageJson preserves Kilo entries when the base is unknown", async () => {
  await using r = await repo()
  await r.write(manifestPath, JSON.stringify(ourManifest, null, 2) + "\n")
  const oursRef = await r.commit("Kilo manifest")
  await r.git("update-ref", "refs/remotes/origin/v2", oursRef)
  const upstream = JSON.stringify(upstreamManifest, null, 2) + "\n"
  await r.write(manifestPath, upstream)

  const dry = await invoke<PackageJsonResult[]>(r, "transformAllPackageJson", [{ dryRun: true }])
  expect(dry).toHaveLength(1)
  expect(dry[0].dryRun).toBe(true)
  expectPreserved(dry[0])
  expect(await Bun.file(path.join(r.dir, manifestPath)).text()).toBe(upstream)
  expect(JSON.parse(await r.git("show", `:${manifestPath}`))).toEqual(ourManifest)

  const result = await invoke<PackageJsonResult[]>(r, "transformAllPackageJson", [])
  expect(result).toHaveLength(1)
  expect(result[0].dryRun).toBe(false)
  expectPreserved(result[0])
  expect(await Bun.file(path.join(r.dir, manifestPath)).json()).toEqual(expectedManifest)
  expect(JSON.parse(await r.git("show", `:${manifestPath}`))).toEqual(ourManifest)
})

test.each([
  { name: "no merge base", hasBase: false },
  { name: "no manifest at the merge base", hasBase: true },
])("reconcilePackageJsonFromRefs preserves Kilo entries with $name", async (scenario) => {
  await using r = await repo()
  const base = scenario.hasBase ? await r.commit("empty base") : null
  await r.write(manifestPath, JSON.stringify(ourManifest, null, 2) + "\n")
  const oursRef = await r.commit("Kilo manifest")
  await r.git("switch", "-q", ...(base ? ["-c", "upstream", base] : ["--orphan", "upstream"]))
  const upstream = JSON.stringify(upstreamManifest, null, 2) + "\n"
  await r.write(manifestPath, upstream)
  const theirsRef = await r.commit("upstream manifest")
  if (base) {
    expect(await r.git("merge-base", oursRef, theirsRef)).toBe(base)
    await expect(r.git("cat-file", "-e", `${base}:${manifestPath}`)).rejects.toThrow()
  }
  if (!base) await expect(r.git("merge-base", oursRef, theirsRef)).rejects.toThrow()
  const before = await r.git("show", `:${manifestPath}`)

  const dry = await invoke<PackageJsonResult>(r, "reconcilePackageJsonFromRefs", [
    manifestPath,
    { oursRef, theirsRef, dryRun: true },
  ])
  expect(dry.dryRun).toBe(true)
  expectPreserved(dry)
  expect(await Bun.file(path.join(r.dir, manifestPath)).text()).toBe(upstream)
  expect(await r.git("show", `:${manifestPath}`)).toBe(before)

  const result = await invoke<PackageJsonResult>(r, "reconcilePackageJsonFromRefs", [
    manifestPath,
    { oursRef, theirsRef },
  ])
  expect(result.dryRun).toBe(false)
  expectPreserved(result)
  expect(await Bun.file(path.join(r.dir, manifestPath)).json()).toEqual(expectedManifest)
  expect(JSON.parse(await r.git("show", `:${manifestPath}`))).toEqual(expectedManifest)
})

test("transformPackageJson preserves Kilo entries in an add/add conflict", async () => {
  await using r = await repo()
  const base = await r.commit("empty base")
  await r.write(manifestPath, JSON.stringify(ourManifest, null, 2) + "\n")
  await r.commit("Kilo manifest")
  await r.git("switch", "-q", "-c", "upstream", base)
  await r.write(manifestPath, JSON.stringify(upstreamManifest, null, 2) + "\n")
  const theirsRef = await r.commit("upstream manifest")
  await r.git("switch", "-q", "dev")
  await expect(r.git("merge", "--no-commit", "--no-ff", theirsRef)).rejects.toThrow()
  const stages = await r.git("ls-files", "-u", "--", manifestPath)
  expect(stages).not.toContain(` 1\t${manifestPath}`)
  expect(stages).toContain(` 2\t${manifestPath}`)
  expect(stages).toContain(` 3\t${manifestPath}`)
  const before = await Bun.file(path.join(r.dir, manifestPath)).text()

  const dry = await invoke<PackageJsonResult>(r, "transformPackageJson", [manifestPath, { dryRun: true }])
  expect(dry).toEqual({ file: manifestPath, action: "transformed", changes: [], dryRun: true })
  expect(await Bun.file(path.join(r.dir, manifestPath)).text()).toBe(before)
  expect(await r.git("ls-files", "-u", "--", manifestPath)).toBe(stages)

  const result = await invoke<PackageJsonResult>(r, "transformPackageJson", [manifestPath])
  expect(result.dryRun).toBe(false)
  expectPreserved(result)
  expect(await Bun.file(path.join(r.dir, manifestPath)).json()).toEqual(expectedManifest)
  expect(JSON.parse(await r.git("show", `:${manifestPath}`))).toEqual(expectedManifest)
  expect(await r.git("diff", "--name-only", "--diff-filter=U", "--", manifestPath)).toBe("")
})
