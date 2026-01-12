// kilocode_change - new file
/**
 * Cross-Repository Manager
 *
 * Manages multiple repositories and creates links between
 * entities across different codebases.
 */

import * as path from "path"
import * as crypto from "crypto"
import { CodeEntity } from "../types"
import {
	ICrossRepoManager,
	RepositoryInfo,
	CrossRepoLink,
	CrossRepoLinkType,
	SharedDependency,
	CrossRepoSearchOptions,
	CrossRepoSearchResult,
} from "./types"

// Re-export types
export * from "./types"

/**
 * Cross-Repository Manager implementation
 */
export class CrossRepoManager implements ICrossRepoManager {
	private repositories: Map<string, RepositoryInfo> = new Map()
	private crossRepoLinks: CrossRepoLink[] = []
	private primaryRepoId: string | null = null

	/**
	 * Add a repository to manage
	 */
	async addRepository(rootPath: string, name?: string): Promise<RepositoryInfo> {
		const normalizedPath = path.resolve(rootPath)
		const repoId = this.generateRepoId(normalizedPath)

		// Check if already exists
		const existing = this.repositories.get(repoId)
		if (existing) {
			return existing
		}

		const repoName = name || path.basename(normalizedPath)
		const isPrimary = this.repositories.size === 0

		const repoInfo: RepositoryInfo = {
			id: repoId,
			name: repoName,
			rootPath: normalizedPath,
			isPrimary,
			entityCount: 0,
		}

		this.repositories.set(repoId, repoInfo)

		if (isPrimary) {
			this.primaryRepoId = repoId
		}

		return repoInfo
	}

	/**
	 * Remove a repository
	 */
	removeRepository(repoId: string): void {
		this.repositories.delete(repoId)

		// Remove associated cross-repo links
		this.crossRepoLinks = this.crossRepoLinks.filter(
			(link) => link.sourceRepoId !== repoId && link.targetRepoId !== repoId,
		)

		// Update primary if needed
		if (this.primaryRepoId === repoId) {
			const firstRepo = this.repositories.values().next().value
			this.primaryRepoId = firstRepo?.id || null
			if (firstRepo) {
				firstRepo.isPrimary = true
			}
		}
	}

	/**
	 * Get all managed repositories
	 */
	getRepositories(): RepositoryInfo[] {
		return Array.from(this.repositories.values())
	}

	/**
	 * Get repository by ID
	 */
	getRepository(repoId: string): RepositoryInfo | undefined {
		return this.repositories.get(repoId)
	}

	/**
	 * Get repository by path
	 */
	getRepositoryByPath(filePath: string): RepositoryInfo | undefined {
		const normalizedPath = path.resolve(filePath)

		for (const repo of this.repositories.values()) {
			if (normalizedPath.startsWith(repo.rootPath)) {
				return repo
			}
		}

		return undefined
	}

	/**
	 * Set the primary repository
	 */
	setPrimaryRepository(repoId: string): void {
		const repo = this.repositories.get(repoId)
		if (!repo) return

		// Clear previous primary
		if (this.primaryRepoId) {
			const prevPrimary = this.repositories.get(this.primaryRepoId)
			if (prevPrimary) {
				prevPrimary.isPrimary = false
			}
		}

		repo.isPrimary = true
		this.primaryRepoId = repoId
	}

	/**
	 * Get the primary repository
	 */
	getPrimaryRepository(): RepositoryInfo | undefined {
		if (!this.primaryRepoId) return undefined
		return this.repositories.get(this.primaryRepoId)
	}

	/**
	 * Add a cross-repository link
	 */
	addCrossRepoLink(link: CrossRepoLink): void {
		// Check for duplicates
		const exists = this.crossRepoLinks.some(
			(l) =>
				l.sourceRepoId === link.sourceRepoId &&
				l.sourceEntityId === link.sourceEntityId &&
				l.targetRepoId === link.targetRepoId &&
				l.targetEntityId === link.targetEntityId &&
				l.linkType === link.linkType,
		)

		if (!exists) {
			this.crossRepoLinks.push(link)
		}
	}

	/**
	 * Get cross-repository links for an entity
	 */
	getCrossRepoLinks(entityId: string, repoId?: string): CrossRepoLink[] {
		return this.crossRepoLinks.filter((link) => {
			const matchesEntity = link.sourceEntityId === entityId || link.targetEntityId === entityId

			if (repoId) {
				return matchesEntity && (link.sourceRepoId === repoId || link.targetRepoId === repoId)
			}

			return matchesEntity
		})
	}

	/**
	 * Get all cross-repository links
	 */
	getAllCrossRepoLinks(): CrossRepoLink[] {
		return [...this.crossRepoLinks]
	}

	/**
	 * Find shared dependencies between repositories
	 */
	findSharedDependencies(): SharedDependency[] {
		// This would typically analyze package.json files
		// For now, return empty - will be implemented with actual dependency analysis
		return []
	}

	/**
	 * Search across all repositories
	 */
	async searchAcrossRepos(_query: string, _options?: CrossRepoSearchOptions): Promise<CrossRepoSearchResult[]> {
		// This would integrate with the search service
		// For now, return empty - will be implemented with search integration
		return []
	}

	/**
	 * Create a link between entities in different repositories
	 */
	createLink(
		sourceRepoId: string,
		sourceEntityId: string,
		targetRepoId: string,
		targetEntityId: string,
		linkType: CrossRepoLinkType,
		metadata?: Record<string, unknown>,
	): CrossRepoLink {
		const link: CrossRepoLink = {
			sourceRepoId,
			sourceEntityId,
			targetRepoId,
			targetEntityId,
			linkType,
			metadata,
		}

		this.addCrossRepoLink(link)
		return link
	}

	/**
	 * Update entity count for a repository
	 */
	updateEntityCount(repoId: string, count: number): void {
		const repo = this.repositories.get(repoId)
		if (repo) {
			repo.entityCount = count
			repo.lastIndexed = new Date()
		}
	}

	/**
	 * Get statistics about cross-repository relationships
	 */
	getStats(): CrossRepoStats {
		const linksByType = new Map<CrossRepoLinkType, number>()

		for (const link of this.crossRepoLinks) {
			const count = linksByType.get(link.linkType) || 0
			linksByType.set(link.linkType, count + 1)
		}

		return {
			repositoryCount: this.repositories.size,
			totalLinks: this.crossRepoLinks.length,
			linksByType: Object.fromEntries(linksByType),
			totalEntities: Array.from(this.repositories.values()).reduce((sum, r) => sum + r.entityCount, 0),
		}
	}

	// ============================================================================
	// Private Helpers
	// ============================================================================

	private generateRepoId(rootPath: string): string {
		return crypto.createHash("md5").update(rootPath).digest("hex").substring(0, 12)
	}
}

/**
 * Statistics about cross-repository relationships
 */
export interface CrossRepoStats {
	repositoryCount: number
	totalLinks: number
	linksByType: Record<string, number>
	totalEntities: number
}

/**
 * Create a singleton instance
 */
let instance: CrossRepoManager | null = null

export function getCrossRepoManager(): CrossRepoManager {
	if (!instance) {
		instance = new CrossRepoManager()
	}
	return instance
}

export function resetCrossRepoManager(): void {
	instance = null
}
