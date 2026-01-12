// kilocode_change - new file
/**
 * Property-Based Tests for Git History Analyzer
 *
 * Feature: advanced-context-engine
 * Property 10: Git History Integration
 *
 * For any repository with git history, the Git History Analyzer SHALL extract
 * commit history, identify contributors, detect hotspots, and weight recent
 * changes higher in relevance scoring.
 */

import * as fc from "fast-check"
import * as path from "path"
import { GitHistoryAnalyzer, resetGitHistoryAnalyzer } from "../index"

describe("GitHistoryAnalyzer Property Tests", () => {
	let analyzer: GitHistoryAnalyzer
	const workspaceRoot = path.resolve(__dirname, "../../../../..")

	beforeEach(async () => {
		resetGitHistoryAnalyzer()
		analyzer = new GitHistoryAnalyzer()
		await analyzer.initialize(workspaceRoot)
	})

	afterEach(() => {
		resetGitHistoryAnalyzer()
	})

	describe("Property 10: Git History Integration", () => {
		it("should return consistent history length with limit parameter", async () => {
			await fc.assert(
				fc.asyncProperty(fc.integer({ min: 1, max: 20 }), async (limit) => {
					const history = await analyzer.getFileHistory("package.json", limit)

					expect(history.length).toBeLessThanOrEqual(limit)
				}),
				{ numRuns: 50 },
			)
		})

		it("should return history entries with required fields", async () => {
			await fc.assert(
				fc.asyncProperty(fc.integer({ min: 1, max: 10 }), async (limit) => {
					const history = await analyzer.getFileHistory("package.json", limit)

					for (const entry of history) {
						expect(entry).toHaveProperty("hash")
						expect(entry).toHaveProperty("shortHash")
						expect(entry).toHaveProperty("author")
						expect(entry).toHaveProperty("date")
						expect(entry).toHaveProperty("message")
						expect(typeof entry.hash).toBe("string")
						expect(entry.hash.length).toBeGreaterThan(0)
					}
				}),
				{ numRuns: 50 },
			)
		})

		it("should return contributors sorted by commit count", async () => {
			await fc.assert(
				fc.asyncProperty(fc.constant(true), async () => {
					const contributors = await analyzer.getContributors()

					if (contributors.length > 1) {
						for (let i = 1; i < contributors.length; i++) {
							expect(contributors[i - 1].commitCount).toBeGreaterThanOrEqual(contributors[i].commitCount)
						}
					}
				}),
				{ numRuns: 20 },
			)
		})

		it("should return hotspots sorted by change frequency", async () => {
			await fc.assert(
				fc.asyncProperty(fc.integer({ min: 5, max: 30 }), async (limit) => {
					const hotspots = await analyzer.getHotspots(limit)

					expect(hotspots.length).toBeLessThanOrEqual(limit)

					if (hotspots.length > 1) {
						for (let i = 1; i < hotspots.length; i++) {
							expect(hotspots[i - 1].changeFrequency).toBeGreaterThanOrEqual(hotspots[i].changeFrequency)
						}
					}
				}),
				{ numRuns: 30 },
			)
		})

		it("should return hotspots with required fields", async () => {
			await fc.assert(
				fc.asyncProperty(fc.integer({ min: 1, max: 10 }), async (limit) => {
					const hotspots = await analyzer.getHotspots(limit)

					for (const hotspot of hotspots) {
						expect(hotspot).toHaveProperty("filePath")
						expect(hotspot).toHaveProperty("changeFrequency")
						expect(hotspot).toHaveProperty("contributorCount")
						expect(hotspot).toHaveProperty("lastModified")
						expect(typeof hotspot.filePath).toBe("string")
						expect(typeof hotspot.changeFrequency).toBe("number")
						expect(hotspot.changeFrequency).toBeGreaterThanOrEqual(0)
					}
				}),
				{ numRuns: 30 },
			)
		})

		it("should boost recency score for tracked files", async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.float({ min: Math.fround(0.1), max: Math.fround(2.0), noNaN: true }),
					async (baseScore) => {
						const boostedScore = await analyzer.calculateRecencyScore("package.json", baseScore)

						// Score should be >= base score (boosted or unchanged)
						expect(boostedScore).toBeGreaterThanOrEqual(baseScore)
					},
				),
				{ numRuns: 50 },
			)
		})

		it("should return base score for non-existent files", async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.float({ min: Math.fround(0.1), max: Math.fround(2.0), noNaN: true }),
					async (baseScore) => {
						const filename = `nonexistent_${Math.random().toString(36).slice(2, 7)}.txt`
						const score = await analyzer.calculateRecencyScore(filename, baseScore)

						expect(score).toBe(baseScore)
					},
				),
				{ numRuns: 20 },
			)
		})

		it("should return contributors with valid date ranges", async () => {
			await fc.assert(
				fc.asyncProperty(fc.constant(true), async () => {
					const contributors = await analyzer.getContributors()

					for (const contributor of contributors) {
						expect(contributor.firstCommit).toBeInstanceOf(Date)
						expect(contributor.lastCommit).toBeInstanceOf(Date)
						expect(contributor.firstCommit.getTime()).toBeLessThanOrEqual(contributor.lastCommit.getTime())
					}
				}),
				{ numRuns: 20 },
			)
		})
	})
})
