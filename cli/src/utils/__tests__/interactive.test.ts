/**
 * Tests for interactive mode detection utilities
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
	isCI,
	isStdinTTY,
	isNonInteractiveMode,
	getNonInteractiveReason,
	getConfigRequiredError,
	emitConfigRequiredError,
} from "../interactive.js"

describe("interactive utilities", () => {
	// Save original values
	const originalEnv = { ...process.env }
	const originalStdinIsTTY = process.stdin.isTTY

	beforeEach(() => {
		// Clear CI environment variables
		delete process.env.CI
		delete process.env.GITHUB_ACTIONS
		delete process.env.GITLAB_CI
		delete process.env.JENKINS_URL
		delete process.env.CIRCLECI
		delete process.env.TRAVIS
		delete process.env.BUILDKITE
		delete process.env.CODEBUILD_BUILD_ID
		delete process.env.TF_BUILD
		delete process.env.TEAMCITY_VERSION
	})

	afterEach(() => {
		// Restore original environment properly
		// Clear all current env vars and reassign original ones
		Object.keys(process.env).forEach((key) => delete process.env[key])
		Object.assign(process.env, originalEnv)
		// Note: isTTY is read-only in real Node.js, but we mock it in tests
		Object.defineProperty(process.stdin, "isTTY", { value: originalStdinIsTTY, writable: true })
	})

	describe("isCI", () => {
		it("should return false when no CI environment variables are set", () => {
			expect(isCI()).toBe(false)
		})

		it("should return true when CI=true is set", () => {
			process.env.CI = "true"
			expect(isCI()).toBe(true)
		})

		it("should return true when CI=1 is set", () => {
			process.env.CI = "1"
			expect(isCI()).toBe(true)
		})

		it("should return false when CI=false is set", () => {
			process.env.CI = "false"
			expect(isCI()).toBe(false)
		})

		it("should return false when CI=FALSE is set (case insensitive)", () => {
			process.env.CI = "FALSE"
			expect(isCI()).toBe(false)
		})

		it("should return false when CI=False is set (case insensitive)", () => {
			process.env.CI = "False"
			expect(isCI()).toBe(false)
		})

		it("should return false when CI=0 is set", () => {
			process.env.CI = "0"
			expect(isCI()).toBe(false)
		})

		it("should return false when CI is empty string", () => {
			process.env.CI = ""
			expect(isCI()).toBe(false)
		})

		it("should return true when GITHUB_ACTIONS is set", () => {
			process.env.GITHUB_ACTIONS = "true"
			expect(isCI()).toBe(true)
		})

		it("should return true when GITLAB_CI is set", () => {
			process.env.GITLAB_CI = "true"
			expect(isCI()).toBe(true)
		})

		it("should return true when JENKINS_URL is set", () => {
			process.env.JENKINS_URL = "http://jenkins.example.com"
			expect(isCI()).toBe(true)
		})

		it("should return true when CIRCLECI is set", () => {
			process.env.CIRCLECI = "true"
			expect(isCI()).toBe(true)
		})

		it("should return true when TRAVIS is set", () => {
			process.env.TRAVIS = "true"
			expect(isCI()).toBe(true)
		})

		it("should return true when BUILDKITE is set", () => {
			process.env.BUILDKITE = "true"
			expect(isCI()).toBe(true)
		})

		it("should return true when CODEBUILD_BUILD_ID is set", () => {
			process.env.CODEBUILD_BUILD_ID = "build-123"
			expect(isCI()).toBe(true)
		})

		it("should return true when TF_BUILD is set (Azure Pipelines)", () => {
			process.env.TF_BUILD = "True"
			expect(isCI()).toBe(true)
		})

		it("should return true when TEAMCITY_VERSION is set", () => {
			process.env.TEAMCITY_VERSION = "2023.1"
			expect(isCI()).toBe(true)
		})
	})

	describe("isStdinTTY", () => {
		it("should return true when stdin is a TTY", () => {
			Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true })
			expect(isStdinTTY()).toBe(true)
		})

		it("should return false when stdin is not a TTY", () => {
			Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true })
			expect(isStdinTTY()).toBe(false)
		})

		it("should return false when stdin.isTTY is undefined", () => {
			Object.defineProperty(process.stdin, "isTTY", { value: undefined, writable: true })
			expect(isStdinTTY()).toBe(false)
		})
	})

	describe("isNonInteractiveMode", () => {
		it("should return false with no options and TTY stdin in non-CI environment", () => {
			Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true })
			expect(isNonInteractiveMode()).toBe(false)
		})

		it("should return true when auto option is set", () => {
			Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true })
			expect(isNonInteractiveMode({ auto: true })).toBe(true)
		})

		it("should return true when json option is set", () => {
			Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true })
			expect(isNonInteractiveMode({ json: true })).toBe(true)
		})

		it("should return true when jsonIo option is set", () => {
			Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true })
			expect(isNonInteractiveMode({ jsonIo: true })).toBe(true)
		})

		it("should return true when stdin is not a TTY", () => {
			Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true })
			expect(isNonInteractiveMode()).toBe(true)
		})

		it("should return true when in CI environment", () => {
			Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true })
			process.env.CI = "true"
			expect(isNonInteractiveMode()).toBe(true)
		})

		it("should return true when multiple non-interactive conditions are met", () => {
			Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true })
			process.env.CI = "true"
			expect(isNonInteractiveMode({ auto: true, json: true })).toBe(true)
		})
	})

	describe("getNonInteractiveReason", () => {
		it("should return null when in interactive mode", () => {
			Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true })
			expect(getNonInteractiveReason()).toBeNull()
		})

		it("should identify --auto flag as reason", () => {
			Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true })
			expect(getNonInteractiveReason({ auto: true })).toBe("--auto flag is set")
		})

		it("should identify --json flag as reason", () => {
			Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true })
			expect(getNonInteractiveReason({ json: true })).toBe("--json flag is set")
		})

		it("should identify --json-io flag as reason", () => {
			Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true })
			expect(getNonInteractiveReason({ jsonIo: true })).toBe("--json-io flag is set")
		})

		it("should identify non-TTY stdin as reason", () => {
			Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true })
			expect(getNonInteractiveReason()).toBe("stdin is not a TTY (input may be piped)")
		})

		it("should identify CI environment as reason", () => {
			Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true })
			process.env.GITHUB_ACTIONS = "true"
			const reason = getNonInteractiveReason()
			expect(reason).toContain("CI environment detected")
			expect(reason).toContain("GITHUB_ACTIONS is set")
		})

		it("should prioritize explicit flags over environment detection", () => {
			Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true })
			process.env.CI = "true"
			// --auto should be reported first even if other conditions are met
			expect(getNonInteractiveReason({ auto: true })).toBe("--auto flag is set")
		})
	})

	describe("getConfigRequiredError", () => {
		it("should include the reason in error message", () => {
			const error = getConfigRequiredError("--auto flag is set")
			expect(error).toContain("--auto flag is set")
		})

		it("should include environment variable configuration instructions", () => {
			const error = getConfigRequiredError("CI environment detected")
			expect(error).toContain("KILO_PROVIDER_TYPE")
			expect(error).toContain("KILO_API_KEY")
			expect(error).toContain("KILO_API_MODEL_ID")
			expect(error).toContain("your-model-id")
		})

		it("should include auth wizard instructions", () => {
			const error = getConfigRequiredError(null)
			expect(error).toContain("kilocode auth")
		})

		it("should include config file instructions", () => {
			const error = getConfigRequiredError(null)
			expect(error).toContain("config.json")
		})

		it("should include documentation link", () => {
			const error = getConfigRequiredError(null)
			expect(error).toContain("ENVIRONMENT_VARIABLES.md")
		})

		it("should handle null reason gracefully", () => {
			const error = getConfigRequiredError(null)
			expect(error).toContain("Running in non-interactive mode")
		})
	})

	describe("emitConfigRequiredError", () => {
		it("should write JSON to stdout when json flag is set", () => {
			const stdout = vi.fn()
			const stderr = vi.fn()
			const reason = "--json flag is set"

			emitConfigRequiredError({ json: true, reason, stdout, stderr })

			expect(stdout).toHaveBeenCalledWith(
				JSON.stringify({
					type: "error",
					error: "configuration_required",
					message: getConfigRequiredError(reason),
					reason,
				}),
			)
			expect(stderr).not.toHaveBeenCalled()
		})

		it("should write JSON to stdout when jsonIo flag is set", () => {
			const stdout = vi.fn()
			const stderr = vi.fn()
			const reason = "--json-io flag is set"

			emitConfigRequiredError({ jsonIo: true, reason, stdout, stderr })

			expect(stdout).toHaveBeenCalledWith(
				JSON.stringify({
					type: "error",
					error: "configuration_required",
					message: getConfigRequiredError(reason),
					reason,
				}),
			)
			expect(stderr).not.toHaveBeenCalled()
		})

		it("should write plain error to stderr when json flags are not set", () => {
			const stdout = vi.fn()
			const stderr = vi.fn()
			const reason = "--auto flag is set"

			emitConfigRequiredError({ reason, stdout, stderr })

			expect(stdout).not.toHaveBeenCalled()
			expect(stderr).toHaveBeenCalledWith(getConfigRequiredError(reason))
		})
	})
})
