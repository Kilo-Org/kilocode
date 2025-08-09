import { findWebview } from "../helpers"
import { extractVariablesForTheme, generateCSSOutput, saveVariablesToFile } from "../helpers/css-extraction-helpers"
import { switchToTheme } from "../helpers/vscode-helpers"
import { expect, test, type TestFixtures } from "../tests/playwright-base-test"

test.describe("CSS Variable Extraction", () => {
	test("should extract CSS variables in both light and dark themes", async ({ workbox }: TestFixtures) => {
		const webviewFrame = await findWebview(workbox)

		await switchToTheme(workbox, "dark")
		const darkResults = await extractVariablesForTheme(workbox, webviewFrame)

		await switchToTheme(workbox, "light")
		const lightResults = await extractVariablesForTheme(workbox, webviewFrame)

		expect(Object.keys(darkResults).length).toBeGreaterThan(0)
		expect(Object.keys(lightResults).length).toBeGreaterThan(0)

		const darkCSSOutput = generateCSSOutput(darkResults)
		const lightCSSOutput = generateCSSOutput(lightResults)

		await saveVariablesToFile(darkCSSOutput, "dark-modern.css")
		await saveVariablesToFile(lightCSSOutput, "light-modern.css")
	})
})
