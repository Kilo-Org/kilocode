import { describe, it, expect } from "vitest"

/**
 * Tests for YOLO mode behavior in JSON-IO mode.
 *
 * In JSON-IO mode (--json-io flag), we don't send the yoloMode message to the extension host.
 * This prevents Task.ts from auto-answering followup questions, allowing the CLI's own
 * approval layer to handle YOLO behavior (which correctly excludes followups from auto-approval).
 */
describe("CLI yoloMode in JSON-IO mode", () => {
	describe("shouldSendYoloModeToExtension", () => {
		// Extract the logic we're testing into a pure function
		function shouldSendYoloModeToExtension(options: {
			jsonInteractive?: boolean
			ci?: boolean
			yolo?: boolean
		}): boolean {
			// This mirrors the condition in cli.ts:
			// if (!this.options.jsonInteractive) { sendWebviewMessage({ type: "yoloMode", ... }) }
			return !options.jsonInteractive
		}

		function getYoloModeValue(options: { ci?: boolean; yolo?: boolean }): boolean {
			// This mirrors: Boolean(this.options.ci || this.options.yolo)
			return Boolean(options.ci || options.yolo)
		}

		it("should send yoloMode message when not in JSON-IO mode", () => {
			expect(shouldSendYoloModeToExtension({ jsonInteractive: false })).toBe(true)
			expect(shouldSendYoloModeToExtension({ jsonInteractive: undefined })).toBe(true)
			expect(shouldSendYoloModeToExtension({})).toBe(true)
		})

		it("should NOT send yoloMode message when in JSON-IO mode", () => {
			expect(shouldSendYoloModeToExtension({ jsonInteractive: true })).toBe(false)
		})

		it("should NOT send yoloMode message in JSON-IO mode even with yolo flag", () => {
			expect(shouldSendYoloModeToExtension({ jsonInteractive: true, yolo: true })).toBe(false)
		})

		it("should NOT send yoloMode message in JSON-IO mode even with ci flag", () => {
			expect(shouldSendYoloModeToExtension({ jsonInteractive: true, ci: true })).toBe(false)
		})

		it("should set yoloMode value to true when yolo flag is set", () => {
			expect(getYoloModeValue({ yolo: true })).toBe(true)
		})

		it("should set yoloMode value to true when ci flag is set", () => {
			expect(getYoloModeValue({ ci: true })).toBe(true)
		})

		it("should set yoloMode value to true when both flags are set", () => {
			expect(getYoloModeValue({ yolo: true, ci: true })).toBe(true)
		})

		it("should set yoloMode value to false when neither flag is set", () => {
			expect(getYoloModeValue({})).toBe(false)
			expect(getYoloModeValue({ yolo: false, ci: false })).toBe(false)
		})
	})
})
