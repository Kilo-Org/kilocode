// Minimal VSCode API mock for browser environments (Storybook)

const ColorThemeKind = {
	Light: 1,
	Dark: 2,
	HighContrast: 3,
	HighContrastLight: 4,
} as const

const window = {
	activeColorTheme: {
		kind: ColorThemeKind.Dark, // Default to dark theme
	},
}

const workspace = {
	getConfiguration: () => ({
		get: (key: string) => {
			if (key === "workbench.colorTheme") {
				return "Dark+ (default dark)"
			}
			return undefined
		},
	}),
}

// Export everything for both namespace and named imports
export { ColorThemeKind, window, workspace }

// Export everything as default for compatibility
export default {
	ColorThemeKind,
	window,
	workspace,
}
