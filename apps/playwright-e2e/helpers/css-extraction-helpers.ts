import * as fs from "fs"
import * as path from "path"

export const extractAllCSSVariables = (): Record<string, string> => {
	const variables: Record<string, string> = {}

	// There are too many of these and we don't need them
	const isExcludedVariable = (property: string): boolean => {
		return property.includes("-icon-") && (property.includes("-content") || property.includes("-font-family"))
	}

	const extractFromStyleRule = (style: CSSStyleDeclaration): void => {
		for (let i = 0; i < style.length; i++) {
			const property = style[i]
			if (property.startsWith("--") && !isExcludedVariable(property)) {
				const value = style.getPropertyValue(property).trim()
				if (value) {
					variables[property] = value
				}
			}
		}
	}

	const extractFromStylesheets = (): void => {
		for (let i = 0; i < document.styleSheets.length; i++) {
			const sheet = document.styleSheets[i]
			try {
				const rules = sheet.cssRules || []
				for (const rule of Array.from(rules)) {
					if (rule instanceof CSSStyleRule) {
						extractFromStyleRule(rule.style)
					}
				}
			} catch (_e) {
				// Skip inaccessible stylesheets
			}
		}
	}

	const extractFromComputedStyles = (): void => {
		const rootStyles = getComputedStyle(document.documentElement)
		for (let i = 0; i < rootStyles.length; i++) {
			const property = rootStyles[i]
			if (property.startsWith("--") && !isExcludedVariable(property)) {
				const value = rootStyles.getPropertyValue(property).trim()
				if (value && !variables[property]) {
					variables[property] = value
				}
			}
		}
	}

	extractFromStylesheets()
	extractFromComputedStyles()

	return variables
}

export const generateCSSOutput = (allVariables: Record<string, string>): string => {
	const sortedEntries = Object.entries(allVariables).sort(([a], [b]) => a.localeCompare(b))
	const cssLines = sortedEntries.map(([key, value]) => `${key}: ${value};`)

	return `/* All CSS Variables - Auto-extracted from VS Code via Playwright */
/* Generated on ${new Date().toISOString()} */

${cssLines.map((line) => `  ${line}`).join("\n")}
`
}

export const saveVariablesToFile = async (cssOutput: string, finalFilename: string): Promise<string> => {
	const outputDir = path.join(process.cwd(), "../storybook/generated-theme-styles")
	await fs.promises.mkdir(outputDir, { recursive: true })
	const outputPath = path.join(outputDir, finalFilename)
	await fs.promises.writeFile(outputPath, cssOutput)
	return outputPath
}

