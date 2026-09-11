import * as os from "os"
import * as path from "path"

export const PLAYWRIGHT_OUTPUT_DIR = path.join(os.tmpdir(), "kilo-playwright-mcp")

/**
 * Build the Playwright MCP launch command.
 *
 * Artifacts go to a temp directory outside the workspace so screenshots and
 * traces are never staged in git.
 */
export function playwrightCommand(input: {
  headless: boolean
  useSystemChrome: boolean
  outputDir?: string
}): string[] {
  const command = ["npx", "@playwright/mcp@latest"]
  if (input.headless) command.push("--headless")
  if (input.useSystemChrome) command.push("--browser", "chrome")
  command.push("--output-dir", input.outputDir ?? PLAYWRIGHT_OUTPUT_DIR)
  return command
}
