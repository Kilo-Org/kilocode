import { describe, expect, test } from "bun:test"
import { createRequire } from "node:module"

// Both GitLab providers pin zod 3, which has no patched release. The root package.json
// installs zod 4 for them and patches/ rewrites their imports to zod 4's bundled v3 API
// (`zod/v3`). If a patch stops applying, loading the provider or its zod copy changes here.
describe("GitLab providers on zod/v3", () => {
  for (const pkg of ["gitlab-ai-provider", "@gitlab/gitlab-ai-provider"]) {
    test(`${pkg} loads with zod 4 and builds models`, async () => {
      const req = createRequire(Bun.resolveSync(`${pkg}/package.json`, import.meta.dir))
      expect(Number(req("zod/package.json").version.split(".")[0])).toBeGreaterThanOrEqual(4)
      const source = await Bun.file(req.resolve(pkg)).text()
      expect(source).not.toMatch(/require\(["']zod["']\)/)

      const mod = await import(pkg)
      const provider = mod.createGitLab({ apiKey: "test", instanceUrl: "https://gitlab.example.com" })
      const model = provider.agenticChat("duo-chat-sonnet-4-5")
      expect(model.modelId).toBe("duo-chat-sonnet-4-5")
    })
  }
})
