// kilocode_change - new file
/**
 * Cross-Repository Support - Type Definitions
 */

import { CodeEntity, EntityRelationship } from "../types"

/**
 * Information about a repository
 */
export interface RepositoryInfo {
	/** Unique identifier for the repository */
	id: string
	/** Repository name */
	name: string
	/** Root path of the repository */
	rootPath: string
	/** Whether this is the primary/active repository */
	isPrimary: boolean
	/** Last indexed timestamp */
	lastIndexed?: Date
	/** Number of indexed entities */
	entityCount: number
}

/**
 * A link between entities in different repositories
 */
export interface CrossRepoLink {
	/** Source repository ID */
	sourceRepoId: string
	/** Source entity ID */
	sourceEntityId: string
	/** Target repository ID */
	targetRepoId: string
	/** Target entity ID */
	targetEntityId: string
	/** Type of link */
	linkType: CrossRepoLinkType
	/** Additional metadata */
	metadata?: Record<string, unknown>
}

/**
 * Types of cross-repository links
 */
export type CrossRepoLinkType = "imports" | "extends" | "implements" | "uses" | "shared-dependency" | "similar-pattern"

/**
 * Interface for Cross-Repository Manager
 */
export interface ICrossRepoManager {
	/**
	 * Add a repository to manage
	 */
	addRepository(rootPath: string, name?: string): Promise<RepositoryInfo>

	/**
	 * Remove a repository
	 */
	removeRepository(repoId: string): void

	/**
	 * Get all managed repositories
	 */
	getRepositories(): RepositoryInfo[]

	/**
	 * Get repository by ID
	 */
	getRepository(repoId: string): RepositoryInfo | undefined

	/**
	 * Get repository by path
	 */
	getRepositoryByPath(path: string): RepositoryInfo | undefined

	/**
	 * Set the primary repository
	 */
	setPrimaryRepository(repoId: string): void

	/**
	 * Get the primary repository
	 */
	getPrimaryRepository(): RepositoryInfo | undefined

	/**
	 * Add a cross-repository link
	 */
	addCrossRepoLink(link: CrossRepoLink): void

	/**
	 * Get cross-repository links for an entity
	 */
	getCrossRepoLinks(entityId: string, repoId?: string): CrossRepoLink[]

	/**
	 * Get all cross-repository links
	 */
	getAllCrossRepoLinks(): CrossRepoLink[]

	/**
	 * Find shared dependencies between repositories
	 */
	findSharedDependencies(): SharedDependency[]

	/**
	 * Search across all repositories
	 */
	searchAcrossRepos(query: string, options?: CrossRepoSearchOptions): Promise<CrossRepoSearchResult[]>
}

/**
 * A shared dependency between repositories
 */
export interface SharedDependency {
	/** Dependency name (e.g., package name) */
	name: string
	/** Repositories using this dependency */
	repositories: string[]
	/** Version information per repository */
	versions: Map<string, string>
}

/**
 * Options for cross-repository search
 */
export interface CrossRepoSearchOptions {
	/** Limit results per repository */
	limitPerRepo?: number
	/** Repository IDs to search (empty = all) */
	repoIds?: string[]
	/** Entity types to search */
	entityTypes?: CodeEntity["type"][]
}

/**
 * Result from cross-repository search
 */
export interface CrossRepoSearchResult {
	/** Repository info */
	repository: RepositoryInfo
	/** Matching entity */
	entity: CodeEntity
	/** Relevance score */
	score: number
	/** Related entities in other repos */
	crossRepoRelations: CrossRepoLink[]
}
