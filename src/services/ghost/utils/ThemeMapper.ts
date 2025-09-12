// kilocode_change - new file: Theme mapping utility for VSCode to Shiki theme conversion
import * as vscode from "vscode"

export interface ThemeColors {
	background: string
	foreground: string
	modifiedBackground: string
	border: string
	removedBackground: string
	addedBackground: string
	highlightedBackground: string
}
const VSCODE_TO_SHIKI_THEME_MAP: Record<string, string> = {
	// Dark themes
	"Dark+ (default dark)": "dark-plus",
	"Dark Modern": "dark-plus",
	"Dark (Visual Studio)": "dark-plus",
	"Ayu Dark": "ayu-dark",
	"One Dark Pro": "one-dark-pro",
	"Material Theme Darker": "material-theme-darker",
	"Solarized Dark": "solarized-dark",
	"Gruvbox Dark Hard": "gruvbox-dark-hard",
	"Gruvbox Dark Medium": "gruvbox-dark-medium",
	"Gruvbox Dark Soft": "gruvbox-dark-soft",
	"GitHub Dark": "github-dark",
	"GitHub Dark Default": "github-dark-default",
	"GitHub Dark Dimmed": "github-dark-dimmed",
	"GitHub Dark High Contrast": "github-dark-high-contrast",
	"Everforest Dark": "everforest-dark",
	"Vitesse Dark": "vitesse-dark",
	"Min Dark": "min-dark",
	"Slack Dark": "slack-dark",

	// Light themes
	"Light+ (default light)": "light-plus",
	"Light Modern": "light-plus",
	"Light (Visual Studio)": "light-plus",
	"GitHub Light": "github-light",
	"GitHub Light Default": "github-light",
	"GitHub Light High Contrast": "github-light-high-contrast",
	"Solarized Light": "solarized-light",
	"One Light": "one-light",
	"Material Theme Lighter": "material-theme-lighter",
	"Vitesse Light": "vitesse-light",
	"Min Light": "min-light",
}

export const SUPPORTED_SHIKI_THEMES = [
	// Core VSCode themes
	"dark-plus",
	"light-plus",
	// GitHub themes
	"github-dark",
	"github-dark-default",
	"github-dark-dimmed",
	"github-dark-high-contrast",
	"github-light",
	"github-light-default",
	"github-light-high-contrast",
	// Popular dark themes
	"ayu-dark",
	"one-dark-pro",
	"material-theme-darker",
	"solarized-dark",
	"gruvbox-dark-hard",
	"gruvbox-dark-medium",
	"gruvbox-dark-soft",
	"everforest-dark",
	"vitesse-dark",
	"min-dark",
	"slack-dark",
	// Popular light themes
	"one-light",
	"material-theme-lighter",
	"solarized-light",
	"vitesse-light",
	"min-light",
]

export function getVSCodeThemeName(): string {
	const workbenchConfig = vscode.workspace.getConfiguration()
	return workbenchConfig.get<string>("workbench.colorTheme") ?? "Default Dark Modern"
}

export function getShikiTheme(): string {
	const currentTheme = vscode.window.activeColorTheme
	const isDark = currentTheme.kind === vscode.ColorThemeKind.Dark
	const themeName = getVSCodeThemeName()

	const mappedTheme = VSCODE_TO_SHIKI_THEME_MAP[themeName]
	if (mappedTheme) {
		return mappedTheme
	}

	for (const [vscodeTheme, shikiTheme] of Object.entries(VSCODE_TO_SHIKI_THEME_MAP)) {
		if (themeName.toLowerCase().includes(vscodeTheme.toLowerCase().split(" ")[0])) {
			return shikiTheme
		}
	}

	if (isDark) {
		return "dark-plus"
	} else {
		return "light-plus"
	}
}

export function getThemeColors(): ThemeColors {
	const currentTheme = vscode.window.activeColorTheme
	const isDark = currentTheme?.kind === vscode.ColorThemeKind.Dark

	if (isDark) {
		return {
			background: "#1e1e1e",
			foreground: "#d4d4d4",
			modifiedBackground: "#33333333",
			border: "#3c3c3c",
			removedBackground: "rgba(248, 113, 133, 0.2)",
			addedBackground: "rgba(107, 166, 205, 0.2)",
			highlightedBackground: "#264f78",
		}
	} else {
		return {
			background: "#ffffff",
			foreground: "#24292e",
			modifiedBackground: "#dddddd30",
			border: "#e1e4e8",
			removedBackground: "rgba(248, 113, 133, 0.15)",
			addedBackground: "rgba(107, 166, 205, 0.15)",
			highlightedBackground: "#e7f3ff",
		}
	}
}
