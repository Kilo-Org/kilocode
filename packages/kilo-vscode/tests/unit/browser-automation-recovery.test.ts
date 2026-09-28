import { describe, expect, it } from "bun:test"
import { PLAYWRIGHT_OUTPUT_DIR, playwrightCommand } from "../../src/services/browser-automation/settings"

describe("Playwright MCP command", () => {
  it("uses system Chrome and a temp output directory by default", () => {
    expect(playwrightCommand({ headless: false, useSystemChrome: true })).toEqual([
      "npx",
      "@playwright/mcp@latest",
      "--browser",
      "chrome",
      "--output-dir",
      PLAYWRIGHT_OUTPUT_DIR,
    ])
  })

  it("adds headless and drops the Chrome channel", () => {
    expect(playwrightCommand({ headless: true, useSystemChrome: false })).toEqual([
      "npx",
      "@playwright/mcp@latest",
      "--headless",
      "--output-dir",
      PLAYWRIGHT_OUTPUT_DIR,
    ])
  })

  it("keeps artifacts outside the workspace", () => {
    const command = playwrightCommand({ headless: false, useSystemChrome: false })
    const index = command.indexOf("--output-dir")
    expect(command.at(index + 1)).not.toContain(process.cwd())
  })
})
