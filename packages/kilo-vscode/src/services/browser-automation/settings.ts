import * as os from "os"
import * as path from "path"

export const PLAYWRIGHT_OUTPUT_DIR = path.join(os.tmpdir(), "kilo-playwright-mcp")

/**
 * Build the Playwright MCP launch command.
 *
 * Default artifacts go outside the workspace. Explicit screenshot paths can
 * bypass this directory, so this is not a guarantee against staging artifacts.
 */
export function playwrightCommand(input: { headless: boolean; useSystemChrome: boolean; userDataDir?: string }): string[] {
  const command = ["npx", "@playwright/mcp@latest"]
  if (input.headless) command.push("--headless")
  if (input.useSystemChrome) command.push("--browser", "chrome")
  if (input.userDataDir) command.push("--user-data-dir", input.userDataDir)
  command.push("--output-dir", PLAYWRIGHT_OUTPUT_DIR)
  return command
}
