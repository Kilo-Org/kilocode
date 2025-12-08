// kilocode_change - new file
import { describe, it, expect, vi, beforeEach } from "vitest"
import { deleteFiles, DeleteFilesParams } from "../api-client"
import { fetchWithRetries } from "../../../../shared/http"

vi.mock("../../../../shared/http")
vi.mock("../../../../utils/logging", () => ({
	logger: {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	},
}))

describe("api-client", () => {
	describe("deleteFiles", () => {
		beforeEach(() => {
			vi.clearAllMocks()
		})

		it("should send DELETE request with correct parameters", async () => {
			const mockResponse = {
				ok: true,
				json: vi.fn().mockResolvedValue({}),
			}
			vi.mocked(fetchWithRetries).mockResolvedValue(mockResponse as any)

			const params: DeleteFilesParams = {
				organizationId: "org-123",
				projectId: "project-456",
				gitBranch: "feature/test",
				filePaths: ["file1.ts", "file2.ts"],
				kilocodeToken: "test-token",
			}

			await deleteFiles(params)

			expect(fetchWithRetries).toHaveBeenCalledWith(
				expect.objectContaining({
					url: expect.stringContaining("/api/code-indexing/delete"),
					method: "POST",
					headers: {
						Authorization: "Bearer test-token",
						"Content-Type": "application/json",
					},
					signal: undefined,
				}),
			)

			// Verify the body contains the expected data
			const callArgs = vi.mocked(fetchWithRetries).mock.calls[0][0]
			const body = JSON.parse(callArgs.body as string)
			expect(body).toEqual({
				projectId: "project-456",
				organizationId: "org-123",
				gitBranch: "feature/test",
				filePaths: ["file1.ts", "file2.ts"],
			})
		})

		it("should handle null organizationId", async () => {
			const mockResponse = {
				ok: true,
				json: vi.fn().mockResolvedValue({}),
			}
			vi.mocked(fetchWithRetries).mockResolvedValue(mockResponse as any)

			const params: DeleteFilesParams = {
				organizationId: null,
				projectId: "project-456",
				gitBranch: "main",
				filePaths: ["file1.ts"],
				kilocodeToken: "test-token",
			}

			await deleteFiles(params)

			const callArgs = vi.mocked(fetchWithRetries).mock.calls[0][0]
			const body = JSON.parse(callArgs.body as string)
			expect(body.organizationId).toBeUndefined()
			expect(body.projectId).toBe("project-456")
		})

		it("should handle optional gitBranch", async () => {
			const mockResponse = {
				ok: true,
				json: vi.fn().mockResolvedValue({}),
			}
			vi.mocked(fetchWithRetries).mockResolvedValue(mockResponse as any)

			const params: DeleteFilesParams = {
				organizationId: "org-123",
				projectId: "project-456",
				filePaths: ["file1.ts"],
				kilocodeToken: "test-token",
			}

			await deleteFiles(params)

			const callArgs = vi.mocked(fetchWithRetries).mock.calls[0][0]
			const body = JSON.parse(callArgs.body as string)
			expect(body.gitBranch).toBeUndefined()
		})

		it("should handle optional filePaths", async () => {
			const mockResponse = {
				ok: true,
				json: vi.fn().mockResolvedValue({}),
			}
			vi.mocked(fetchWithRetries).mockResolvedValue(mockResponse as any)

			const params: DeleteFilesParams = {
				organizationId: "org-123",
				projectId: "project-456",
				gitBranch: "main",
				kilocodeToken: "test-token",
			}

			await deleteFiles(params)

			const callArgs = vi.mocked(fetchWithRetries).mock.calls[0][0]
			const body = JSON.parse(callArgs.body as string)
			expect(body.filePaths).toBeUndefined()
		})

		it("should pass abort signal to fetch", async () => {
			const mockResponse = {
				ok: true,
				json: vi.fn().mockResolvedValue({}),
			}
			vi.mocked(fetchWithRetries).mockResolvedValue(mockResponse as any)

			const abortController = new AbortController()
			const params: DeleteFilesParams = {
				organizationId: "org-123",
				projectId: "project-456",
				filePaths: ["file1.ts"],
				kilocodeToken: "test-token",
			}

			await deleteFiles(params, abortController.signal)

			expect(fetchWithRetries).toHaveBeenCalledWith(
				expect.objectContaining({
					signal: abortController.signal,
				}),
			)
		})

		it("should throw error when response is not ok", async () => {
			const mockResponse = {
				ok: false,
				statusText: "Internal Server Error",
			}
			vi.mocked(fetchWithRetries).mockResolvedValue(mockResponse as any)

			const params: DeleteFilesParams = {
				organizationId: "org-123",
				projectId: "project-456",
				filePaths: ["file1.ts"],
				kilocodeToken: "test-token",
			}

			await expect(deleteFiles(params)).rejects.toThrow("Failed to delete files: Internal Server Error")
		})

		it("should throw error when fetch fails", async () => {
			vi.mocked(fetchWithRetries).mockRejectedValue(new Error("Network error"))

			const params: DeleteFilesParams = {
				organizationId: "org-123",
				projectId: "project-456",
				filePaths: ["file1.ts"],
				kilocodeToken: "test-token",
			}

			await expect(deleteFiles(params)).rejects.toThrow("Network error")
		})
	})
})
