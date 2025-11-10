/**
 * Tests for API client management operations
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import axios from "axios"
import { deleteBranchIndex, deleteProjectIndex } from "../api-client"

// Mock axios
vi.mock("axios")

// Mock token utilities
vi.mock("../../../../shared/kilocode/token", () => ({
	getKiloBaseUriFromToken: vi.fn(() => "https://api.kilocode.ai"),
}))

// Mock logger
vi.mock("../../../../utils/logging", () => ({
	logger: {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
	},
}))

describe("API Client Management Operations", () => {
	const organizationId = "org-123"
	const projectId = "proj-456"
	const gitBranch = "feature/test"
	const kilocodeToken = "test-token"

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("deleteBranchIndex", () => {
		it("should delete branch index successfully", async () => {
			vi.mocked(axios).mockResolvedValueOnce({
				status: 200,
				data: {},
			})

			await deleteBranchIndex(organizationId, projectId, gitBranch, kilocodeToken)

			expect(axios).toHaveBeenCalledWith({
				method: "DELETE",
				url: "https://api.kilocode.ai/api/codebase-indexing/branch",
				data: {
					organizationId,
					projectId,
					gitBranch,
				},
				headers: {
					Authorization: `Bearer ${kilocodeToken}`,
					"Content-Type": "application/json",
				},
			})
		})

		it("should throw error on failure", async () => {
			vi.mocked(axios).mockResolvedValueOnce({
				status: 500,
				statusText: "Internal Server Error",
			})

			await expect(deleteBranchIndex(organizationId, projectId, gitBranch, kilocodeToken)).rejects.toThrow(
				"Failed to delete branch index",
			)
		})

		it("should handle network errors", async () => {
			vi.mocked(axios).mockRejectedValueOnce(new Error("Network error"))

			await expect(deleteBranchIndex(organizationId, projectId, gitBranch, kilocodeToken)).rejects.toThrow(
				"Network error",
			)
		})
	})

	describe("deleteProjectIndex", () => {
		it("should delete project index successfully", async () => {
			vi.mocked(axios).mockResolvedValueOnce({
				status: 200,
				data: {},
			})

			await deleteProjectIndex(organizationId, projectId, kilocodeToken)

			expect(axios).toHaveBeenCalledWith({
				method: "DELETE",
				url: "https://api.kilocode.ai/api/codebase-indexing/project",
				data: {
					organizationId,
					projectId,
				},
				headers: {
					Authorization: `Bearer ${kilocodeToken}`,
					"Content-Type": "application/json",
				},
			})
		})

		it("should throw error on failure", async () => {
			vi.mocked(axios).mockResolvedValueOnce({
				status: 500,
				statusText: "Internal Server Error",
			})

			await expect(deleteProjectIndex(organizationId, projectId, kilocodeToken)).rejects.toThrow(
				"Failed to delete project index",
			)
		})

		it("should handle network errors", async () => {
			vi.mocked(axios).mockRejectedValueOnce(new Error("Network error"))

			await expect(deleteProjectIndex(organizationId, projectId, kilocodeToken)).rejects.toThrow("Network error")
		})
	})
})
