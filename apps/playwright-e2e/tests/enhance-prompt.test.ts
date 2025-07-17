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

	test("should handle complete enhance prompt workflow", async ({ workbox: page }: TestFixtures) => {
		console.log("🚀 Starting comprehensive enhance prompt test")

		// Setup test environment
		console.log("📋 Setting up test environment...")
		await setupTestEnvironment(page)
		console.log("✅ Test environment setup complete")

		// Type original message
		console.log("⌨️  Typing original message:", originalText)
		await typeMessage(page, originalText)
		console.log("✅ Original message typed")

		// Verify enhance button is ready
		console.log("🔍 Verifying enhance button is ready...")
		await verifyEnhanceButtonReady(page)
		console.log("✅ Enhance button is ready")

		// PHASE 1: Test enhancement with loading state
		console.log("\n🔄 PHASE 1: Testing enhancement with loading state")
		console.log("🖱️  Clicking enhance button (will wait for cancel state)...")
		await clickEnhanceButton(page, "cancel", 5000)
		console.log("✅ Enhancement started, button now shows cancel state")

		console.log("⏳ Waiting for enhancement to complete (revert state)...")
		await waitForEnhanceButtonState(page, "revert", 30000)
		console.log("✅ Enhancement completed, button now shows revert state")

		const enhancedValue = await getChatInputValue(page)
		console.log("📝 Enhanced text length:", enhancedValue.length, "vs original:", originalText.length)
		expect(enhancedValue).not.toBe(originalText)
		expect(enhancedValue.length).toBeGreaterThan(originalText.length)
		console.log("✅ PHASE 1 PASSED: Enhancement completed successfully")

		// PHASE 2: Test cancellation during loading
		console.log("\n❌ PHASE 2: Testing cancellation during enhancement")
		console.log("🔄 Reverting to original text first...")
		await clickEnhanceButton(page, "enhance", 5000)
		const revertedValue = await getChatInputValue(page)
		expect(revertedValue).toBe(originalText)
		console.log("✅ Successfully reverted to original text")

		console.log("🖱️  Starting new enhancement...")
		await clickEnhanceButton(page, "cancel", 5000)
		console.log("✅ Enhancement started, button shows cancel state")

		console.log("🛑 Clicking cancel button to stop enhancement...")
		await clickEnhanceButton(page, "enhance", 5000)
		console.log("✅ Enhancement cancelled, button back to enhance state")

		const cancelledValue = await getChatInputValue(page)
		console.log("📝 Text after cancellation should match original")
		expect(cancelledValue).toBe(originalText)
		console.log("✅ PHASE 2 PASSED: Cancellation works correctly")

		// PHASE 3: Test revert functionality after successful enhancement
		console.log("\n↩️  PHASE 3: Testing revert functionality")
		console.log("🔄 Starting fresh enhancement for revert test...")
		await clickEnhanceButton(page, "cancel", 5000)
		console.log("✅ Enhancement started")

		console.log("⏳ Waiting for enhancement to complete...")
		await waitForEnhanceButtonState(page, "revert", 30000)
		console.log("✅ Enhancement completed")

		const finalEnhancedValue = await getChatInputValue(page)
		console.log("📝 Final enhanced text length:", finalEnhancedValue.length)
		expect(finalEnhancedValue).not.toBe(originalText)
		expect(finalEnhancedValue.length).toBeGreaterThan(originalText.length)
		console.log("✅ Enhancement successful")

		console.log("↩️  Clicking revert button...")
		await clickEnhanceButton(page, "enhance", 5000)
		const finalRevertedValue = await getChatInputValue(page)
		console.log("📝 Text after revert should match original")
		expect(finalRevertedValue).toBe(originalText)
		console.log("✅ PHASE 3 PASSED: Revert functionality works correctly")

		console.log("\n🎉 ALL PHASES COMPLETED SUCCESSFULLY!")
		console.log("✅ Enhancement workflow test passed all scenarios:")
		console.log("   - Enhancement with loading state")
		console.log("   - Cancellation during enhancement")
		console.log("   - Revert after successful enhancement")
	})
})
