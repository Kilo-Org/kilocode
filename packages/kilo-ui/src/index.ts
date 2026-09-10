//
// @kilocode/kilo-ui
//
// Theme and style override layer for @kilocode/ide-ui that matches the
// visual style of the legacy Kilo Code VS Code extension.
//
// Two themes are provided:
// - kilo:        For web/desktop (light + dark variants from legacy VS Code themes) [DEFAULT]
// - kilo-vscode: For the VS Code extension (adapts to user's VS Code theme)
//
// This package mirrors @kilocode/ide-ui's structure exactly. All component imports
// are re-exported from @kilocode/ide-ui by default, and can be individually overridden
// by replacing the re-export with a custom implementation.

export { KILO_THEMES, kiloTheme, kiloVscodeTheme } from "./theme/default-themes"

export type { DesktopTheme } from "@kilocode/ide-ui/theme/types"
