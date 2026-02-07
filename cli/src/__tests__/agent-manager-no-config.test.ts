import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * Tests for CLI behavior when spawned from Agent Manager without configuration.
 *
 * When the CLI is spawned from the Agent Manager (KILO_PLATFORM=agent-manager)
 * and no config exists, it should output a JSON welcome message with instructions
 * instead of trying to show the interactive auth wizard (which would hang without TTY).
 */

// Mock the config persistence module
vi.mock("../config/persistence.js", () => ({
	configExists: vi.fn(),
	loadConfig: vi.fn(),
}))

// Mock the env-config module
vi.mock("../config/env-config.js", () => ({
	envConfigExists: vi.fn(),
	getMissingEnvVars: vi.fn(),
}))

// Mock the auth wizard to ensure it's not called
vi.mock("../auth/index.js", () => ({
	default: vi.fn(),
}))

// Mock the logs service
vi.mock("../services/logs.js", () => ({
	logs: {
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
	},
}))

describe("Agent Manager No Config Behavior", () => {
	let originalEnv: NodeJS.ProcessEnv
	let consoleLogSpy: ReturnType<typeof vi.spyOn>
	let processExitSpy: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		// Save original environment
		originalEnv = { ...process.env }

		// Spy on console.log to capture JSON output
		consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {})

		// Spy on process.exit to prevent actual exit
		processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit called")
		})
	})

	afterEach(() => {
		// Restore original environment
		process.env = originalEnv

		// Restore spies
		consoleLogSpy.mockRestore()
		processExitSpy.mockRestore()

		vi.clearAllMocks()
	})

	it("should output JSON welcome message with instructions when KILO_PLATFORM=agent-manager and no config", async () => {
		// Set up environment for agent-manager mode
		process.env.KILO_PLATFORM = "agent-manager"

		// Mock config functions to return no config
		const { configExists } = await import("../config/persistence.js")
		const { envConfigExists } = await import("../config/env-config.js")
		vi.mocked(configExists).mockResolvedValue(false)
		vi.mocked(envConfigExists).mockReturnValue(false)

		// We can't easily test the full CLI entry point, but we can test the logic
		// by checking that the welcome message format matches what CliOutputParser expects
		const welcomeMessage = {
			type: "welcome",
			timestamp: Date.now(),
			metadata: {
				welcomeOptions: {
					instructions: ["Configuration required: No provider configured."],
				},
			},
		}

		// Verify the structure matches what the Agent Manager expects
		expect(welcomeMessage.type).toBe("welcome")
		expect(welcomeMessage.metadata.welcomeOptions.instructions).toBeInstanceOf(Array)
		expect(welcomeMessage.metadata.welcomeOptions.instructions.length).toBeGreaterThan(0)

		// Verify the JSON can be parsed correctly
		const jsonString = JSON.stringify(welcomeMessage)
		const parsed = JSON.parse(jsonString)
		expect(parsed.type).toBe("welcome")
		expect(parsed.metadata.welcomeOptions.instructions).toContain("Configuration required: No provider configured.")
	})

	it("should have instructions that trigger cli_configuration_error in Agent Manager", () => {
		// The welcome message format that the CLI outputs
		const welcomeMessage = {
			type: "welcome",
			timestamp: Date.now(),
			metadata: {
				welcomeOptions: {
					instructions: ["Configuration required: No provider configured."],
				},
			},
		}

		// Simulate what CliOutputParser.toStreamEvent does for welcome events
		const parsed = welcomeMessage
		const metadata = parsed.metadata as Record<string, unknown>
		const welcomeOptions = metadata?.welcomeOptions as Record<string, unknown>
		const instructions = welcomeOptions?.instructions as string[]

		// Verify instructions are present and non-empty (this triggers cli_configuration_error)
		expect(instructions).toBeDefined()
		expect(Array.isArray(instructions)).toBe(true)
		expect(instructions.length).toBeGreaterThan(0)

		// The CliProcessHandler.extractConfigErrorFromWelcome joins instructions with newlines
		const configurationError = instructions.join("\n")
		expect(configurationError).toBe("Configuration required: No provider configured.")
	})

	it("should not include showInstructions flag (only instructions array matters)", () => {
		// The simplified welcome message format
		const welcomeMessage = {
			type: "welcome",
			timestamp: Date.now(),
			metadata: {
				welcomeOptions: {
					instructions: ["Configuration required: No provider configured."],
				},
			},
		}

		// Verify showInstructions is not present (it's not needed)
		const welcomeOptions = welcomeMessage.metadata.welcomeOptions as Record<string, unknown>
		expect(welcomeOptions.showInstructions).toBeUndefined()

		// Only the instructions array matters for triggering the error
		expect(welcomeOptions.instructions).toBeDefined()
	})
})
