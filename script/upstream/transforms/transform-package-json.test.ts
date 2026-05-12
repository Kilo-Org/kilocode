import { expect, test } from "bun:test"
import { fixCatalog, fixScripts, mergeWithNewestVersions } from "./transform-package-json"

test("fixScripts preserves Kilo-only root scripts from base", () => {
  const ours = {
    scripts: {
      "dev-setup": "kilo dev-setup",
      "postinstall": "bun run --cwd packages/opencode fix-node-pty && bun run script/setup-git.ts",
      "extension": "bun --cwd packages/kilo-vscode script/launch.ts",
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

test("fixScripts removes upstream-only dead scripts from root", () => {
  const pkg: Record<string, unknown> = {
    scripts: {
      "dev": "bun run --cwd packages/opencode src/index.ts",
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
