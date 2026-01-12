// kilocode_change - new file

/**
 * Entity classes for context-aware completions
 * Provides data models with validation and state management
 */

import type {
	CompletionContext as CompletionContextType,
	ProjectContext as ProjectContextType,
	SemanticContext as SemanticContextType,
	FileReference,
	ConceptRelationship,
	ContextMetadata,
	ProjectMetadata,
	SemanticMetadata,
} from "./types"

/**
 * CompletionContext Entity
 * Manages the complete context for code completions including project and semantic information
 */
export class CompletionContextEntity implements CompletionContextType {
	id: string
	sessionId?: string
	filePath: string
	position: number
	surroundingCode: string
	projectContext: ProjectContextEntity
	semanticContext: SemanticContextEntity
	metadata?: ContextMetadata

	private constructor(data: CompletionContextType) {
		this.id = data.id
		this.sessionId = data.sessionId
		this.filePath = data.filePath
		this.position = data.position
		this.surroundingCode = data.surroundingCode
		this.projectContext = data.projectContext as ProjectContextEntity
		this.semanticContext = data.semanticContext as SemanticContextEntity
		this.metadata = data.metadata
	}

	/**
	 * Create a new CompletionContext
	 */
	static create(data: Omit<CompletionContextType, "id">): CompletionContextEntity {
		const id = `ctx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
		return new CompletionContextEntity({ ...data, id })
	}

	/**
	 * Validate the completion context
	 */
	validate(): boolean {
		if (!this.filePath || this.filePath.trim() === "") {
			return false
		}
		if (this.position < 0) {
			return false
		}
		if (!this.projectContext.validate()) {
			return false
		}
		if (!this.semanticContext.validate()) {
			return false
		}
		return true
	}

	/**
	 * Get context size in bytes
	 */
	getSize(): number {
		const surroundingCodeSize = new Blob([this.surroundingCode]).size
		const projectContextSize = this.projectContext.getSize()
		const semanticContextSize = this.semanticContext.getSize()
		return surroundingCodeSize + projectContextSize + semanticContextSize
	}

	/**
	 * Check if context is from cache
	 */
	isFromCache(): boolean {
		return false // Cache tracking is managed at service level
	}

	/**
	 * Update metadata
	 */
	updateMetadata(metadata: Partial<ContextMetadata>): void {
		this.metadata = { ...this.metadata, ...metadata }
	}

	/**
	 * Convert to plain object
	 */
	toJSON(): CompletionContextType {
		return {
			id: this.id,
			sessionId: this.sessionId,
			filePath: this.filePath,
			position: this.position,
			surroundingCode: this.surroundingCode,
			projectContext: this.projectContext.toJSON(),
			semanticContext: this.semanticContext.toJSON(),
			metadata: this.metadata,
		}
	}
}

/**
 * ProjectContext Entity
 * Manages project-level context including dependencies, recent files, and framework information
 */
export class ProjectContextEntity implements ProjectContextType {
	projectPath: string
	language: string
	framework?: string
	dependencies: string[]
	recentFiles: string[]
	gitBranch?: string
	metadata?: ProjectMetadata

	private constructor(data: ProjectContextType) {
		this.projectPath = data.projectPath
		this.language = data.language
		this.framework = data.framework
		this.dependencies = data.dependencies
		this.recentFiles = data.recentFiles
		this.gitBranch = data.gitBranch
		this.metadata = data.metadata
	}

	/**
	 * Create a new ProjectContext
	 */
	static create(data: Omit<ProjectContextType, "metadata">): ProjectContextEntity {
		return new ProjectContextEntity(data)
	}

	/**
	 * Validate the project context
	 */
	validate(): boolean {
		if (!this.projectPath || this.projectPath.trim() === "") {
			return false
		}
		if (!this.language || this.language.trim() === "") {
			return false
		}
		if (!Array.isArray(this.dependencies)) {
			return false
		}
		if (!Array.isArray(this.recentFiles)) {
			return false
		}
		return true
	}

	/**
	 * Get context size in bytes
	 */
	getSize(): number {
		const dependenciesSize = new Blob([this.dependencies.join(",")]).size
		const recentFilesSize = new Blob([this.recentFiles.join(",")]).size
		return dependenciesSize + recentFilesSize
	}

	/**
	 * Add a recent file
	 */
	addRecentFile(filePath: string): void {
		if (!this.recentFiles.includes(filePath)) {
			this.recentFiles.unshift(filePath)
			// Keep only the last 50 recent files
			if (this.recentFiles.length > 50) {
				this.recentFiles = this.recentFiles.slice(0, 50)
			}
		}
	}

	/**
	 * Remove a recent file
	 */
	removeRecentFile(filePath: string): void {
		this.recentFiles = this.recentFiles.filter((f) => f !== filePath)
	}

	/**
	 * Check if a dependency exists
	 */
	hasDependency(dependency: string): boolean {
		return this.dependencies.includes(dependency)
	}

	/**
	 * Add a dependency
	 */
	addDependency(dependency: string): void {
		if (!this.dependencies.includes(dependency)) {
			this.dependencies.push(dependency)
		}
	}

	/**
	 * Update metadata
	 */
	updateMetadata(metadata: Partial<ProjectMetadata>): void {
		this.metadata = { ...this.metadata, ...metadata }
	}

	/**
	 * Convert to plain object
	 */
	toJSON(): ProjectContextType {
		return {
			projectPath: this.projectPath,
			language: this.language,
			framework: this.framework,
			dependencies: this.dependencies,
			recentFiles: this.recentFiles,
			gitBranch: this.gitBranch,
			metadata: this.metadata,
		}
	}
}

/**
 * SemanticContext Entity
 * Manages semantic context including embeddings, relevant files, concepts, and relationships
 */
export class SemanticContextEntity implements SemanticContextType {
	embeddings: number[][]
	relevantFiles: FileReference[]
	concepts: string[]
	relationships: ConceptRelationship[]
	metadata?: SemanticMetadata

	private constructor(data: SemanticContextType) {
		this.embeddings = data.embeddings
		this.relevantFiles = data.relevantFiles
		this.concepts = data.concepts
		this.relationships = data.relationships
		this.metadata = data.metadata
	}

	/**
	 * Create a new SemanticContext
	 */
	static create(data: Omit<SemanticContextType, "metadata">): SemanticContextEntity {
		return new SemanticContextEntity(data)
	}

	/**
	 * Validate the semantic context
	 */
	validate(): boolean {
		if (!Array.isArray(this.embeddings)) {
			return false
		}
		if (!Array.isArray(this.relevantFiles)) {
			return false
		}
		if (!Array.isArray(this.concepts)) {
			return false
		}
		if (!Array.isArray(this.relationships)) {
			return false
		}
		// Validate embeddings
		for (const embedding of this.embeddings) {
			if (!Array.isArray(embedding)) {
				return false
			}
		}
		return true
	}

	/**
	 * Get context size in bytes
	 */
	getSize(): number {
		const embeddingsSize = this.embeddings.reduce((acc, emb) => acc + new Blob([emb.join(",")]).size, 0)
		const conceptsSize = new Blob([this.concepts.join(",")]).size
		return embeddingsSize + conceptsSize
	}

	/**
	 * Add a relevant file
	 */
	addRelevantFile(file: FileReference): void {
		if (!this.relevantFiles.find((f) => f.id === file.id)) {
			this.relevantFiles.push(file)
		}
	}

	/**
	 * Remove a relevant file
	 */
	removeRelevantFile(fileId: string): void {
		this.relevantFiles = this.relevantFiles.filter((f) => f.id !== fileId)
	}

	/**
	 * Add a concept
	 */
	addConcept(concept: string): void {
		if (!this.concepts.includes(concept)) {
			this.concepts.push(concept)
		}
	}

	/**
	 * Remove a concept
	 */
	removeConcept(concept: string): void {
		this.concepts = this.concepts.filter((c) => c !== concept)
	}

	/**
	 * Add a relationship
	 */
	addRelationship(relationship: ConceptRelationship): void {
		const exists = this.relationships.some(
			(r) =>
				r.concept1 === relationship.concept1 &&
				r.concept2 === relationship.concept2 &&
				r.relationshipType === relationship.relationshipType,
		)
		if (!exists) {
			this.relationships.push(relationship)
		}
	}

	/**
	 * Get relationships for a concept
	 */
	getRelationshipsForConcept(concept: string): ConceptRelationship[] {
		return this.relationships.filter((r) => r.concept1 === concept || r.concept2 === concept)
	}

	/**
	 * Get related concepts
	 */
	getRelatedConcepts(concept: string, minStrength: number = 0.5): string[] {
		const related = this.relationships
			.filter((r) => r.strength >= minStrength && (r.concept1 === concept || r.concept2 === concept))
			.map((r) => (r.concept1 === concept ? r.concept2 : r.concept1))
		return [...new Set(related)] // Remove duplicates
	}

	/**
	 * Update metadata
	 */
	updateMetadata(metadata: Partial<SemanticMetadata>): void {
		this.metadata = { ...this.metadata, ...metadata }
	}

	/**
	 * Convert to plain object
	 */
	toJSON(): SemanticContextType {
		return {
			embeddings: this.embeddings,
			relevantFiles: this.relevantFiles,
			concepts: this.concepts,
			relationships: this.relationships,
			metadata: this.metadata,
		}
	}
}

/**
 * Factory functions for creating entities
 */
export const CompletionContextFactory = {
	/**
	 * Create a minimal completion context
	 */
	createMinimal(filePath: string, position: number, surroundingCode: string): CompletionContextEntity {
		return CompletionContextEntity.create({
			filePath,
			position,
			surroundingCode,
			projectContext: ProjectContextEntity.create({
				projectPath: "",
				language: "",
				dependencies: [],
				recentFiles: [],
			}),
			semanticContext: SemanticContextEntity.create({
				embeddings: [],
				relevantFiles: [],
				concepts: [],
				relationships: [],
			}),
		})
	},

	/**
	 * Create a full completion context
	 */
	createFull(
		filePath: string,
		position: number,
		surroundingCode: string,
		projectContext: ProjectContextType,
		semanticContext: SemanticContextType,
		metadata?: ContextMetadata,
	): CompletionContextEntity {
		return CompletionContextEntity.create({
			filePath,
			position,
			surroundingCode,
			projectContext,
			semanticContext,
			metadata,
		})
	},
}

export const ProjectContextFactory = {
	/**
	 * Create a project context from file system scan
	 */
	createFromScan(
		projectPath: string,
		language: string,
		dependencies: string[],
		recentFiles: string[],
	): ProjectContextEntity {
		return ProjectContextEntity.create({
			projectPath,
			language,
			dependencies,
			recentFiles,
		})
	},
}

export const SemanticContextFactory = {
	/**
	 * Create a semantic context from search results
	 */
	createFromSearch(
		embeddings: number[][],
		relevantFiles: FileReference[],
		concepts: string[],
		relationships: ConceptRelationship[],
	): SemanticContextEntity {
		return SemanticContextEntity.create({
			embeddings,
			relevantFiles,
			concepts,
			relationships,
		})
	},
}
