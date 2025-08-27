import { test, expect, type TestFixtures } from "../tests/playwright-base-test"
import { findWebview } from "../helpers"
import { type Page, type FrameLocator } from "@playwright/test"
import { extractAllCSSVariables, generateCSSOutput, saveVariablesToFile } from "../helpers/css-extraction-helpers"
import { switchToTheme } from "../helpers/vscode-helpers"

const extractVariablesForTheme = async (workbox: Page, webviewFrame: FrameLocator) => {
	const mainWindowVariables = await workbox.evaluate(extractAllCSSVariables)
	const webviewVariables = await webviewFrame.locator("body").evaluate(extractAllCSSVariables)

	const allVariables = { ...webviewVariables, ...mainWindowVariables }

	return {
		mainWindowVariables,
		webviewVariables,
		allVariables,
	}
}

test.describe("CSS Variable Extraction", () => {
	test("should extract CSS variables in both light and dark themes", async ({ workbox }: TestFixtures) => {
		const webviewFrame = await findWebview(workbox)

		await switchToTheme(workbox, "dark")
		const darkResults = await extractVariablesForTheme(workbox, webviewFrame)
		const darkCSSOutput = generateCSSOutput(darkResults.allVariables)
		await saveVariablesToFile(darkCSSOutput, "dark-modern.css")

		await switchToTheme(workbox, "light")
		const lightResults = await extractVariablesForTheme(workbox, webviewFrame)
		const lightCSSOutput = generateCSSOutput(lightResults.allVariables)
		await saveVariablesToFile(lightCSSOutput, "light-modern.css")

		expect(Object.keys(darkResults.allVariables).length).toBeGreaterThan(0)
		expect(Object.keys(lightResults.allVariables).length).toBeGreaterThan(0)
	})
})
