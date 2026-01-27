import { NotificationService, RefreshCapabilitiesCallback } from "../NotificationService"
import {
	LoggingMessageNotificationSchema,
	ResourceListChangedNotificationSchema,
	ToolListChangedNotificationSchema,
	PromptListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js"

// Mock vscode
const mockShowInformationMessage = vi.fn()
const mockShowWarningMessage = vi.fn()
const mockShowErrorMessage = vi.fn()

vi.mock("vscode", () => ({
	window: {
		showInformationMessage: (...args: any[]) => mockShowInformationMessage(...args),
		showWarningMessage: (...args: any[]) => mockShowWarningMessage(...args),
		showErrorMessage: (...args: any[]) => mockShowErrorMessage(...args),
	},
}))

describe("NotificationService", () => {
	let notificationService: NotificationService
	let mockClient: {
		setNotificationHandler: ReturnType<typeof vi.fn>
		fallbackNotificationHandler: ((notification: any) => Promise<void>) | null
	}
	let notificationHandlers: Map<any, (notification: any) => Promise<void>>
	let mockConsoleLog: ReturnType<typeof vi.spyOn>
	let mockConsoleError: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		vi.clearAllMocks()

		// Mock console.log and console.error to verify logging behavior
		mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {})
		mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {})

		notificationService = new NotificationService()
		notificationHandlers = new Map()

		// Create a mock client that captures notification handlers
		mockClient = {
			setNotificationHandler: vi.fn((schema, handler) => {
				notificationHandlers.set(schema, handler)
			}),
			fallbackNotificationHandler: null,
		}
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("connect", () => {
		it("should register handlers for all notification types", () => {
			notificationService.connect("test-server", mockClient as any)

			expect(mockClient.setNotificationHandler).toHaveBeenCalledTimes(4)
			expect(notificationHandlers.has(LoggingMessageNotificationSchema)).toBe(true)
			expect(notificationHandlers.has(ResourceListChangedNotificationSchema)).toBe(true)
			expect(notificationHandlers.has(ToolListChangedNotificationSchema)).toBe(true)
			expect(notificationHandlers.has(PromptListChangedNotificationSchema)).toBe(true)
		})

		it("should set a fallback notification handler", () => {
			notificationService.connect("test-server", mockClient as any)

			expect(mockClient.fallbackNotificationHandler).toBeDefined()
		})
	})

	describe("LoggingMessage notifications", () => {
		it("should show info message for info level", async () => {
			notificationService.connect("test-server", mockClient as any)
			const handler = notificationHandlers.get(LoggingMessageNotificationSchema)!

			await handler({
				params: {
					level: "info",
					data: "Test info message",
				},
			})

			expect(mockShowInformationMessage).toHaveBeenCalledWith("MCP test-server: Test info message")
		})

		it("should show warning message for warning level", async () => {
			notificationService.connect("test-server", mockClient as any)
			const handler = notificationHandlers.get(LoggingMessageNotificationSchema)!

			await handler({
				params: {
					level: "warning",
					data: "Test warning message",
				},
			})

			expect(mockShowWarningMessage).toHaveBeenCalledWith("MCP test-server: Test warning message")
		})

		it("should show warning message for alert level", async () => {
			notificationService.connect("test-server", mockClient as any)
			const handler = notificationHandlers.get(LoggingMessageNotificationSchema)!

			await handler({
				params: {
					level: "alert",
					data: "Test alert message",
				},
			})

			expect(mockShowWarningMessage).toHaveBeenCalledWith("MCP test-server: Test alert message")
		})

		it("should show error message for error level", async () => {
			notificationService.connect("test-server", mockClient as any)
			const handler = notificationHandlers.get(LoggingMessageNotificationSchema)!

			await handler({
				params: {
					level: "error",
					data: "Test error message",
				},
			})

			expect(mockShowErrorMessage).toHaveBeenCalledWith("MCP test-server: Test error message")
		})

		it("should show error message for critical level", async () => {
			notificationService.connect("test-server", mockClient as any)
			const handler = notificationHandlers.get(LoggingMessageNotificationSchema)!

			await handler({
				params: {
					level: "critical",
					data: "Test critical message",
				},
			})

			expect(mockShowErrorMessage).toHaveBeenCalledWith("MCP test-server: Test critical message")
		})

		it("should show error message for emergency level", async () => {
			notificationService.connect("test-server", mockClient as any)
			const handler = notificationHandlers.get(LoggingMessageNotificationSchema)!

			await handler({
				params: {
					level: "emergency",
					data: "Test emergency message",
				},
			})

			expect(mockShowErrorMessage).toHaveBeenCalledWith("MCP test-server: Test emergency message")
		})

		it("should include logger prefix when provided", async () => {
			notificationService.connect("test-server", mockClient as any)
			const handler = notificationHandlers.get(LoggingMessageNotificationSchema)!

			await handler({
				params: {
					level: "info",
					logger: "MyLogger",
					data: "Test message",
				},
			})

			expect(mockShowInformationMessage).toHaveBeenCalledWith("MCP test-server: [MyLogger]Test message")
		})

		it("should use message field if data is not provided", async () => {
			notificationService.connect("test-server", mockClient as any)
			const handler = notificationHandlers.get(LoggingMessageNotificationSchema)!

			await handler({
				params: {
					level: "info",
					message: "Test from message field",
				},
			})

			expect(mockShowInformationMessage).toHaveBeenCalledWith("MCP test-server: Test from message field")
		})

		it("should default to info level when not specified", async () => {
			notificationService.connect("test-server", mockClient as any)
			const handler = notificationHandlers.get(LoggingMessageNotificationSchema)!

			await handler({
				params: {
					data: "Test message without level",
				},
			})

			expect(mockShowInformationMessage).toHaveBeenCalledWith("MCP test-server: Test message without level")
		})
	})

	describe("ResourceListChanged notifications", () => {
		it("should call refresh callback when resources change", async () => {
			const mockRefreshCallback: RefreshCapabilitiesCallback = vi.fn().mockResolvedValue(undefined)
			notificationService.connect("test-server", mockClient as any, mockRefreshCallback)
			const handler = notificationHandlers.get(ResourceListChangedNotificationSchema)!

			await handler({})

			expect(mockRefreshCallback).toHaveBeenCalledWith("test-server")
			expect(mockConsoleLog).toHaveBeenCalledWith(
				"MCP test-server: resources list changed, refreshing capabilities",
			)
		})

		it("should not throw when no refresh callback is provided", async () => {
			notificationService.connect("test-server", mockClient as any)
			const handler = notificationHandlers.get(ResourceListChangedNotificationSchema)!

			await expect(handler({})).resolves.not.toThrow()
			expect(mockConsoleLog).toHaveBeenCalledWith(
				"MCP test-server: resources list changed, refreshing capabilities",
			)
		})

		it("should log error when refresh callback fails", async () => {
			const mockRefreshCallback: RefreshCapabilitiesCallback = vi
				.fn()
				.mockRejectedValue(new Error("Refresh failed"))
			notificationService.connect("test-server", mockClient as any, mockRefreshCallback)
			const handler = notificationHandlers.get(ResourceListChangedNotificationSchema)!

			await handler({})

			expect(mockConsoleError).toHaveBeenCalledWith(
				"MCP test-server: failed to refresh capabilities after resource list change:",
				expect.any(Error),
			)
		})

		it("should not show user notification for resource changes", async () => {
			const mockRefreshCallback: RefreshCapabilitiesCallback = vi.fn().mockResolvedValue(undefined)
			notificationService.connect("test-server", mockClient as any, mockRefreshCallback)
			const handler = notificationHandlers.get(ResourceListChangedNotificationSchema)!

			await handler({})

			expect(mockShowInformationMessage).not.toHaveBeenCalled()
			expect(mockShowWarningMessage).not.toHaveBeenCalled()
			expect(mockShowErrorMessage).not.toHaveBeenCalled()
		})
	})

	describe("ToolListChanged notifications", () => {
		it("should call refresh callback when tools change", async () => {
			const mockRefreshCallback: RefreshCapabilitiesCallback = vi.fn().mockResolvedValue(undefined)
			notificationService.connect("test-server", mockClient as any, mockRefreshCallback)
			const handler = notificationHandlers.get(ToolListChangedNotificationSchema)!

			await handler({})

			expect(mockRefreshCallback).toHaveBeenCalledWith("test-server")
			expect(mockConsoleLog).toHaveBeenCalledWith("MCP test-server: tools list changed, refreshing capabilities")
		})

		it("should not throw when no refresh callback is provided", async () => {
			notificationService.connect("test-server", mockClient as any)
			const handler = notificationHandlers.get(ToolListChangedNotificationSchema)!

			await expect(handler({})).resolves.not.toThrow()
		})

		it("should log error when refresh callback fails", async () => {
			const mockRefreshCallback: RefreshCapabilitiesCallback = vi
				.fn()
				.mockRejectedValue(new Error("Refresh failed"))
			notificationService.connect("test-server", mockClient as any, mockRefreshCallback)
			const handler = notificationHandlers.get(ToolListChangedNotificationSchema)!

			await handler({})

			expect(mockConsoleError).toHaveBeenCalledWith(
				"MCP test-server: failed to refresh capabilities after tool list change:",
				expect.any(Error),
			)
		})
	})

	describe("PromptListChanged notifications", () => {
		it("should call refresh callback when prompts change", async () => {
			const mockRefreshCallback: RefreshCapabilitiesCallback = vi.fn().mockResolvedValue(undefined)
			notificationService.connect("test-server", mockClient as any, mockRefreshCallback)
			const handler = notificationHandlers.get(PromptListChangedNotificationSchema)!

			await handler({})

			expect(mockRefreshCallback).toHaveBeenCalledWith("test-server")
			expect(mockConsoleLog).toHaveBeenCalledWith(
				"MCP test-server: prompts list changed, refreshing capabilities",
			)
		})

		it("should not throw when no refresh callback is provided", async () => {
			notificationService.connect("test-server", mockClient as any)
			const handler = notificationHandlers.get(PromptListChangedNotificationSchema)!

			await expect(handler({})).resolves.not.toThrow()
		})

		it("should log error when refresh callback fails", async () => {
			const mockRefreshCallback: RefreshCapabilitiesCallback = vi
				.fn()
				.mockRejectedValue(new Error("Refresh failed"))
			notificationService.connect("test-server", mockClient as any, mockRefreshCallback)
			const handler = notificationHandlers.get(PromptListChangedNotificationSchema)!

			await handler({})

			expect(mockConsoleError).toHaveBeenCalledWith(
				"MCP test-server: failed to refresh capabilities after prompt list change:",
				expect.any(Error),
			)
		})
	})

	describe("Fallback notification handler", () => {
		it("should log unknown notifications without showing user notification", async () => {
			notificationService.connect("test-server", mockClient as any)
			const fallbackHandler = mockClient.fallbackNotificationHandler!

			await fallbackHandler({
				jsonrpc: "2.0",
				method: "unknown/notification",
				params: { foo: "bar" },
			})

			expect(mockConsoleLog).toHaveBeenCalledWith("MCP test-server: unhandled notification", {
				jsonrpc: "2.0",
				method: "unknown/notification",
				params: { foo: "bar" },
			})
			expect(mockShowInformationMessage).not.toHaveBeenCalled()
			expect(mockShowWarningMessage).not.toHaveBeenCalled()
			expect(mockShowErrorMessage).not.toHaveBeenCalled()
		})
	})
})
