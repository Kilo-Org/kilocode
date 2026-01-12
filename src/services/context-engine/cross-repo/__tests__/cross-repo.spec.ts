// kilocode_change - new file
import * as path from "path"
import * as os from "os"
import { CrossRepoManager, resetCrossRepoManager, getCrossRepoManager } from "../index"

describe("CrossRepoManager", () => {
	let manager: CrossRepoManager

	beforeEach(() => {
		resetCrossRepoManager()
		manager = new CrossRepoManager()
	})

	afterEach(() => {
		resetCrossRepoManager()
	})

	describe("repository management", () => {
		it("should add a repository", async () => {
			const repo = await manager.addRepository("/test/repo1", "TestRepo")

			expect(repo.name).toBe("TestRepo")
			expect(repo.rootPath).toBe(path.resolve("/test/repo1"))
			expect(repo.isPrimary).toBe(true)
			expect(repo.entityCount).toBe(0)
		})

		it("should use directory name if no name provided", async () => {
			const repo = await manager.addRepository("/test/my-project")

			expect(repo.name).toBe("my-project")
		})

		it("should set first repository as primary", async () => {
			const repo1 = await manager.addRepository("/test/repo1")
			const repo2 = await manager.addRepository("/test/repo2")

			expect(repo1.isPrimary).toBe(true)
			expect(repo2.isPrimary).toBe(false)
		})

		it("should return existing repository if already added", async () => {
			const repo1 = await manager.addRepository("/test/repo1")
			const repo2 = await manager.addRepository("/test/repo1")

			expect(repo1.id).toBe(repo2.id)
		})

		it("should remove a repository", async () => {
			const repo = await manager.addRepository("/test/repo1")
			manager.removeRepository(repo.id)

			expect(manager.getRepository(repo.id)).toBeUndefined()
		})

		it("should update primary when removing primary repository", async () => {
			const repo1 = await manager.addRepository("/test/repo1")
			const repo2 = await manager.addRepository("/test/repo2")

			manager.removeRepository(repo1.id)

			expect(manager.getPrimaryRepository()?.id).toBe(repo2.id)
		})

		it("should get all repositories", async () => {
			await manager.addRepository("/test/repo1")
			await manager.addRepository("/test/repo2")

			const repos = manager.getRepositories()
			expect(repos.length).toBe(2)
		})

		it("should get repository by ID", async () => {
			const repo = await manager.addRepository("/test/repo1")

			expect(manager.getRepository(repo.id)).toBe(repo)
		})

		it("should get repository by path", async () => {
			const repo = await manager.addRepository("/test/repo1")

			const found = manager.getRepositoryByPath("/test/repo1/src/file.ts")
			expect(found?.id).toBe(repo.id)
		})

		it("should return undefined for unknown path", () => {
			const found = manager.getRepositoryByPath("/unknown/path")
			expect(found).toBeUndefined()
		})

		it("should set primary repository", async () => {
			const repo1 = await manager.addRepository("/test/repo1")
			const repo2 = await manager.addRepository("/test/repo2")

			manager.setPrimaryRepository(repo2.id)

			expect(repo1.isPrimary).toBe(false)
			expect(repo2.isPrimary).toBe(true)
			expect(manager.getPrimaryRepository()?.id).toBe(repo2.id)
		})
	})

	describe("cross-repository links", () => {
		it("should add a cross-repo link", async () => {
			const repo1 = await manager.addRepository("/test/repo1")
			const repo2 = await manager.addRepository("/test/repo2")

			manager.addCrossRepoLink({
				sourceRepoId: repo1.id,
				sourceEntityId: "entity1",
				targetRepoId: repo2.id,
				targetEntityId: "entity2",
				linkType: "imports",
			})

			const links = manager.getAllCrossRepoLinks()
			expect(links.length).toBe(1)
		})

		it("should not add duplicate links", async () => {
			const repo1 = await manager.addRepository("/test/repo1")
			const repo2 = await manager.addRepository("/test/repo2")

			const link = {
				sourceRepoId: repo1.id,
				sourceEntityId: "entity1",
				targetRepoId: repo2.id,
				targetEntityId: "entity2",
				linkType: "imports" as const,
			}

			manager.addCrossRepoLink(link)
			manager.addCrossRepoLink(link)

			const links = manager.getAllCrossRepoLinks()
			expect(links.length).toBe(1)
		})

		it("should get links for an entity", async () => {
			const repo1 = await manager.addRepository("/test/repo1")
			const repo2 = await manager.addRepository("/test/repo2")

			manager.addCrossRepoLink({
				sourceRepoId: repo1.id,
				sourceEntityId: "entity1",
				targetRepoId: repo2.id,
				targetEntityId: "entity2",
				linkType: "imports",
			})

			const links = manager.getCrossRepoLinks("entity1")
			expect(links.length).toBe(1)
		})

		it("should get links for an entity in specific repo", async () => {
			const repo1 = await manager.addRepository("/test/repo1")
			const repo2 = await manager.addRepository("/test/repo2")

			manager.addCrossRepoLink({
				sourceRepoId: repo1.id,
				sourceEntityId: "entity1",
				targetRepoId: repo2.id,
				targetEntityId: "entity2",
				linkType: "imports",
			})

			const links = manager.getCrossRepoLinks("entity1", repo1.id)
			expect(links.length).toBe(1)

			const noLinks = manager.getCrossRepoLinks("entity1", "unknown-repo")
			expect(noLinks.length).toBe(0)
		})

		it("should remove links when repository is removed", async () => {
			const repo1 = await manager.addRepository("/test/repo1")
			const repo2 = await manager.addRepository("/test/repo2")

			manager.addCrossRepoLink({
				sourceRepoId: repo1.id,
				sourceEntityId: "entity1",
				targetRepoId: repo2.id,
				targetEntityId: "entity2",
				linkType: "imports",
			})

			manager.removeRepository(repo1.id)

			const links = manager.getAllCrossRepoLinks()
			expect(links.length).toBe(0)
		})

		it("should create link using helper method", async () => {
			const repo1 = await manager.addRepository("/test/repo1")
			const repo2 = await manager.addRepository("/test/repo2")

			const link = manager.createLink(repo1.id, "entity1", repo2.id, "entity2", "uses", {
				reason: "test",
			})

			expect(link.linkType).toBe("uses")
			expect(link.metadata?.reason).toBe("test")
		})
	})

	describe("entity count tracking", () => {
		it("should update entity count", async () => {
			const repo = await manager.addRepository("/test/repo1")

			manager.updateEntityCount(repo.id, 100)

			expect(repo.entityCount).toBe(100)
			expect(repo.lastIndexed).toBeInstanceOf(Date)
		})
	})

	describe("statistics", () => {
		it("should return stats", async () => {
			const repo1 = await manager.addRepository("/test/repo1")
			const repo2 = await manager.addRepository("/test/repo2")

			manager.updateEntityCount(repo1.id, 50)
			manager.updateEntityCount(repo2.id, 30)

			manager.addCrossRepoLink({
				sourceRepoId: repo1.id,
				sourceEntityId: "entity1",
				targetRepoId: repo2.id,
				targetEntityId: "entity2",
				linkType: "imports",
			})

			const stats = manager.getStats()

			expect(stats.repositoryCount).toBe(2)
			expect(stats.totalLinks).toBe(1)
			expect(stats.totalEntities).toBe(80)
			expect(stats.linksByType["imports"]).toBe(1)
		})
	})

	describe("singleton instance", () => {
		it("should return singleton instance", () => {
			const instance1 = getCrossRepoManager()
			const instance2 = getCrossRepoManager()
			expect(instance1).toBe(instance2)
		})
	})

	describe("shared dependencies", () => {
		it("should return empty array for now", () => {
			const deps = manager.findSharedDependencies()
			expect(deps).toEqual([])
		})
	})

	describe("cross-repo search", () => {
		it("should return empty array for now", async () => {
			const results = await manager.searchAcrossRepos("test")
			expect(results).toEqual([])
		})
	})
})
