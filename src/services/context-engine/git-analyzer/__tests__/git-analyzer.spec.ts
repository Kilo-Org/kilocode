// kilocode_change - new file
import * as path from "path"
import * as os from "os"
import { GitHistoryAnalyzer, resetGitHistoryAnalyzer } from "../index"

describe("GitHistoryAnalyzer", () => {
	let analyzer: GitHistoryAnalyzer
	// Use workspace root (6 levels up from __tests__ folder)
	const workspaceRoot = path.resolve(__dirname, "../../../../..")

	beforeEach(() => {
		resetGitHistoryAnalyzer()
		analyzer = new GitHistoryAnalyzer()
	})

	afterEach(() => {
		resetGitHistoryAnalyzer()
	})

	describe("initialization", () => {
		it("should initialize with a valid git repository", async () => {
			await analyzer.initialize(workspaceRoot)
			expect(analyzer.isAvailable()).toBe(true)
		})

		it("should handle non-git directory gracefully", async () => {
			// Use temp directory which is not a git repo
			await analyzer.initialize(os.tmpdir())
			expect(analyzer.isAvailable()).toBe(false)
		})

		it("should handle non-existent directory gracefully", async () => {
			await analyzer.initialize("/non/existent/path/that/does/not/exist")
			expect(analyzer.isAvailable()).toBe(false)
		})
	})

	describe("getFileHistory", () => {
		beforeEach(async () => {
			await analyzer.initialize(workspaceRoot)
		})

		it("should return empty array when not initialized", async () => {
			const uninitializedAnalyzer = new GitHistoryAnalyzer()
			const history = await uninitializedAnalyzer.getFileHistory("package.json")
			expect(history).toEqual([])
		})

		it("should return commit history for a file", async () => {
			const history = await analyzer.getFileHistory("package.json", 5)
			expect(Array.isArray(history)).toBe(true)
			if (history.length > 0) {
				expect(history[0]).toHaveProperty("hash")
				expect(history[0]).toHaveProperty("shortHash")
				expect(history[0]).toHaveProperty("author")
				expect(history[0]).toHaveProperty("date")
				expect(history[0]).toHaveProperty("message")
			}
		})

		it("should respect the limit parameter", async () => {
			const history = await analyzer.getFileHistory("package.json", 3)
			expect(history.length).toBeLessThanOrEqual(3)
		})

		it("should return empty array for non-existent file", async () => {
			const history = await analyzer.getFileHistory("non-existent-file-xyz-123.txt")
			expect(history).toEqual([])
		})
	})

	describe("getContributors", () => {
		beforeEach(async () => {
			await analyzer.initialize(workspaceRoot)
		})

		it("should return empty array when not initialized", async () => {
			const uninitializedAnalyzer = new GitHistoryAnalyzer()
			const contributors = await uninitializedAnalyzer.getContributors()
			expect(contributors).toEqual([])
		})

		it("should return contributors for the repository", async () => {
			const contributors = await analyzer.getContributors()
			expect(Array.isArray(contributors)).toBe(true)
			if (contributors.length > 0) {
				expect(contributors[0]).toHaveProperty("name")
				expect(contributors[0]).toHaveProperty("email")
				expect(contributors[0]).toHaveProperty("commitCount")
				expect(contributors[0]).toHaveProperty("firstCommit")
				expect(contributors[0]).toHaveProperty("lastCommit")
			}
		})

		it("should return contributors sorted by commit count", async () => {
			const contributors = await analyzer.getContributors()
			if (contributors.length > 1) {
				for (let i = 1; i < contributors.length; i++) {
					expect(contributors[i - 1].commitCount).toBeGreaterThanOrEqual(contributors[i].commitCount)
				}
			}
		})

		it("should return contributors for a specific file", async () => {
			const contributors = await analyzer.getContributors("package.json")
			expect(Array.isArray(contributors)).toBe(true)
		})
	})

	describe("getHotspots", () => {
		beforeEach(async () => {
			await analyzer.initialize(workspaceRoot)
		})

		it("should return empty array when not initialized", async () => {
			const uninitializedAnalyzer = new GitHistoryAnalyzer()
			const hotspots = await uninitializedAnalyzer.getHotspots()
			expect(hotspots).toEqual([])
		})

		it("should return hotspots for the repository", async () => {
			const hotspots = await analyzer.getHotspots(10)
			expect(Array.isArray(hotspots)).toBe(true)
			if (hotspots.length > 0) {
				expect(hotspots[0]).toHaveProperty("filePath")
				expect(hotspots[0]).toHaveProperty("changeFrequency")
				expect(hotspots[0]).toHaveProperty("contributorCount")
				expect(hotspots[0]).toHaveProperty("lastModified")
				expect(hotspots[0]).toHaveProperty("changesPerMonth")
			}
		})

		it("should respect the limit parameter", async () => {
			const hotspots = await analyzer.getHotspots(5)
			expect(hotspots.length).toBeLessThanOrEqual(5)
		})

		it("should return hotspots sorted by change frequency", async () => {
			const hotspots = await analyzer.getHotspots(20)
			if (hotspots.length > 1) {
				for (let i = 1; i < hotspots.length; i++) {
					expect(hotspots[i - 1].changeFrequency).toBeGreaterThanOrEqual(hotspots[i].changeFrequency)
				}
			}
		})
	})

	describe("getLastModified", () => {
		beforeEach(async () => {
			await analyzer.initialize(workspaceRoot)
		})

		it("should return null when not initialized", async () => {
			const uninitializedAnalyzer = new GitHistoryAnalyzer()
			const lastModified = await uninitializedAnalyzer.getLastModified("package.json")
			expect(lastModified).toBeNull()
		})

		it("should return last modified date for a tracked file", async () => {
			// Use a file that definitely exists and is tracked
			const lastModified = await analyzer.getLastModified("package.json")
			// May be null if file has no git history yet
			if (lastModified !== null) {
				expect(lastModified).toBeInstanceOf(Date)
			}
		})

		it("should return null for non-existent file", async () => {
			const lastModified = await analyzer.getLastModified("non-existent-file-xyz-123.txt")
			expect(lastModified).toBeNull()
		})
	})

	describe("calculateRecencyScore", () => {
		beforeEach(async () => {
			await analyzer.initialize(workspaceRoot)
		})

		it("should return base score when not initialized", async () => {
			const uninitializedAnalyzer = new GitHistoryAnalyzer()
			const score = await uninitializedAnalyzer.calculateRecencyScore("package.json", 1.0)
			expect(score).toBe(1.0)
		})

		it("should boost score for recently modified files", async () => {
			const baseScore = 1.0
			const score = await analyzer.calculateRecencyScore("package.json", baseScore)
			// Score should be >= base score (boosted or unchanged)
			expect(score).toBeGreaterThanOrEqual(baseScore)
		})

		it("should return base score for non-existent file", async () => {
			const baseScore = 1.0
			const score = await analyzer.calculateRecencyScore("non-existent-file-xyz-123.txt", baseScore)
			expect(score).toBe(baseScore)
		})
	})

	describe("getRecentChanges", () => {
		beforeEach(async () => {
			await analyzer.initialize(workspaceRoot)
		})

		it("should return empty array when not initialized", async () => {
			const uninitializedAnalyzer = new GitHistoryAnalyzer()
			const changes = await uninitializedAnalyzer.getRecentChanges()
			expect(changes).toEqual([])
		})

		it("should return recent changes", async () => {
			const changes = await analyzer.getRecentChanges(undefined, 10)
			expect(Array.isArray(changes)).toBe(true)
		})
	})

	describe("options", () => {
		it("should use custom options", async () => {
			const customAnalyzer = new GitHistoryAnalyzer({
				maxCommitsForHotspots: 100,
				recentChangesDays: 7,
				recencyWeight: 0.5,
			})
			await customAnalyzer.initialize(workspaceRoot)
			expect(customAnalyzer.isAvailable()).toBe(true)
		})
	})
})
