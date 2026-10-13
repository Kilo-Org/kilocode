import { expect, test } from "bun:test"
import { defaultConfig } from "./config"
import { analyzeSync, getRecommendation } from "./report"
import { linkUpstream, repo } from "./testing"

test("recommendations on v2", () => {
  expect(getRecommendation("packages/core/src/kilocode/x.ts").recommendation).toBe("keep-ours")
  expect(getRecommendation("packages/kilo-gateway/src/x.ts").recommendation).toBe("keep-ours")
  expect(getRecommendation(".github/workflows/deploy.yml").recommendation).toBe("workflow")
  expect(getRecommendation("bun.lock").recommendation).toBe("lock-file")
  expect(getRecommendation("packages/ui/package.json").recommendation).toBe("package-transform")
  expect(getRecommendation(".github/workflows/check.yml", defaultConfig, "on: # kilocode_change\n").recommendation).toBe(
    "manual",
  )
  // Branding transforms are off on v2, so an i18n file is a manual conflict.
  expect(getRecommendation("packages/ui/src/i18n/de.ts", defaultConfig, "").recommendation).toBe("manual")
  expect(
    getRecommendation("packages/ui/src/i18n/de.ts", { ...defaultConfig, transforms: { ...defaultConfig.transforms, branding: true } }, "")
      .recommendation,
  ).toBe("i18n-transform")
})

test("analysis lists conflicts, new workflows and shared files touched", async () => {
  await using r = await repo()
  await r.write("src/a.ts", "export const a = 1\n")
  await r.write("src/b.ts", "export const b = 1\n")
  await r.write(".github/workflows/deploy.yml", "name: deploy\n")
  const base = await r.release("v2.0.26", "2026-10-08T00:00:00Z")
  await r.git("switch", "-q", "-c", "v2")
  await r.remove(".github/workflows/deploy.yml")
  await r.write("src/a.ts", "export const a = 3 // kilocode_change\n")
  await r.write("packages/core/src/kilocode/k.ts", "export const k = 1\n")
  await r.commit("feat: kilo")
  await r.git("switch", "-q", "dev")
  await r.write("src/a.ts", "export const a = 2\n")
  await r.write("src/b.ts", "export const b = 2\n")
  await r.write(".github/workflows/deploy.yml", "name: deploy\non: push\n")
  await r.write(".github/workflows/deploy-update.yml", "name: deploy-update\n")
  const target = await r.release("v2.0.27", "2026-10-12T00:00:00Z")
  await linkUpstream(r)

  const cwd = process.cwd()
  process.chdir(r.dir)
  try {
    const result = await analyzeSync("v2", target, base, defaultConfig)
    expect(result.conflicts.map((c) => [c.path, c.kind, c.recommendation])).toEqual([
      [".github/workflows/deploy.yml", "modify/delete", "workflow"],
      ["src/a.ts", "content", "manual"],
    ])
    expect(result.newWorkflows).toEqual([".github/workflows/deploy-update.yml"])
    expect(result.sharedTouched).toEqual([".github/workflows/deploy.yml", "src/a.ts"])
    expect(result.commits).toBe(1)
  } finally {
    process.chdir(cwd)
  }
})
