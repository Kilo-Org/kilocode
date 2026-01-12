// kilocode_change - new file
import { describe, it, expect, vi, beforeEach } from "vitest"
import { ContributionTrackingService } from "../ContributionTrackingService"
import type { TrackContributionParams } from "../contribution-tracking-types"

// Mock dependencies
vi.mock("../../../shared/http")
vi.mock("../../code-index/managed/git-utils")
vi.mock("../../../utils/kilo-config-file")
vi.mock("../../../utils/git")

describe("ContributionTrackingService", () => {
	let service: ContributionTrackingService

	beforeEach(() => {
		// Get fresh instance for each test
		service = ContributionTrackingService.getInstance()
		// Clear any cached token
		service.clearCachedToken()
		// Clear all mocks
		vi.clearAllMocks()
	})

	describe("singleton pattern", () => {
		it("should return the same instance", () => {
			const instance1 = ContributionTrackingService.getInstance()
			const instance2 = ContributionTrackingService.getInstance()
			expect(instance1).toBe(instance2)
		})
	})

	describe("clearCachedToken", () => {
		it("should clear the cached token", () => {
			service.clearCachedToken()
			// Token should be cleared - we can't directly test this but it shouldn't throw
			expect(() => service.clearCachedToken()).not.toThrow()
		})
	})

	describe("line hashing", () => {
		it("should compute consistent hash for same content", () => {
			// Access private method via any cast for testing
			const hash1 = (service as any).computeLineHash("const x = 1")
			const hash2 = (service as any).computeLineHash("const x = 1")
			expect(hash1).toBe(hash2)
			expect(hash1).toHaveLength(40) // SHA-1 produces 40 character hex string
		})

		it("should normalize line endings", () => {
			const hash1 = (service as any).computeLineHash("const x = 1\n")
			const hash2 = (service as any).computeLineHash("const x = 1\r\n")
			const hash3 = (service as any).computeLineHash("const x = 1")
			expect(hash1).toBe(hash2)
			expect(hash2).toBe(hash3)
		})

		it("should produce different hashes for different content", () => {
			const hash1 = (service as any).computeLineHash("const x = 1")
			const hash2 = (service as any).computeLineHash("const x = 2")
			expect(hash1).not.toBe(hash2)
		})
	})

	describe("diff parsing", () => {
		it("should extract added lines", () => {
			const diff = `@@ -1,2 +1,3 @@
 const x = 1
+const y = 2
 console.log(x)`

			const { linesAdded, linesRemoved } = (service as any).extractLineChanges(diff)
			expect(linesAdded).toHaveLength(1)
			expect(linesAdded[0].line_number).toBe(2)
			expect(linesAdded[0].line_hash).toBeDefined()
			expect(linesRemoved).toHaveLength(0)
		})

		it("should extract removed lines", () => {
			const diff = `@@ -1,3 +1,2 @@
 const x = 1
-const y = 2
 console.log(x)`

			const { linesAdded, linesRemoved } = (service as any).extractLineChanges(diff)
			expect(linesAdded).toHaveLength(0)
			expect(linesRemoved).toHaveLength(1)
			expect(linesRemoved[0].line_number).toBe(2)
			expect(linesRemoved[0].line_hash).toBeDefined()
		})

		it("should handle multiple hunks", () => {
			const diff = `@@ -1,2 +1,3 @@
 const x = 1
+const y = 2
 console.log(x)
@@ -10,2 +11,3 @@
 function test() {
+  return true
 }`

			const { linesAdded, linesRemoved } = (service as any).extractLineChanges(diff)
			expect(linesAdded).toHaveLength(2)
			expect(linesAdded[0].line_number).toBe(2)
			expect(linesAdded[1].line_number).toBe(12)
		})

		it("should skip file markers", () => {
			const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,2 +1,3 @@
 const x = 1
+const y = 2
 console.log(x)`

			const { linesAdded, linesRemoved } = (service as any).extractLineChanges(diff)
			expect(linesAdded).toHaveLength(1)
			expect(linesRemoved).toHaveLength(0)
		})

		it("should handle empty diff", () => {
			const diff = ""
			const { linesAdded, linesRemoved } = (service as any).extractLineChanges(diff)
			expect(linesAdded).toHaveLength(0)
			expect(linesRemoved).toHaveLength(0)
		})
	})

	describe("token management", () => {
		it("should cache token and reuse it", async () => {
			const { fetchWithRetries } = await import("../../../shared/http")
			const mockFetchWithRetries = vi.mocked(fetchWithRetries)

			const futureExpiry = new Date(Date.now() + 15 * 60 * 1000).toISOString()

			mockFetchWithRetries.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					token: "short-lived-token",
					expiresAt: futureExpiry,
					organizationId: "org-1",
				}),
			} as Response)

			// First call should fetch token
			const token1 = await (service as any).getValidToken("org-1", "main-token")
			expect(mockFetchWithRetries).toHaveBeenCalledTimes(1)

			// Second call should reuse cached token
			const token2 = await (service as any).getValidToken("org-1", "main-token")
			expect(mockFetchWithRetries).toHaveBeenCalledTimes(1) // Still 1, not 2
			expect(token1.token).toBe(token2.token)
		})

		it("should fetch new token for different organization", async () => {
			const { fetchWithRetries } = await import("../../../shared/http")
			const mockFetchWithRetries = vi.mocked(fetchWithRetries)

			const futureExpiry = new Date(Date.now() + 15 * 60 * 1000).toISOString()

			mockFetchWithRetries
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						token: "token-org-1",
						expiresAt: futureExpiry,
						organizationId: "org-1",
					}),
				} as Response)
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						token: "token-org-2",
						expiresAt: futureExpiry,
						organizationId: "org-2",
					}),
				} as Response)

			// Fetch token for org-1
			const token1 = await (service as any).getValidToken("org-1", "main-token")
			expect(token1.token).toBe("token-org-1")

			// Fetch token for org-2 (should not use cached token from org-1)
			const token2 = await (service as any).getValidToken("org-2", "main-token")
			expect(token2.token).toBe("token-org-2")
			expect(mockFetchWithRetries).toHaveBeenCalledTimes(2)
		})
	})

	describe("trackContribution", () => {
		it("should skip tracking when no organization ID", async () => {
			const { fetchWithRetries } = await import("../../../shared/http")
			const mockFetchWithRetries = vi.mocked(fetchWithRetries)

			const params: TrackContributionParams = {
				cwd: "/test/repo",
				filePath: "test.ts",
				unifiedDiff: "@@ -1,1 +1,2 @@\n const x = 1\n+const y = 2",
				status: "accepted",
				kilocodeToken: "token",
				// organizationId is missing
			}

			await service.trackContribution(params)

			// Should not make any API calls
			expect(mockFetchWithRetries).not.toHaveBeenCalled()
		})

		it("should skip tracking when no project ID", async () => {
			const { fetchWithRetries } = await import("../../../shared/http")
			const mockFetchWithRetries = vi.mocked(fetchWithRetries)

			const { getProjectId } = await import("../../../utils/kilo-config-file")
			const mockGetProjectId = vi.mocked(getProjectId)
			mockGetProjectId.mockResolvedValueOnce(undefined)

			const { getCurrentBranch } = await import("../../code-index/managed/git-utils")
			const mockGetCurrentBranch = vi.mocked(getCurrentBranch)
			mockGetCurrentBranch.mockResolvedValueOnce("main")

			const { getGitRepositoryInfo } = await import("../../../utils/git")
			const mockGetGitRepositoryInfo = vi.mocked(getGitRepositoryInfo)
			mockGetGitRepositoryInfo.mockResolvedValueOnce({
				repositoryUrl: "https://github.com/test/repo.git",
				repositoryName: "test/repo",
				defaultBranch: "main",
			})

			const params: TrackContributionParams = {
				cwd: "/test/repo",
				filePath: "test.ts",
				unifiedDiff: "@@ -1,1 +1,2 @@\n const x = 1\n+const y = 2",
				status: "accepted",
				organizationId: "org-1",
				kilocodeToken: "token",
			}

			await service.trackContribution(params)

			// Should not make any API calls
			expect(mockFetchWithRetries).not.toHaveBeenCalled()
		})

		it("should successfully track accepted contribution", async () => {
			const { fetchWithRetries } = await import("../../../shared/http")
			const mockFetchWithRetries = vi.mocked(fetchWithRetries)

			const { getProjectId } = await import("../../../utils/kilo-config-file")
			const mockGetProjectId = vi.mocked(getProjectId)
			mockGetProjectId.mockResolvedValueOnce("test-project")

			const { getCurrentBranch } = await import("../../code-index/managed/git-utils")
			const mockGetCurrentBranch = vi.mocked(getCurrentBranch)
			mockGetCurrentBranch.mockResolvedValueOnce("feature/test")

			const { getGitRepositoryInfo } = await import("../../../utils/git")
			const mockGetGitRepositoryInfo = vi.mocked(getGitRepositoryInfo)
			mockGetGitRepositoryInfo.mockResolvedValueOnce({
				repositoryUrl: "https://github.com/test/repo.git",
				repositoryName: "test/repo",
				defaultBranch: "main",
			})

			const futureExpiry = new Date(Date.now() + 15 * 60 * 1000).toISOString()

			// Mock token fetch
			mockFetchWithRetries
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						token: "short-lived-token",
						expiresAt: futureExpiry,
						organizationId: "org-1",
					}),
				} as Response)
				// Mock contribution tracking
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({ success: true }),
				} as Response)

			const params: TrackContributionParams = {
				cwd: "/test/repo",
				filePath: "test.ts",
				unifiedDiff: "@@ -1,1 +1,2 @@\n const x = 1\n+const y = 2",
				status: "accepted",
				taskId: "task-123",
				organizationId: "org-1",
				kilocodeToken: "main-token",
			}

			await service.trackContribution(params)

			// Should have made 2 API calls: token fetch + contribution tracking
			expect(mockFetchWithRetries).toHaveBeenCalledTimes(2)

			// Verify contribution tracking call
			const trackingCall = mockFetchWithRetries.mock.calls[1][0]
			expect(trackingCall.method).toBe("POST")
			expect(trackingCall.headers).toMatchObject({
				Authorization: "Bearer short-lived-token",
				"Content-Type": "application/json",
			})

			const payload = JSON.parse(trackingCall.body as string)
			expect(payload).toMatchObject({
				project_id: "test-project",
				branch: "feature/test",
				file_path: "test.ts",
				status: "accepted",
				task_id: "task-123",
			})
			expect(payload.lines_added).toHaveLength(1)
			expect(payload.lines_removed).toHaveLength(0)
		})

		it("should handle errors gracefully without throwing", async () => {
			const { fetchWithRetries } = await import("../../../shared/http")
			const mockFetchWithRetries = vi.mocked(fetchWithRetries)

			const { getCurrentBranch } = await import("../../code-index/managed/git-utils")
			const mockGetCurrentBranch = vi.mocked(getCurrentBranch)
			mockGetCurrentBranch.mockResolvedValueOnce("main")

			const { getGitRepositoryInfo } = await import("../../../utils/git")
			const mockGetGitRepositoryInfo = vi.mocked(getGitRepositoryInfo)
			mockGetGitRepositoryInfo.mockResolvedValueOnce({})

			const { getProjectId } = await import("../../../utils/kilo-config-file")
			const mockGetProjectId = vi.mocked(getProjectId)
			mockGetProjectId.mockRejectedValueOnce(new Error("Git error"))

			const params: TrackContributionParams = {
				cwd: "/test/repo",
				filePath: "test.ts",
				unifiedDiff: "@@ -1,1 +1,2 @@\n const x = 1\n+const y = 2",
				status: "accepted",
				organizationId: "org-1",
				kilocodeToken: "token",
			}

			// Should not throw
			await expect(service.trackContribution(params)).resolves.not.toThrow()

			// Should not make tracking API call
			expect(mockFetchWithRetries).not.toHaveBeenCalled()
		})
	})
})
