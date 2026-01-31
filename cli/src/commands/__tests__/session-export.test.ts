/**
 * Tests for the session export/import commands
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { readExportedSession, previewImport, exportSession, type ExportedSession } from "../session-export.js"
import * as fs from "fs"
import { loadConfig, getKiloToken } from "../../config/persistence.js"

// Mock fs module
vi.mock("fs", () => ({
	writeFileSync: vi.fn(),
	readFileSync: vi.fn(),
	existsSync: vi.fn(),
}))

// Mock config/persistence
vi.mock("../../config/persistence.js", () => ({
	loadConfig: vi.fn(),
	getKiloToken: vi.fn(),
}))

// Mock config/env-config
vi.mock("../../config/env-config.js", () => ({
	applyEnvOverrides: vi.fn((config) => config),
}))

// Mock SessionClient and TrpcClient as classes
const mockSessionClientGet = vi.fn()
vi.mock("../../../../src/shared/kilocode/cli-sessions/core/SessionClient.js", () => ({
	SessionClient: function () {
		this.get = mockSessionClientGet
	},
}))

vi.mock("../../../../src/shared/kilocode/cli-sessions/core/TrpcClient.js", () => ({
	TrpcClient: function () {},
}))

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

describe("session-export", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("readExportedSession", () => {
		it("should throw error when file does not exist", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)

			expect(() => readExportedSession("nonexistent.json")).toThrow("File not found")
		})

		it("should throw error for invalid JSON structure", () => {
			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.readFileSync).mockReturnValue("{}")

			expect(() => readExportedSession("invalid.json")).toThrow("Invalid session export format")
		})

		it("should throw error for unsupported version", () => {
			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.readFileSync).mockReturnValue(
				JSON.stringify({
					version: 999,
					session: { id: "test" },
					data: {},
				}),
			)

			expect(() => readExportedSession("future.json")).toThrow("Unsupported export version")
		})

		it("should parse valid exported session", () => {
			const validExport: ExportedSession = {
				version: 1,
				exportedAt: "2026-01-28T00:00:00Z",
				session: {
					id: "test-session",
					title: "Test Session",
					createdAt: "2026-01-28T00:00:00Z",
					updatedAt: "2026-01-28T00:00:00Z",
					gitUrl: null,
					mode: "code",
					model: "claude-sonnet-4",
				},
				data: {
					apiConversationHistory: [{ role: "user", content: "hello" }],
					uiMessages: [{ type: "say", text: "hi" }],
					taskMetadata: { some: "data" },
					gitState: null,
				},
			}

			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(validExport))

			const result = readExportedSession("valid.json")

			expect(result.version).toBe(1)
			expect(result.session.id).toBe("test-session")
			expect(result.session.title).toBe("Test Session")
			expect(result.data.apiConversationHistory).toHaveLength(1)
			expect(result.data.uiMessages).toHaveLength(1)
		})
	})

	describe("previewImport", () => {
		it("should format session preview correctly", () => {
			const exported: ExportedSession = {
				version: 1,
				exportedAt: "2026-01-28T00:00:00Z",
				session: {
					id: "abc123",
					title: "My Session",
					createdAt: "2026-01-28T00:00:00Z",
					updatedAt: "2026-01-28T00:00:00Z",
					gitUrl: "https://github.com/test/repo",
					mode: "architect",
					model: "gpt-4o",
				},
				data: {
					apiConversationHistory: [1, 2, 3] as unknown[],
					uiMessages: [1, 2] as unknown[],
					taskMetadata: { exists: true },
					gitState: { branch: "main" },
				},
			}

			const preview = previewImport(exported)

			expect(preview).toContain("Session: My Session")
			expect(preview).toContain("Original ID: abc123")
			expect(preview).toContain("Mode: architect")
			expect(preview).toContain("Model: gpt-4o")
			expect(preview).toContain("API History: 3 messages")
			expect(preview).toContain("UI Messages: 2 messages")
			expect(preview).toContain("Task Metadata: Yes")
			expect(preview).toContain("Git State: Yes")
		})

		it("should handle missing optional fields", () => {
			const exported: ExportedSession = {
				version: 1,
				exportedAt: "2026-01-28T00:00:00Z",
				session: {
					id: "abc123",
					title: "",
					createdAt: "2026-01-28T00:00:00Z",
					updatedAt: "2026-01-28T00:00:00Z",
					gitUrl: null,
					mode: null,
					model: null,
				},
				data: {
					apiConversationHistory: null,
					uiMessages: null,
					taskMetadata: null,
					gitState: null,
				},
			}

			const preview = previewImport(exported)

			expect(preview).toContain("Session: Untitled")
			expect(preview).toContain("Mode: N/A")
			expect(preview).toContain("Model: N/A")
			expect(preview).toContain("API History: 0 messages")
			expect(preview).toContain("UI Messages: 0 messages")
			expect(preview).toContain("Task Metadata: No")
			expect(preview).toContain("Git State: No")
		})
	})

	describe("exportSession", () => {
		const mockSession = {
			session_id: "test-123",
			title: "Test Session",
			created_at: "2026-01-28T00:00:00Z",
			updated_at: "2026-01-28T01:00:00Z",
			git_url: "https://github.com/test/repo",
			last_mode: "code",
			last_model: "claude-sonnet-4",
			api_conversation_history_blob_url: "https://blob.example.com/api-history",
			ui_messages_blob_url: "https://blob.example.com/ui-messages",
			task_metadata_blob_url: "https://blob.example.com/task-metadata",
			git_state_blob_url: "https://blob.example.com/git-state",
		}

		const mockApiHistory = [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }]
		const mockUiMessages = [{ type: "say", text: "hello" }]
		const mockTaskMetadata = { task: "test" }
		const mockGitState = { branch: "main", commit: "abc123" }

		beforeEach(() => {
			vi.mocked(loadConfig).mockResolvedValue({ config: {}, configPath: "/test/config" })
			vi.mocked(getKiloToken).mockReturnValue("test-token")
			mockSessionClientGet.mockReset()
		})

		it("should throw error when no token is configured", async () => {
			vi.mocked(getKiloToken).mockReturnValue(null)

			await expect(exportSession("test-123")).rejects.toThrow("No Kilo Code token found")
		})

		it("should throw error when session is not found", async () => {
			mockSessionClientGet.mockResolvedValue(null)

			await expect(exportSession("nonexistent")).rejects.toThrow("Session not found: nonexistent")
		})

		it("should export session with all blob data", async () => {
			mockSessionClientGet.mockResolvedValue(mockSession)

			mockFetch.mockImplementation((url: string) => {
				const responses: Record<string, unknown> = {
					"https://blob.example.com/api-history": mockApiHistory,
					"https://blob.example.com/ui-messages": mockUiMessages,
					"https://blob.example.com/task-metadata": mockTaskMetadata,
					"https://blob.example.com/git-state": mockGitState,
				}
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve(responses[url]),
				})
			})

			const result = await exportSession("test-123")

			expect(result.version).toBe(1)
			expect(result.session.id).toBe("test-123")
			expect(result.session.title).toBe("Test Session")
			expect(result.session.gitUrl).toBe("https://github.com/test/repo")
			expect(result.session.mode).toBe("code")
			expect(result.session.model).toBe("claude-sonnet-4")
			expect(result.data.apiConversationHistory).toEqual(mockApiHistory)
			expect(result.data.uiMessages).toEqual(mockUiMessages)
			expect(result.data.taskMetadata).toEqual(mockTaskMetadata)
			expect(result.data.gitState).toEqual(mockGitState)
			expect(result.exportedAt).toBeDefined()
		})

		it("should handle blob fetch failures gracefully", async () => {
			const sessionWithoutBlobs = {
				...mockSession,
				api_conversation_history_blob_url: "https://blob.example.com/fail",
			}

			mockSessionClientGet.mockResolvedValue(sessionWithoutBlobs)

			mockFetch.mockImplementation((url: string) => {
				if (url === "https://blob.example.com/fail") {
					return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" })
				}
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve(null),
				})
			})

			const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

			const result = await exportSession("test-123")

			expect(result.data.apiConversationHistory).toBeNull()
			expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Warning"))

			consoleErrorSpy.mockRestore()
		})

		it("should export session without blob URLs", async () => {
			const sessionWithoutUrls = {
				session_id: "test-456",
				title: "Simple Session",
				created_at: "2026-01-28T00:00:00Z",
				updated_at: "2026-01-28T00:00:00Z",
				git_url: null,
				last_mode: null,
				last_model: null,
			}

			mockSessionClientGet.mockResolvedValue(sessionWithoutUrls)

			const result = await exportSession("test-456")

			expect(result.session.id).toBe("test-456")
			expect(result.data.apiConversationHistory).toBeNull()
			expect(result.data.uiMessages).toBeNull()
			expect(result.data.taskMetadata).toBeNull()
			expect(result.data.gitState).toBeNull()
		})
	})
})
