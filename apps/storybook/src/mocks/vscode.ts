// Minimal VSCode API mock for browser environments (Storybook)

const ColorThemeKind = {
	Light: 1,
	Dark: 2,
	HighContrast: 3,
	HighContrastLight: 4,
} as const

const window = {
	get activeColorTheme() {
		try {
			// In browser/Storybook environment, detect theme from DOM
			const themeContainer = document.querySelector("[data-theme]")
			const currentTheme = themeContainer?.getAttribute("data-theme")

			if (currentTheme === "light") {
				return { kind: ColorThemeKind.Light }
			}
		} catch {
			// Fallback on any DOM errors
		}

		// Default to dark theme
		return { kind: ColorThemeKind.Dark }
	},
}

const workspace = {
	getConfiguration: () => ({
		get: (key: string) => {
			if (key === "workbench.colorTheme") {
				try {
					const themeContainer = document.querySelector("[data-theme]")
					const currentTheme = themeContainer?.getAttribute("data-theme")

					if (currentTheme === "light") {
						return "Light+ (default light)"
					}
				} catch {
					// Fallback on any DOM errors
				}

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
