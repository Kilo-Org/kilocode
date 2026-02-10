// kilocode_change - new file
import type { DesktopTheme } from "@opencode-ai/ui/theme/types"
import { DEFAULT_THEMES as UPSTREAM_THEMES } from "@opencode-ai/ui/theme/default-themes"
import kiloJson from "./themes/kilo.json"
import kiloVscodeJson from "./themes/kilo-vscode.json"

// Re-export all upstream theme constants
export {
  oc1Theme,
  tokyonightTheme,
  draculaTheme,
  monokaiTheme,
  solarizedTheme,
  nordTheme,
  catppuccinTheme,
  ayuTheme,
  oneDarkProTheme,
  shadesOfPurpleTheme,
  nightowlTheme,
  vesperTheme,
  carbonfoxTheme,
  gruvboxTheme,
  auraTheme,
} from "@opencode-ai/ui/theme/default-themes"

export const kiloTheme = kiloJson as DesktopTheme
export const kiloVscodeTheme = kiloVscodeJson as DesktopTheme

export const KILO_THEMES: Record<string, DesktopTheme> = {
  kilo: kiloTheme,
  "kilo-vscode": kiloVscodeTheme,
}

// Override DEFAULT_THEMES: Kilo themes first, then upstream
export const DEFAULT_THEMES: Record<string, DesktopTheme> = {
  ...KILO_THEMES,
  ...UPSTREAM_THEMES,
}
