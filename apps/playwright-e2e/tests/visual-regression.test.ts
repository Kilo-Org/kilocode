import { test, expect } from "./playwright-base-test"
import {
	verifyExtensionInstalled,
	waitForWebviewText,
	findWebview,
	configureApiKeyThroughUI,
} from "../helpers/webview-helpers"

test.describe("Kilo Code Visual Regression", () => {
	test("capture extension installation and initial state", async ({ workbox: page, takeScreenshot }) => {
		// Wait for VS Code to be fully loaded
		await expect(page.locator(".monaco-workbench")).toBeVisible()
		await page.waitForTimeout(2000) // Allow UI to settle

		// Capture initial VS Code state with extension loaded
		await takeScreenshot("vscode-with-extension-loaded")

		// Verify and capture extension in activity bar
		await verifyExtensionInstalled(page)
		const activityBarIcon = page.locator('[aria-label*="Kilo"], [title*="Kilo"]').first()
		await expect(activityBarIcon).toBeVisible()
		await takeScreenshot("extension-activity-bar-icon")

		// Click on the extension icon to open the webview
		await activityBarIcon.click()
		await page.waitForTimeout(1000)
		await takeScreenshot("extension-webview-opening")
	})

	test("capture welcome screen and onboarding flow", async ({ workbox: page, takeScreenshot }) => {
		await verifyExtensionInstalled(page)

		// Open the extension webview
		const activityBarIcon = page.locator('[aria-label*="Kilo"], [title*="Kilo"]').first()
		await activityBarIcon.click()
		await page.waitForTimeout(1000)

		// Wait for welcome message and capture
		await waitForWebviewText(page, "Welcome to Kilo Code!")
		await takeScreenshot("welcome-screen")

		// Capture the webview frame specifically
		const webviewFrame = await findWebview(page)
		// Wait for webview content to be ready instead of just body visibility
		await expect(webviewFrame.locator("body")).toBeAttached()
		await page.waitForTimeout(1000) // Allow webview to fully render
		await takeScreenshot("webview-welcome-content")

		// Look for the "Use your own API key" button
		const useOwnKeyButton = webviewFrame.locator('button:has-text("Use your own API key")')
		await expect(useOwnKeyButton).toBeVisible()
		await takeScreenshot("api-key-setup-button")
	})

	test("capture API configuration flow", async ({ workbox: page, takeScreenshot }) => {
		await verifyExtensionInstalled(page)

		// Open extension and wait for welcome
		const activityBarIcon = page.locator('[aria-label*="Kilo"], [title*="Kilo"]').first()
		await activityBarIcon.click()
		await waitForWebviewText(page, "Welcome to Kilo Code!")

		const webviewFrame = await findWebview(page)

		// Click "Use your own API key" button
		const useOwnKeyButton = webviewFrame.locator('button:has-text("Use your own API key")')
		await useOwnKeyButton.click()
		await page.waitForTimeout(1000)
		await takeScreenshot("api-configuration-dialog")

		// Capture provider selection dropdown
		const providerDropdown = webviewFrame.locator('[role="combobox"]').first()
		await expect(providerDropdown).toBeVisible()
		await takeScreenshot("provider-selection-dropdown")

		// Open dropdown to show options
		await providerDropdown.click()
		await page.waitForTimeout(500)
		await takeScreenshot("provider-dropdown-opened")

		// Select OpenRouter
		const openRouterOption = webviewFrame.locator('[role="option"]:has-text("OpenRouter")')
		await openRouterOption.click()
		await page.waitForTimeout(500)
		await takeScreenshot("openrouter-selected")

		// Capture API key input field
		const apiKeyInput = webviewFrame.locator('input[type="password"]').first()
		await expect(apiKeyInput).toBeVisible()
		await takeScreenshot("api-key-input-field")
	})

	test("capture configured extension and chat interface", async ({ workbox: page, takeScreenshot }) => {
		await verifyExtensionInstalled(page)

		// Open extension
		const activityBarIcon = page.locator('[aria-label*="Kilo"], [title*="Kilo"]').first()
		await activityBarIcon.click()
		await waitForWebviewText(page, "Welcome to Kilo Code!")

		// Configure API key through UI
		await configureApiKeyThroughUI(page)

		// Wait for the main interface to load
		await waitForWebviewText(page, "Generate, refactor, and debug code with AI assistance")
		await takeScreenshot("main-interface-loaded")

		const webviewFrame = await findWebview(page)

		// Capture the chat input area
		const chatInput = webviewFrame.locator('textarea, input[type="text"]').first()
		await expect(chatInput).toBeVisible()
		await takeScreenshot("chat-input-ready")

		// Type a message to show the input state
		await chatInput.fill("Hello, Kilo Code! This is a visual regression test.")
		await page.waitForTimeout(500)
		await takeScreenshot("chat-input-with-text")

		// Clear the input to show clean state
		await chatInput.clear()
		await page.waitForTimeout(500)
		await takeScreenshot("chat-input-cleared")
	})

	test("capture different VS Code themes with extension", async ({ workbox: page, takeScreenshot }) => {
		await verifyExtensionInstalled(page)

		// Configure extension first
		const activityBarIcon = page.locator('[aria-label*="Kilo"], [title*="Kilo"]').first()
		await activityBarIcon.click()
		await waitForWebviewText(page, "Welcome to Kilo Code!")
		await configureApiKeyThroughUI(page)
		await waitForWebviewText(page, "Generate, refactor, and debug code with AI assistance")

		// Capture default theme
		await takeScreenshot("extension-default-theme")

		// Change to dark theme
		const modifier = process.platform === "darwin" ? "Meta" : "Control"
		await page.keyboard.press(`${modifier}+Shift+P`)
		await page.keyboard.type("Preferences: Color Theme")
		await page.keyboard.press("Enter")
		await page.waitForTimeout(1000)

		// Select a dark theme
		await page.keyboard.type("Dark")
		await page.keyboard.press("Enter")
		await page.waitForTimeout(2000)

		// Capture extension with dark theme
		await takeScreenshot("extension-dark-theme")

		// Try light theme
		await page.keyboard.press(`${modifier}+Shift+P`)
		await page.keyboard.type("Preferences: Color Theme")
		await page.keyboard.press("Enter")
		await page.waitForTimeout(1000)
		await page.keyboard.type("Light")
		await page.keyboard.press("Enter")
		await page.waitForTimeout(2000)

		// Capture extension with light theme
		await takeScreenshot("extension-light-theme")
	})

	test("capture extension with file operations", async ({ workbox: page, takeScreenshot }) => {
		await verifyExtensionInstalled(page)

		// Configure extension
		const activityBarIcon = page.locator('[aria-label*="Kilo"], [title*="Kilo"]').first()
		await activityBarIcon.click()
		await waitForWebviewText(page, "Welcome to Kilo Code!")
		await configureApiKeyThroughUI(page)
		await waitForWebviewText(page, "Generate, refactor, and debug code with AI assistance")

		// Create a new file
		const modifier = process.platform === "darwin" ? "Meta" : "Control"
		await page.keyboard.press(`${modifier}+N`)
		await page.waitForTimeout(1000)

		// Add some code content
		await page.keyboard.type(`// Test file for Kilo Code visual regression
function greetKiloCode() {
    console.log("Hello from Kilo Code!");
    return "Visual regression test successful";
}

greetKiloCode();`)
		await page.waitForTimeout(1000)
		await takeScreenshot("extension-with-code-file")

		// Show the extension panel alongside the code
		await activityBarIcon.click()
		await page.waitForTimeout(500)
		await takeScreenshot("extension-panel-with-code-context")

		// Save the file
		await page.keyboard.press(`${modifier}+S`)
		await page.waitForTimeout(1000)
		await takeScreenshot("save-dialog-with-extension")
	})
})
