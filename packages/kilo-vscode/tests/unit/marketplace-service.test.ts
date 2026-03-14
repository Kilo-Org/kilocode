import { afterEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { MarketplaceService } from "../../src/services/marketplace"
import type { InstallResult, SkillMarketplaceItem } from "../../src/services/marketplace/types"

const item: SkillMarketplaceItem = {
  type: "skill",
  id: "test-skill",
  name: "Test Skill",
  description: "Test skill",
  category: "testing",
  githubUrl: "https://github.com/Kilo-Org/kilocode",
  content: "https://example.com/test-skill.tar.gz",
  displayName: "Test Skill",
  displayCategory: "Testing",
}

const windowMock = vscode.window as unknown as {
  showInformationMessage: (message: string) => Promise<void>
  showTextDocument: (...args: unknown[]) => Promise<unknown>
}

afterEach(() => {
  windowMock.showInformationMessage = async () => {}
  windowMock.showTextDocument = async () => ({})
})

describe("MarketplaceService.install", () => {
  it("does not open the installed file in the editor", async () => {
    const service = new MarketplaceService("/tmp/kilo-marketplace-service")
    const result: InstallResult = {
      success: true,
      slug: item.id,
      filePath: "/tmp/kilo-marketplace-service/SKILL.md",
      line: 4,
    }

    let opened = false
    const notices: string[] = []

    ;(service as unknown as { installer: { install: () => Promise<InstallResult> } }).installer = {
      install: async () => result,
    }
    windowMock.showTextDocument = async () => {
      opened = true
      return {}
    }
    windowMock.showInformationMessage = async (message: string) => {
      notices.push(message)
    }

    const installed = await service.install(item, {}, "/repo")

    expect(installed).toEqual(result)
    expect(opened).toBe(false)
    expect(notices).toEqual(["Successfully installed Test Skill"])
  })
})
