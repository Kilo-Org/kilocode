import { describe, it, expect, vi, beforeEach } from "vitest"
import { execa } from "execa"
import * as path from "path"

// Mock execa
vi.mock("execa")

// Mock os module
vi.mock("os", () => ({
	platform: vi.fn(),
}))

// Mock vscode module
vi.mock("vscode", () => ({
	extensions: {
		getExtension: vi.fn(() => ({
			extensionUri: {
				fsPath: "/mock/extension/path",
			},
		})),
	},
	Uri: {
		joinPath: vi.fn((extensionUri, ...pathSegments) => ({
			fsPath: path.join(__dirname, "..", "..", "..", ...pathSegments),
		})),
	},
}))

// Import after mocking
import { showSystemNotification } from "../index"
import * as os from "os"

const mockedExeca = vi.mocked(execa)
const mockedPlatform = vi.mocked(os.platform)

describe("showSystemNotification", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// Suppress console.error for tests
		vi.spyOn(console, "error").mockImplementation(() => {})
	})

	describe("macOS notifications", () => {
		beforeEach(() => {
			mockedPlatform.mockReturnValue("darwin")
		})

		it("should use terminal-notifier when available", async () => {
			mockedExeca.mockResolvedValueOnce({} as any)

			await showSystemNotification({
				title: "Test Title",
				subtitle: "Test Subtitle",
				message: "Test Message",
			})

			const expectedIconPath = path.join(__dirname, "..", "..", "..", "assets", "icons", "kilo.png")
			expect(mockedExeca).toHaveBeenCalledWith("terminal-notifier", [
				"-message",
				"Test Message",
				"-title",
				"Test Title",
				"-subtitle",
				"Test Subtitle",
				"-sound",
				"Tink",
				"-appIcon",
				expectedIconPath,
			])
			expect(mockedExeca).toHaveBeenCalledTimes(1)
		})

		it("should fall back to osascript when terminal-notifier fails", async () => {
			// First call (terminal-notifier) fails
			mockedExeca.mockRejectedValueOnce(new Error("terminal-notifier not found"))
			// Second call (osascript) succeeds
			mockedExeca.mockResolvedValueOnce({} as any)

			await showSystemNotification({
				title: "Test Title",
				subtitle: "Test Subtitle",
				message: "Test Message",
			})

			const expectedIconPath = path.join(__dirname, "..", "..", "..", "assets", "icons", "kilo.png")
			expect(mockedExeca).toHaveBeenCalledTimes(2)
			expect(mockedExeca).toHaveBeenNthCalledWith(1, "terminal-notifier", [
				"-message",
				"Test Message",
				"-title",
				"Test Title",
				"-subtitle",
				"Test Subtitle",
				"-sound",
				"Tink",
				"-appIcon",
				expectedIconPath,
			])
			expect(mockedExeca).toHaveBeenNthCalledWith(2, "osascript", [
				"-e",
				'display notification "Test Message" with title "Test Title" subtitle "Test Subtitle" sound name "Tink"',
			])
		})

		it("should handle terminal-notifier with minimal options", async () => {
			mockedExeca.mockResolvedValueOnce({} as any)

			await showSystemNotification({
				message: "Test Message",
			})

			const expectedIconPath = path.join(__dirname, "..", "..", "..", "assets", "icons", "kilo.png")
			expect(mockedExeca).toHaveBeenCalledWith("terminal-notifier", [
				"-message",
				"Test Message",
				"-title",
				"Kilo Code",
				"-sound",
				"Tink",
				"-appIcon",
				expectedIconPath,
			])
		})

		it("should handle terminal-notifier without subtitle", async () => {
			mockedExeca.mockResolvedValueOnce({} as any)

			await showSystemNotification({
				title: "Test Title",
				message: "Test Message",
			})

			const expectedIconPath = path.join(__dirname, "..", "..", "..", "assets", "icons", "kilo.png")
			expect(mockedExeca).toHaveBeenCalledWith("terminal-notifier", [
				"-message",
				"Test Message",
				"-title",
				"Test Title",
				"-sound",
				"Tink",
				"-appIcon",
				expectedIconPath,
			])
		})

		it("should escape quotes in terminal-notifier arguments", async () => {
			mockedExeca.mockResolvedValueOnce({} as any)

			await showSystemNotification({
				title: 'Title with "quotes"',
				subtitle: 'Subtitle with "quotes"',
				message: 'Message with "quotes"',
			})

			const expectedIconPath = path.join(__dirname, "..", "..", "..", "assets", "icons", "kilo.png")
			expect(mockedExeca).toHaveBeenCalledWith("terminal-notifier", [
				"-message",
				'Message with \\"quotes\\"',
				"-title",
				'Title with \\"quotes\\"',
				"-subtitle",
				'Subtitle with \\"quotes\\"',
				"-sound",
				"Tink",
				"-appIcon",
				expectedIconPath,
			])
		})

		it("should fall back to osascript and escape quotes properly", async () => {
			// terminal-notifier fails
			mockedExeca.mockRejectedValueOnce(new Error("not found"))
			// osascript succeeds
			mockedExeca.mockResolvedValueOnce({} as any)

			await showSystemNotification({
				title: 'Title with "quotes"',
				subtitle: 'Subtitle with "quotes"',
				message: 'Message with "quotes"',
			})

			expect(mockedExeca).toHaveBeenNthCalledWith(2, "osascript", [
				"-e",
				'display notification "Message with \\"quotes\\"" with title "Title with \\"quotes\\"" subtitle "Subtitle with \\"quotes\\"" sound name "Tink"',
			])
		})

		it("should throw error when both terminal-notifier and osascript fail", async () => {
			// Both calls fail
			mockedExeca.mockRejectedValue(new Error("Command failed"))

			await showSystemNotification({
				message: "Test Message",
			})

			// Should not throw but log error to console
			expect(console.error).toHaveBeenCalledWith("Could not show system notification", expect.any(Error))
		})
	})

	describe("Windows notifications", () => {
		beforeEach(() => {
			mockedPlatform.mockReturnValue("win32")
		})

		it("should use PowerShell for Windows notifications", async () => {
			mockedExeca.mockResolvedValueOnce({} as any)

			await showSystemNotification({
				title: "Test Title",
				subtitle: "Test Subtitle",
				message: "Test Message",
			})

			expect(mockedExeca).toHaveBeenCalledWith("powershell", [
				"-Command",
				expect.stringContaining("ToastNotificationManager"),
			])
		})
	})

	describe("Linux notifications", () => {
		beforeEach(() => {
			mockedPlatform.mockReturnValue("linux")
		})

		it("should use notify-send for Linux notifications", async () => {
			mockedExeca.mockResolvedValueOnce({} as any)

			await showSystemNotification({
				title: "Test Title",
				subtitle: "Test Subtitle",
				message: "Test Message",
			})

			expect(mockedExeca).toHaveBeenCalledWith("notify-send", ["Test Title", "Test Subtitle\nTest Message"])
		})
	})

	describe("Unsupported platforms", () => {
		it("should handle unsupported platforms gracefully", async () => {
			mockedPlatform.mockReturnValue("freebsd")

			await showSystemNotification({
				message: "Test Message",
			})

			expect(console.error).toHaveBeenCalledWith("Could not show system notification", expect.any(Error))
		})
	})

	describe("Input validation", () => {
		beforeEach(() => {
			mockedPlatform.mockReturnValue("darwin")
		})

		it("should handle missing message gracefully", async () => {
			await showSystemNotification({
				title: "Test Title",
			} as any)

			expect(console.error).toHaveBeenCalledWith("Could not show system notification", expect.any(Error))
		})

		it("should use default title when not provided", async () => {
			mockedExeca.mockResolvedValueOnce({} as any)

			await showSystemNotification({
				message: "Test Message",
			})

			const expectedIconPath = path.join(__dirname, "..", "..", "..", "assets", "icons", "kilo.png")
			expect(mockedExeca).toHaveBeenCalledWith("terminal-notifier", [
				"-message",
				"Test Message",
				"-title",
				"Kilo Code",
				"-sound",
				"Tink",
				"-appIcon",
				expectedIconPath,
			])
		})
	})
})
