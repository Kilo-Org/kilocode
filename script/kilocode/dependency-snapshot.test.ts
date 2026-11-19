import { describe, expect, test } from "bun:test"
import path from "node:path"
import { graph, snapshot } from "./dependency-snapshot"
import { entry, load, purl, type Lock } from "./sbom/lock"

const lock: Lock = {
  lockfileVersion: 1,
  workspaces: {
    "": { name: "root", devDependencies: { lint: "1.0.0" } },
    "packages/app": {
      name: "app",
      dependencies: { lib: "workspace:*", "@scope/http": "^2.0.0", sheet: "https://example.com/sheet.tgz" },
      devDependencies: { lint: "1.0.0", shared: "1.0.0" },
      peerDependencies: { missing: "*" },
    },
    "packages/lib": { name: "lib", dependencies: { shared: "1.0.0", qs: "^6.0.0" } },
  },
  packages: {
    app: ["app@workspace:packages/app"],
    lib: ["lib@workspace:packages/lib"],
    "@scope/http": ["@scope/http@2.1.0", "", { dependencies: { qs: "^6.14.0" } }, "sha512-a"],
    "@scope/http/qs": ["qs@6.14.1", "", {}, "sha512-b"],
    // Nested under the workspace name: `lib` resolves its own copy of qs.
    "lib/qs": ["qs@6.5.0", "", {}, "sha512-c"],
    qs: ["qs@6.10.0", "", {}, "sha512-d"],
    shared: ["shared@1.0.0", "", {}, "sha512-e"],
    lint: ["lint@1.0.0", "", { dependencies: { chalk: "^5.0.0" } }, "sha512-f"],
    chalk: ["chalk@5.3.0", "", {}, "sha512-g"],
    sheet: ["sheet@https://example.com/sheet.tgz", { dependencies: { cfb: "^1.0.0" } }],
    // Only reachable through the tarball package above.
    cfb: ["cfb@1.2.2", "", {}, "sha512-h"],
  },
}

describe("dependency-snapshot graph", () => {
  const result = graph(lock)
  const node = (name: string, version: string) => result.nodes.get(purl(name, version))

  test("resolves nested copies, including ones nested under a workspace name", () => {
    expect(node("qs", "6.14.1")?.relationship).toBe("indirect")
    expect(node("qs", "6.5.0")?.relationship).toBe("direct")
    // Hoisted qs is not used by anyone once both dependents have nested copies.
    expect(node("qs", "6.10.0")).toBeUndefined()
  })

  test("marks packages declared by any workspace as direct", () => {
    expect(node("@scope/http", "2.1.0")?.relationship).toBe("direct")
    expect(node("lint", "1.0.0")?.relationship).toBe("direct")
    expect(node("chalk", "5.3.0")?.relationship).toBe("indirect")
  })

  test("a package used at runtime anywhere stays runtime even if another workspace has it as a dev dependency", () => {
    expect(node("shared", "1.0.0")?.scope).toBe("runtime")
    expect(node("lint", "1.0.0")?.scope).toBe("development")
    expect(node("chalk", "5.3.0")?.scope).toBe("development")
  })

  test("records dependency edges by purl", () => {
    expect([...(node("@scope/http", "2.1.0")?.dependencies ?? [])]).toEqual(["pkg:npm/qs@6.14.1"])
    expect([...(node("lint", "1.0.0")?.dependencies ?? [])]).toEqual(["pkg:npm/chalk@5.3.0"])
  })

  test("skips workspace links and reports non-registry packages", () => {
    expect([...result.nodes.keys()].some((key) => key.includes("workspace"))).toBe(false)
    expect(result.skipped).toEqual(["sheet@https://example.com/sheet.tgz"])
  })

  test("still walks the dependencies of a non-registry package", () => {
    expect(node("cfb", "1.2.2")).toMatchObject({ relationship: "indirect", scope: "runtime" })
  })
})

describe("dependency-snapshot snapshot", () => {
  test("builds a dependency submission body under one bun.lock manifest", () => {
    const result = snapshot({
      lock,
      sha: "a".repeat(40),
      ref: "refs/heads/main",
      correlator: "deps-bun-lock",
      id: "42",
      url: "https://github.com/o/r/actions/runs/42",
      scanned: "2026-01-01T00:00:00.000Z",
    })
    expect(result.body.sha).toBe("a".repeat(40))
    expect(result.body.job).toEqual({
      correlator: "deps-bun-lock",
      id: "42",
      html_url: "https://github.com/o/r/actions/runs/42",
    })
    const manifest = result.body.manifests["bun.lock"]
    expect(manifest.file.source_location).toBe("bun.lock")
    expect(manifest.resolved["pkg:npm/%40scope/http@2.1.0"]).toEqual({
      package_url: "pkg:npm/%40scope/http@2.1.0",
      relationship: "direct",
      scope: "runtime",
      dependencies: ["pkg:npm/qs@6.14.1"],
    })
  })

  test("covers every registry package in the repository bun.lock", async () => {
    const real = await load(path.join(import.meta.dir, "..", "..", "bun.lock"))
    const expected = new Set(
      Object.keys(real.packages)
        .map((key) => entry(real, key))
        .filter((item) => item?.kind === "npm")
        .map((item) => purl(item!.name, item!.version)),
    )
    const result = graph(real)
    expect([...expected].filter((id) => !result.nodes.has(id))).toEqual([])
  })
})
