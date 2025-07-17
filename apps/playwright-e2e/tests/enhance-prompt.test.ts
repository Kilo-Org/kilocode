import { test, type TestFixtures } from "./playwright-base-test"
import { expect } from "@playwright/test"
import {
	typeMessage,
	verifyEnhanceButtonReady,
	clickEnhanceButton,
	waitForEnhanceButtonState,
	getChatInputValue,
	setupTestEnvironment,
} from "../helpers"

test.describe("Enhance Prompt", () => {
	const originalText = "Create a hello world function"

	test("should enhance prompt and show loading state", async ({ workbox: page }: TestFixtures) => {
		await setupTestEnvironment(page)
		await typeMessage(page, originalText)
		await verifyEnhanceButtonReady(page)
		await clickEnhanceButton(page, "cancel", 5000)
		await waitForEnhanceButtonState(page, "revert", 30000)

		const currentValue = await getChatInputValue(page)
		expect(currentValue).not.toBe(originalText)
		expect(currentValue.length).toBeGreaterThan(originalText.length)
	})

	test("should cancel enhancement when loading button is clicked", async ({ workbox: page }: TestFixtures) => {
		await setupTestEnvironment(page)
		await typeMessage(page, originalText)
		await verifyEnhanceButtonReady(page)
		await clickEnhanceButton(page, "cancel", 5000)
		await clickEnhanceButton(page, "enhance", 5000)

		const actualValue = await getChatInputValue(page)
		expect(actualValue).toBe(originalText)
	})

	test("should revert to original prompt when revert button is clicked after enhancement", async ({
		workbox: page,
	}: TestFixtures) => {
		await setupTestEnvironment(page)
		await typeMessage(page, originalText)
		await verifyEnhanceButtonReady(page)
		await clickEnhanceButton(page, "cancel", 5000)
		await waitForEnhanceButtonState(page, "revert", 30000)

		const currentValue = await getChatInputValue(page)
		expect(currentValue).not.toBe(originalText)
		expect(currentValue.length).toBeGreaterThan(originalText.length)

		await clickEnhanceButton(page, "enhance", 5000)
		const actualValue = await getChatInputValue(page)
		expect(actualValue).toBe(originalText)
	})
})
