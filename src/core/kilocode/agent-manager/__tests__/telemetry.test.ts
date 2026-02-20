import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { TelemetryEventName } from "@roo-code/types"
import {
	captureAgentManagerOpened,
	captureAgentManagerSessionStarted,
	captureAgentManagerSessionCompleted,
	captureAgentManagerSessionStopped,
	captureAgentManagerSessionError,
	captureAgentManagerLoginIssue,
	getPlatformDiagnostics,
	type AgentManagerLoginIssueProperties,
} from "../telemetry"

// Mock the TelemetryService
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		hasInstance: vi.fn(),
		instance: {
			captureEvent: vi.fn(),
		},
	},
}))

import { TelemetryService } from "@roo-code/telemetry"

describe("Agent Manager Telemetry", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.resetAllMocks()
	})

	describe("captureAgentManagerOpened", () => {
		it("does not capture when TelemetryService has no instance", () => {
			vi.mocked(TelemetryService.hasInstance).mockReturnValue(false)

			captureAgentManagerOpened()

			expect(TelemetryService.instance.captureEvent).not.toHaveBeenCalled()
		})

		it("captures event when TelemetryService has instance", () => {
			vi.mocked(TelemetryService.hasInstance).mockReturnValue(true)

			captureAgentManagerOpened()

			expect(TelemetryService.instance.captureEvent).toHaveBeenCalledWith(TelemetryEventName.AGENT_MANAGER_OPENED)
		})
	})

	describe("captureAgentManagerSessionStarted", () => {
		it("captures event with sessionId and useWorktree", () => {
			vi.mocked(TelemetryService.hasInstance).mockReturnValue(true)

			captureAgentManagerSessionStarted("session-123", true)

			expect(TelemetryService.instance.captureEvent).toHaveBeenCalledWith(
				TelemetryEventName.AGENT_MANAGER_SESSION_STARTED,
				{ sessionId: "session-123", useWorktree: true },
			)
		})
	})

	describe("captureAgentManagerSessionCompleted", () => {
		it("captures event with sessionId and useWorktree", () => {
			vi.mocked(TelemetryService.hasInstance).mockReturnValue(true)

			captureAgentManagerSessionCompleted("session-456", false)

			expect(TelemetryService.instance.captureEvent).toHaveBeenCalledWith(
				TelemetryEventName.AGENT_MANAGER_SESSION_COMPLETED,
				{ sessionId: "session-456", useWorktree: false },
			)
		})
	})

	describe("captureAgentManagerSessionStopped", () => {
		it("captures event with sessionId and useWorktree", () => {
			vi.mocked(TelemetryService.hasInstance).mockReturnValue(true)

			captureAgentManagerSessionStopped("session-789", true)

			expect(TelemetryService.instance.captureEvent).toHaveBeenCalledWith(
				TelemetryEventName.AGENT_MANAGER_SESSION_STOPPED,
				{ sessionId: "session-789", useWorktree: true },
			)
		})
	})

	describe("captureAgentManagerSessionError", () => {
		it("captures event with sessionId, useWorktree, and error", () => {
			vi.mocked(TelemetryService.hasInstance).mockReturnValue(true)

			captureAgentManagerSessionError("session-error", false, "Something went wrong")

			expect(TelemetryService.instance.captureEvent).toHaveBeenCalledWith(
				TelemetryEventName.AGENT_MANAGER_SESSION_ERROR,
				{ sessionId: "session-error", useWorktree: false, error: "Something went wrong" },
			)
		})

		it("captures event without error message", () => {
			vi.mocked(TelemetryService.hasInstance).mockReturnValue(true)

			captureAgentManagerSessionError("session-error-2", true)

			expect(TelemetryService.instance.captureEvent).toHaveBeenCalledWith(
				TelemetryEventName.AGENT_MANAGER_SESSION_ERROR,
				{ sessionId: "session-error-2", useWorktree: true, error: undefined },
			)
		})
	})

	describe("captureAgentManagerLoginIssue", () => {
		it("does not capture when TelemetryService has no instance", () => {
			vi.mocked(TelemetryService.hasInstance).mockReturnValue(false)

			captureAgentManagerLoginIssue({ issueType: "cli_outdated" })

			expect(TelemetryService.instance.captureEvent).not.toHaveBeenCalled()
		})

		it("captures cli_outdated issue with hasNpm false", () => {
			vi.mocked(TelemetryService.hasInstance).mockReturnValue(true)

			const props: AgentManagerLoginIssueProperties = {
				issueType: "cli_outdated",
				hasNpm: false,
			}

			captureAgentManagerLoginIssue(props)

			expect(TelemetryService.instance.captureEvent).toHaveBeenCalledWith(
				TelemetryEventName.AGENT_MANAGER_LOGIN_ISSUE,
				props,
			)
		})

		it("captures auth_error issue with HTTP status code", () => {
			vi.mocked(TelemetryService.hasInstance).mockReturnValue(true)

			const props: AgentManagerLoginIssueProperties = {
				issueType: "auth_error",
				httpStatusCode: 401,
			}

			captureAgentManagerLoginIssue(props)

			expect(TelemetryService.instance.captureEvent).toHaveBeenCalledWith(
				TelemetryEventName.AGENT_MANAGER_LOGIN_ISSUE,
				props,
			)
		})

		it("captures payment_required issue", () => {
			vi.mocked(TelemetryService.hasInstance).mockReturnValue(true)

			const props: AgentManagerLoginIssueProperties = {
				issueType: "payment_required",
			}

			captureAgentManagerLoginIssue(props)

			expect(TelemetryService.instance.captureEvent).toHaveBeenCalledWith(
				TelemetryEventName.AGENT_MANAGER_LOGIN_ISSUE,
				props,
			)
		})

		it("captures session_timeout issue", () => {
			vi.mocked(TelemetryService.hasInstance).mockReturnValue(true)

			const props: AgentManagerLoginIssueProperties = {
				issueType: "session_timeout",
			}

			captureAgentManagerLoginIssue(props)

			expect(TelemetryService.instance.captureEvent).toHaveBeenCalledWith(
				TelemetryEventName.AGENT_MANAGER_LOGIN_ISSUE,
				props,
			)
		})

		it("captures session_timeout with enhanced diagnostic fields", () => {
			vi.mocked(TelemetryService.hasInstance).mockReturnValue(true)

			const props: AgentManagerLoginIssueProperties = {
				issueType: "session_timeout",
				platform: "darwin",
				shell: "zsh",
				hasStderr: true,
				stderrPreview: "error: git command not found",
				hadShellPath: false,
			}

			captureAgentManagerLoginIssue(props)

			expect(TelemetryService.instance.captureEvent).toHaveBeenCalledWith(
				TelemetryEventName.AGENT_MANAGER_LOGIN_ISSUE,
				props,
			)
		})

		it("captures api_error issue", () => {
			vi.mocked(TelemetryService.hasInstance).mockReturnValue(true)

			const props: AgentManagerLoginIssueProperties = {
				issueType: "api_error",
			}

			captureAgentManagerLoginIssue(props)

			expect(TelemetryService.instance.captureEvent).toHaveBeenCalledWith(
				TelemetryEventName.AGENT_MANAGER_LOGIN_ISSUE,
				props,
			)
		})

		it("captures cli_spawn_error issue with hasNpm", () => {
			vi.mocked(TelemetryService.hasInstance).mockReturnValue(true)

			const props: AgentManagerLoginIssueProperties = {
				issueType: "cli_spawn_error",
				hasNpm: true,
			}

			captureAgentManagerLoginIssue(props)

			expect(TelemetryService.instance.captureEvent).toHaveBeenCalledWith(
				TelemetryEventName.AGENT_MANAGER_LOGIN_ISSUE,
				props,
			)
		})

		it("captures cli_configuration_error issue with platform diagnostics", () => {
			vi.mocked(TelemetryService.hasInstance).mockReturnValue(true)

			const props: AgentManagerLoginIssueProperties = {
				issueType: "cli_configuration_error",
				platform: "darwin",
				shell: "fish",
			}

			captureAgentManagerLoginIssue(props)

			expect(TelemetryService.instance.captureEvent).toHaveBeenCalledWith(
				TelemetryEventName.AGENT_MANAGER_LOGIN_ISSUE,
				props,
			)
		})
	})

	describe("getPlatformDiagnostics", () => {
		it("returns platform and shell info", () => {
			const diagnostics = getPlatformDiagnostics()

			expect(diagnostics.platform).toMatch(/^(darwin|win32|linux|other)$/)
			// Shell may be undefined on Windows
			if (diagnostics.shell) {
				expect(typeof diagnostics.shell).toBe("string")
				// Should be just the shell name, not a path
				expect(diagnostics.shell).not.toContain("/")
			}
		})
	})
})
