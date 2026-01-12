// kilocode_change - new file
/**
 * Property-Based Tests for Cross-Repository Manager
 *
 * Feature: advanced-context-engine
 * Property 8: Cross-Repository Indexing
 *
 * For any set of workspace folders, the Context Engine SHALL index all folders
 * and maintain separate but queryable indexes, with cross-repository links
 * correctly identified.
 */

import * as fc from "fast-check"
import * as path from "path"
import { CrossRepoManager, resetCrossRepoManager } from "../index"

describe("CrossRepoManager Property Tests", () => {
	let manager: CrossRepoManager

	beforeEach(() => {
		resetCrossRepoManager()
		manager = new CrossRepoManager()
	})

	afterEach(() => {
		resetCrossRepoManager()
	})

	// Arbitraries
	const repoPath = fc.stringMatching(/^\/[a-z]{3,10}\/[a-z]{3,10}$/)
	const repoName = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{2,15}$/)
	const entityId = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{2,20}$/)
	const linkType = fc.constantFrom("imports", "uses", "extends", "implements") as fc.Arbitrary<
		"imports" | "uses" | "extends" | "implements"
	>

	describe("Property 8: Cross-Repository Indexing", () => {
		it("should maintain separate repositories with unique IDs", async () => {
			await fc.assert(
				fc.asyncProperty(fc.array(repoPath, { minLength: 1, maxLength: 5 }), async (paths) => {
					resetCrossRepoManager()
					manager = new CrossRepoManager()

					const uniquePaths = [...new Set(paths)]
					const repos = []

					for (const p of uniquePaths) {
						const repo = await manager.addRepository(p)
						repos.push(repo)
					}

					// All repos should have unique IDs
					const ids = repos.map((r) => r.id)
					expect(new Set(ids).size).toBe(uniquePaths.length)

					// All repos should be retrievable
					for (const repo of repos) {
						expect(manager.getRepository(repo.id)).toBe(repo)
					}
				}),
				{ numRuns: 100 },
			)
		})

		it("should set first repository as primary", async () => {
			await fc.assert(
				fc.asyncProperty(fc.array(repoPath, { minLength: 2, maxLength: 5 }), async (paths) => {
					resetCrossRepoManager()
					manager = new CrossRepoManager()

					const uniquePaths = [...new Set(paths)]
					if (uniquePaths.length < 2) return

					const repos = []
					for (const p of uniquePaths) {
						repos.push(await manager.addRepository(p))
					}

					expect(repos[0].isPrimary).toBe(true)
					for (let i = 1; i < repos.length; i++) {
						expect(repos[i].isPrimary).toBe(false)
					}
				}),
				{ numRuns: 100 },
			)
		})

		it("should correctly resolve repository by file path", async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.array(repoPath, { minLength: 1, maxLength: 3 }),
					fc.stringMatching(/^[a-z]{3,10}\.ts$/),
					async (paths, filename) => {
						resetCrossRepoManager()
						manager = new CrossRepoManager()

						const uniquePaths = [...new Set(paths)]
						const repos = []

						for (const p of uniquePaths) {
							repos.push(await manager.addRepository(p))
						}

						for (const repo of repos) {
							const filePath = path.join(repo.rootPath, "src", filename)
							const found = manager.getRepositoryByPath(filePath)
							expect(found?.id).toBe(repo.id)
						}
					},
				),
				{ numRuns: 100 },
			)
		})

		it("should create and retrieve cross-repo links", async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.tuple(repoPath, repoPath).filter(([a, b]) => a !== b),
					entityId,
					entityId,
					linkType,
					async ([path1, path2], entity1, entity2, type) => {
						resetCrossRepoManager()
						manager = new CrossRepoManager()

						const repo1 = await manager.addRepository(path1)
						const repo2 = await manager.addRepository(path2)

						manager.addCrossRepoLink({
							sourceRepoId: repo1.id,
							sourceEntityId: entity1,
							targetRepoId: repo2.id,
							targetEntityId: entity2,
							linkType: type,
						})

						const links = manager.getCrossRepoLinks(entity1)
						expect(links.length).toBe(1)
						expect(links[0].sourceEntityId).toBe(entity1)
						expect(links[0].targetEntityId).toBe(entity2)
						expect(links[0].linkType).toBe(type)
					},
				),
				{ numRuns: 100 },
			)
		})

		it("should not create duplicate cross-repo links", async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.tuple(repoPath, repoPath).filter(([a, b]) => a !== b),
					entityId,
					entityId,
					linkType,
					fc.integer({ min: 2, max: 5 }),
					async ([path1, path2], entity1, entity2, type, duplicateCount) => {
						resetCrossRepoManager()
						manager = new CrossRepoManager()

						const repo1 = await manager.addRepository(path1)
						const repo2 = await manager.addRepository(path2)

						const link = {
							sourceRepoId: repo1.id,
							sourceEntityId: entity1,
							targetRepoId: repo2.id,
							targetEntityId: entity2,
							linkType: type,
						}

						for (let i = 0; i < duplicateCount; i++) {
							manager.addCrossRepoLink(link)
						}

						const links = manager.getAllCrossRepoLinks()
						expect(links.length).toBe(1)
					},
				),
				{ numRuns: 100 },
			)
		})

		it("should remove links when repository is removed", async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.tuple(repoPath, repoPath).filter(([a, b]) => a !== b),
					entityId,
					entityId,
					linkType,
					async ([path1, path2], entity1, entity2, type) => {
						resetCrossRepoManager()
						manager = new CrossRepoManager()

						const repo1 = await manager.addRepository(path1)
						const repo2 = await manager.addRepository(path2)

						manager.addCrossRepoLink({
							sourceRepoId: repo1.id,
							sourceEntityId: entity1,
							targetRepoId: repo2.id,
							targetEntityId: entity2,
							linkType: type,
						})

						manager.removeRepository(repo1.id)

						const links = manager.getAllCrossRepoLinks()
						expect(links.length).toBe(0)
					},
				),
				{ numRuns: 100 },
			)
		})

		it("should update primary when primary repository is removed", async () => {
			await fc.assert(
				fc.asyncProperty(fc.array(repoPath, { minLength: 2, maxLength: 4 }), async (paths) => {
					resetCrossRepoManager()
					manager = new CrossRepoManager()

					const uniquePaths = [...new Set(paths)]
					if (uniquePaths.length < 2) return

					const repos = []
					for (const p of uniquePaths) {
						repos.push(await manager.addRepository(p))
					}

					const primaryId = repos[0].id
					manager.removeRepository(primaryId)

					const newPrimary = manager.getPrimaryRepository()
					expect(newPrimary).not.toBeNull()
					expect(newPrimary?.id).not.toBe(primaryId)
					expect(newPrimary?.isPrimary).toBe(true)
				}),
				{ numRuns: 100 },
			)
		})

		it("should track entity counts correctly", async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.array(fc.tuple(repoPath, fc.integer({ min: 0, max: 1000 })), { minLength: 1, maxLength: 5 }),
					async (repoData) => {
						resetCrossRepoManager()
						manager = new CrossRepoManager()

						const uniqueData = repoData.filter(
							(item, index, self) => self.findIndex((t) => t[0] === item[0]) === index,
						)

						let totalEntities = 0
						for (const [p, count] of uniqueData) {
							const repo = await manager.addRepository(p)
							manager.updateEntityCount(repo.id, count)
							totalEntities += count
						}

						const stats = manager.getStats()
						expect(stats.totalEntities).toBe(totalEntities)
						expect(stats.repositoryCount).toBe(uniqueData.length)
					},
				),
				{ numRuns: 100 },
			)
		})

		it("should track link types in statistics", async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.tuple(repoPath, repoPath).filter(([a, b]) => a !== b),
					fc.array(fc.tuple(entityId, entityId, linkType), { minLength: 1, maxLength: 10 }),
					async ([path1, path2], linkData) => {
						resetCrossRepoManager()
						manager = new CrossRepoManager()

						const repo1 = await manager.addRepository(path1)
						const repo2 = await manager.addRepository(path2)

						const expectedCounts: Record<string, number> = {}
						const addedLinks = new Set<string>()

						for (const [e1, e2, type] of linkData) {
							const linkKey = `${e1}-${e2}-${type}`
							if (!addedLinks.has(linkKey)) {
								manager.addCrossRepoLink({
									sourceRepoId: repo1.id,
									sourceEntityId: e1,
									targetRepoId: repo2.id,
									targetEntityId: e2,
									linkType: type,
								})
								addedLinks.add(linkKey)
								expectedCounts[type] = (expectedCounts[type] || 0) + 1
							}
						}

						const stats = manager.getStats()
						for (const [type, count] of Object.entries(expectedCounts)) {
							expect(stats.linksByType[type]).toBe(count)
						}
					},
				),
				{ numRuns: 50 },
			)
		})

		it("should return same repository when adding duplicate path", async () => {
			await fc.assert(
				fc.asyncProperty(repoPath, fc.integer({ min: 2, max: 5 }), async (p, times) => {
					resetCrossRepoManager()
					manager = new CrossRepoManager()

					const repos = []
					for (let i = 0; i < times; i++) {
						repos.push(await manager.addRepository(p))
					}

					// All should be the same repository
					const firstId = repos[0].id
					for (const repo of repos) {
						expect(repo.id).toBe(firstId)
					}

					// Should only have one repository
					expect(manager.getRepositories().length).toBe(1)
				}),
				{ numRuns: 100 },
			)
		})
	})
})
