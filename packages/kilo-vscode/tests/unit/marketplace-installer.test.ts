import { afterEach, describe, expect, it } from "bun:test"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { MarketplaceInstaller } from "../../src/services/marketplace/installer"
import { MarketplacePaths } from "../../src/services/marketplace/paths"
import type { SkillMarketplaceItem } from "../../src/services/marketplace/types"

const item: SkillMarketplaceItem = {
  type: "skill",
  id: "test-skill",
  name: "test-skill",
  description: "Test skill",
  category: "testing",
  githubUrl: "https://github.com/Kilo-Org/kilocode",
  content: "https://example.com/test-skill.tar.gz",
  displayName: "Test Skill",
  displayCategory: "Testing",
}

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true })
    }),
  )
})

describe("MarketplaceInstaller.installSkill", () => {
  it("rejects reinstalling an existing skill before downloading anything", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-marketplace-installer-"))
    dirs.push(workspace)

    const paths = new MarketplacePaths()
    const installer = new MarketplaceInstaller(paths)
    const dir = path.join(paths.skillsDir("project", workspace), item.id)

    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, "SKILL.md"), "# Installed\n", "utf-8")

    const calls: string[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (url: string | URL | Request) => {
      calls.push(String(url))
      throw new Error("fetch should not run")
    }) as typeof fetch

    try {
      const result = await installer.installSkill(item, "project", workspace)

      expect(result).toEqual({
        success: false,
        slug: item.id,
        error: "Skill already installed. Uninstall it before installing again.",
      })
      expect(calls).toEqual([])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
