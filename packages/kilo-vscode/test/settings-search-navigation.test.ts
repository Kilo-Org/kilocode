import { describe, expect, test } from "bun:test"
import {
  createSettingsIndex,
  SETTINGS_ENTRIES,
  SETTINGS_TABS,
  searchSettings,
  searchSettingsIndex,
} from "../webview-ui/src/components/settings/settings-search"
import { dict } from "../webview-ui/src/i18n/en"

const translate = (key: string) => (dict as Record<string, string>)[key] ?? key

describe("settings search targets", () => {
  test.each([
    ["default agent", "settings.agentBehaviour.defaultAgent.title", "agents"],
    ["mcp servers", "settings.agentBehaviour.subtab.mcpServers", "mcpServers"],
    ["startup timeout", "settings.agentBehaviour.mcp.timeout.startup.title", "mcpServers"],
    ["rules", "settings.agentBehaviour.subtab.rules", "rules"],
    ["load claude code files", "settings.agentBehaviour.claudeCompat.title", "rules"],
    ["instruction files", "settings.agentBehaviour.instructionFiles", "rules"],
    ["workflows", "settings.agentBehaviour.subtab.workflows", "workflows"],
    ["skills", "settings.agentBehaviour.subtab.skills", "skills"],
    ["discovered skills", "settings.agentBehaviour.discoveredSkills", "skills"],
    ["skill folder paths", "settings.agentBehaviour.skillPaths", "skills"],
    ["skill urls", "settings.agentBehaviour.skillUrls", "skills"],
  ])("routes %s to its subtab", (query, titleKey, subtab) => {
    const result = searchSettings(query, translate).find((item) => item.titleKey === titleKey)
    expect(result).toMatchObject({ tab: "agentBehaviour", subtab, tabOnly: false })
  })

  test.each([
    ["version information", "settings.aboutKiloCode.versionInfo"],
    ["support", "settings.aboutKiloCode.community"],
    ["telemetry", "settings.aboutKiloCode.telemetry.title"],
    ["cli server", "settings.aboutKiloCode.cliServer"],
    ["import", "settings.aboutKiloCode.settingsTransfer.title"],
    ["reset settings", "settings.aboutKiloCode.resetSettings.title"],
  ])("finds the About section for %s", (query, titleKey) => {
    const result = searchSettings(query, translate).find((item) => item.titleKey === titleKey)
    expect(result).toMatchObject({ tab: "aboutKiloCode", tabOnly: false })
  })

  test.each([
    ["commit language", "settings.commitMessage.language.description"],
    ["custom prompt", "settings.commitMessage.override.title"],
  ])("finds the Commit Message row for %s", (query, titleKey) => {
    const result = searchSettings(query, translate).find((item) => item.titleKey === titleKey)
    expect(result).toMatchObject({ tab: "commitMessage", tabOnly: false })
  })

  test("reuses the normalized index for the same results", () => {
    const index = createSettingsIndex(SETTINGS_ENTRIES, SETTINGS_TABS, translate)
    for (const query of ["model", "agent", "mcp servers", "theme", ""]) {
      expect(searchSettingsIndex(index, query)).toEqual(searchSettings(query, translate))
    }
  })

  test("finds the per-conversation prompt history row", () => {
    const result = searchSettings("prompt history", translate).find(
      (item) => item.titleKey === "settings.experimental.conversationPromptHistory.title",
    )
    expect(result).toMatchObject({ tab: "experimental", tabOnly: false })
  })

  test("finds the image generation row", () => {
    const result = searchSettings("image generation", translate).find(
      (item) => item.titleKey === "settings.experimental.imageGeneration.title",
    )
    expect(result).toMatchObject({ tab: "experimental", tabOnly: false })
  })

  test("does not index the image model row that only shows while the feature is on", () => {
    const keys = SETTINGS_ENTRIES.map((entry) => entry.titleKey)
    expect(keys).not.toContain("settings.experimental.imageGenerationModel.title")
  })

  test("finds the auto compaction limit row on the Context tab", () => {
    const result = searchSettings("compaction limit", translate).find(
      (item) => item.titleKey === "settings.context.compactionLimit.title",
    )
    expect(result).toMatchObject({ tab: "context", tabOnly: false })
  })

  test.each([
    ["sound", "settings.notifications.enable.title"],
    ["sounds", "settings.notifications.sounds"],
    ["os notifications", "settings.notifications.os.title"],
    ["vs code notifications", "settings.notifications.workbench.title"],
  ])("finds the Notifications row for %s", (query, titleKey) => {
    const result = searchSettings(query, translate).find((item) => item.titleKey === titleKey)
    expect(result).toMatchObject({ tab: "notifications", tabOnly: false })
  })

  test("does not index agent dialog and editor rows that cannot be revealed", () => {
    const keys = SETTINGS_ENTRIES.map((entry) => entry.titleKey)
    expect(keys).not.toContain("settings.agentBehaviour.removeMcp.title")
    expect(keys).not.toContain("settings.agentBehaviour.modelOverride.title")
    expect(keys).not.toContain("settings.agentBehaviour.removeSkill.title")
  })
})
