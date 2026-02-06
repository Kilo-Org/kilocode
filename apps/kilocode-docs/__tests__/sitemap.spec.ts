/**
 * Tests for the sitemap.xml API endpoint
 *
 * This test suite verifies that the sitemap generation works correctly:
 * 1. Generates valid XML structure
 * 2. Includes all markdown pages
 * 3. Uses correct URL format with the docs basePath
 */

import { expect, describe, it, vi, beforeEach, afterEach } from "vitest"
import type { NextApiRequest, NextApiResponse } from "next"

// Mock fs module
vi.mock("fs", () => ({
	default: {
		readdirSync: vi.fn(),
		statSync: vi.fn(),
	},
	readdirSync: vi.fn(),
	statSync: vi.fn(),
}))

import fs from "fs"
import handler from "../pages/api/sitemap.xml"

describe("sitemap.xml API", () => {
	let mockReq: Partial<NextApiRequest>
	let mockRes: Partial<NextApiResponse>
	let responseData: string
	let responseHeaders: Record<string, string>
	let responseStatus: number

	beforeEach(() => {
		responseHeaders = {}
		responseStatus = 200
		responseData = ""

		mockReq = {
			method: "GET",
		}

		mockRes = {
			status: vi.fn().mockReturnThis(),
			send: vi.fn((data) => {
				responseData = data
				return mockRes
			}),
			json: vi.fn().mockReturnThis(),
			setHeader: vi.fn((key, value) => {
				responseHeaders[key as string] = value as string
				return mockRes
			}),
		}

		// Mock fs.readdirSync to return test files
		vi.mocked(fs.readdirSync).mockImplementation((dir: any) => {
			const dirStr = dir.toString()
			if (dirStr.endsWith("pages")) {
				return [
					{ name: "index.md", isDirectory: () => false },
					{ name: "getting-started", isDirectory: () => true },
					{ name: "api", isDirectory: () => true },
				] as any
			}
			if (dirStr.includes("getting-started")) {
				return [
					{ name: "index.md", isDirectory: () => false },
					{ name: "quickstart.md", isDirectory: () => false },
				] as any
			}
			return []
		})

		// Mock fs.statSync to return a fixed date
		vi.mocked(fs.statSync).mockReturnValue({
			mtime: new Date("2025-01-15T10:00:00Z"),
		} as any)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("HTTP method handling", () => {
		it("should return 405 for non-GET requests", async () => {
			mockReq.method = "POST"

			await handler(mockReq as NextApiRequest, mockRes as NextApiResponse)

			expect(mockRes.status).toHaveBeenCalledWith(405)
			expect(mockRes.json).toHaveBeenCalledWith({ error: "Method not allowed" })
		})

		it("should accept GET requests", async () => {
			await handler(mockReq as NextApiRequest, mockRes as NextApiResponse)

			expect(mockRes.status).toHaveBeenCalledWith(200)
		})
	})

	describe("sitemap generation", () => {
		it("should generate valid XML with correct headers", async () => {
			await handler(mockReq as NextApiRequest, mockRes as NextApiResponse)

			expect(responseHeaders["Content-Type"]).toBe("application/xml; charset=utf-8")
			expect(responseHeaders["Cache-Control"]).toBe("public, max-age=3600, s-maxage=3600")
		})

		it("should include XML declaration and urlset", async () => {
			await handler(mockReq as NextApiRequest, mockRes as NextApiResponse)

			expect(responseData).toContain('<?xml version="1.0" encoding="UTF-8"?>')
			expect(responseData).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
			expect(responseData).toContain("</urlset>")
		})

		it("should include homepage with priority 1.0", async () => {
			await handler(mockReq as NextApiRequest, mockRes as NextApiResponse)

			expect(responseData).toContain("<loc>https://kilo.ai/docs</loc>")
			expect(responseData).toContain("<priority>1.0</priority>")
		})

		it("should include markdown pages with correct URLs", async () => {
			await handler(mockReq as NextApiRequest, mockRes as NextApiResponse)

			expect(responseData).toContain("<loc>https://kilo.ai/docs/getting-started</loc>")
			expect(responseData).toContain("<loc>https://kilo.ai/docs/getting-started/quickstart</loc>")
		})

		it("should include lastmod dates", async () => {
			await handler(mockReq as NextApiRequest, mockRes as NextApiResponse)

			expect(responseData).toContain("<lastmod>2025-01-15</lastmod>")
		})

		it("should include changefreq", async () => {
			await handler(mockReq as NextApiRequest, mockRes as NextApiResponse)

			expect(responseData).toContain("<changefreq>weekly</changefreq>")
		})

		it("should skip api directory", async () => {
			await handler(mockReq as NextApiRequest, mockRes as NextApiResponse)

			expect(responseData).not.toContain("/api/")
		})
	})

	describe("error handling", () => {
		it("should return 500 on filesystem errors", async () => {
			vi.mocked(fs.readdirSync).mockImplementation(() => {
				throw new Error("Filesystem error")
			})

			await handler(mockReq as NextApiRequest, mockRes as NextApiResponse)

			expect(mockRes.status).toHaveBeenCalledWith(500)
			expect(mockRes.json).toHaveBeenCalledWith({ error: "Internal server error" })
		})
	})
})
