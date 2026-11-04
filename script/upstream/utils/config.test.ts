import { expect, test } from "bun:test"
import { defaultConfig, resolveBaseBranch } from "./config"
import { isKiloOwned } from "./owned"

test("resolves HEAD to the current branch", () => {
  expect(resolveBaseBranch("HEAD", "session/agent-123")).toBe("session/agent-123")
})

test("keeps explicit base branch names", () => {
  expect(resolveBaseBranch("v2", "session/agent-123")).toBe("v2")
  expect(resolveBaseBranch(undefined, "session/agent-123")).toBeUndefined()
})

test("rejects HEAD when detached", () => {
  expect(() => resolveBaseBranch("HEAD", "HEAD")).toThrow("--base-branch HEAD requires a named branch")
})

test("v2 defaults: base v2, source upstream/dev, renames and branding off", () => {
  expect(defaultConfig.baseBranch).toBe("v2")
  expect(defaultConfig.upstreamBranch).toBe("dev")
  expect(defaultConfig.transforms).toEqual({ packageNames: false, branding: false, versions: false })
  expect(defaultConfig.tagPattern.test("v2.0.27")).toBe(true)
  expect(defaultConfig.tagPattern.test("v1.19.0")).toBe(false)
})

test("Kilo-owned paths", () => {
  for (const file of [
    "packages/kilo-gateway/src/index.ts",
    "packages/core/src/kilocode/a.ts",
    "packages/cli/test/kilocode/a.test.ts",
    ".kilo/skills/x/SKILL.md",
    "migration-tracking/plan.md",
    "script/upstream/merge.ts",
    "script/check-workflows.ts",
    "script/dev-isolated.ts",
    ".github/workflows/kilo-v2.yml",
  ])
    expect(isKiloOwned(file)).toBe(true)
  for (const file of ["packages/core/src/index.ts", "script/version.ts", ".github/workflows/check.yml", "package.json"])
    expect(isKiloOwned(file)).toBe(false)
  // A path that exists upstream is shared, even when it matches a Kilo pattern.
  expect(isKiloOwned("script/check-foo.ts", new Set(["script/check-foo.ts"]))).toBe(false)
})
