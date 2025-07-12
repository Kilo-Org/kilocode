import { test, type TestFixtures } from "./playwright-base-test"
import { expect } from "@playwright/test"
import {
	typeMessage,
	verifyEnhanceButtonReady,
	completeEnhancement,
	startEnhancement,
	cancelEnhancement,
	revertToOriginal,
	getChatInputValue,
} from "../helpers"

test.describe("Enhance Prompt", () => {
	const originalText = "Create a hello world function"

	test("should enhance prompt and show loading state", async ({ setupWorkbox: page }: TestFixtures) => {
		await typeMessage(page, originalText)
		await verifyEnhanceButtonReady(page)
		await completeEnhancement(page)

		const currentValue = await getChatInputValue(page)
		expect(currentValue).not.toBe(originalText)
		expect(currentValue.length).toBeGreaterThan(originalText.length)
	})

	test("should cancel enhancement when loading button is clicked", async ({ setupWorkbox: page }: TestFixtures) => {
		await typeMessage(page, originalText)
		await verifyEnhanceButtonReady(page)
		await startEnhancement(page)
		await cancelEnhancement(page)

		const actualValue = await getChatInputValue(page)
		expect(actualValue).toBe(originalText)
	})

	test("should revert to original prompt when revert button is clicked after enhancement", async ({
		setupWorkbox: page,
	}: TestFixtures) => {
		await typeMessage(page, originalText)
		await verifyEnhanceButtonReady(page)
		await completeEnhancement(page)

		const currentValue = await getChatInputValue(page)
		expect(currentValue).not.toBe(originalText)
		expect(currentValue.length).toBeGreaterThan(originalText.length)

		await revertToOriginal(page)
		const actualValue = await getChatInputValue(page)
		expect(actualValue).toBe(originalText)
	})
})
