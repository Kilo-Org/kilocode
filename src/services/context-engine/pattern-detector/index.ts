// kilocode_change - new file
/**
 * Pattern Detector Service
 *
 * Detects architectural patterns in code by analyzing entities
 * and their relationships from the Knowledge Graph.
 */

import { CodeEntity } from "../types"
import {
	IPatternDetectorService,
	IPatternDetector,
	DetectedPattern,
	PatternType,
	PatternDetectorOptions,
} from "./types"

// Re-export types
export * from "./types"

const DEFAULT_OPTIONS: PatternDetectorOptions = {
	minConfidence: 0.5,
	patternTypes: [],
}

/**
 * Pattern Detector Service implementation
 */
export class PatternDetectorService implements IPatternDetectorService {
	private detectors: Map<PatternType, IPatternDetector> = new Map()
	private options: PatternDetectorOptions

	constructor(options: Partial<PatternDetectorOptions> = {}) {
		this.options = { ...DEFAULT_OPTIONS, ...options }
	}

	/**
	 * Register a pattern detector
	 */
	registerDetector(detector: IPatternDetector): void {
		this.detectors.set(detector.patternType, detector)
	}

	/**
	 * Detect all patterns in the given entities
	 */
	detectPatterns(
		entities: CodeEntity[],
		getRelatedEntities: (entityId: string, depth?: number) => CodeEntity[],
	): DetectedPattern[] {
		const patterns: DetectedPattern[] = []

		for (const detector of this.detectors.values()) {
			const detected = detector.detect(entities, getRelatedEntities)
			patterns.push(...detected)
		}

		// Filter by minimum confidence
		return patterns
			.filter((p) => p.confidenceScore >= (this.options.minConfidence ?? 0))
			.sort((a, b) => b.confidenceScore - a.confidenceScore)
	}

	/**
	 * Detect specific pattern types
	 */
	detectPatternTypes(
		patternTypes: PatternType[],
		entities: CodeEntity[],
		getRelatedEntities: (entityId: string, depth?: number) => CodeEntity[],
	): DetectedPattern[] {
		const patterns: DetectedPattern[] = []

		for (const patternType of patternTypes) {
			const detector = this.detectors.get(patternType)
			if (detector) {
				const detected = detector.detect(entities, getRelatedEntities)
				patterns.push(...detected)
			}
		}

		return patterns
			.filter((p) => p.confidenceScore >= (this.options.minConfidence ?? 0))
			.sort((a, b) => b.confidenceScore - a.confidenceScore)
	}

	/**
	 * Get all registered pattern types
	 */
	getRegisteredPatterns(): PatternType[] {
		return Array.from(this.detectors.keys())
	}
}

/**
 * Create a singleton instance with default detectors
 */
let instance: PatternDetectorService | null = null

export function getPatternDetectorService(options?: Partial<PatternDetectorOptions>): PatternDetectorService {
	if (!instance) {
		instance = new PatternDetectorService(options)
		// Register default detectors
		registerDefaultDetectors(instance)
	}
	return instance
}

export function resetPatternDetectorService(): void {
	instance = null
}

/**
 * Register default pattern detectors
 */
function registerDefaultDetectors(service: PatternDetectorService): void {
	// Import and register detectors
	service.registerDetector(new RepositoryPatternDetector())
	service.registerDetector(new FactoryPatternDetector())
	service.registerDetector(new SingletonPatternDetector())
	service.registerDetector(new ServicePatternDetector())
}

// ============================================================================
// Pattern Detector Implementations
// ============================================================================

/**
 * Repository Pattern Detector
 * Detects classes/interfaces that follow the repository pattern
 */
export class RepositoryPatternDetector implements IPatternDetector {
	readonly patternType: PatternType = "repository"

	detect(
		entities: CodeEntity[],
		_getRelatedEntities: (entityId: string, depth?: number) => CodeEntity[],
	): DetectedPattern[] {
		const patterns: DetectedPattern[] = []
		const repositoryNamePattern = /repository|repo|store|dao/i
		const repositoryMethodPattern = /^(find|get|save|update|delete|create|remove|add|fetch|load)/i

		// Find potential repository classes/interfaces
		const potentialRepos = entities.filter((e) => {
			if (e.type !== "class" && e.type !== "interface") return false
			return repositoryNamePattern.test(e.name)
		})

		for (const repo of potentialRepos) {
			// Check for repository-like methods
			const methods = entities.filter(
				(e) => e.type === "function" && e.filePath === repo.filePath && repositoryMethodPattern.test(e.name),
			)

			const hasRepoMethods = methods.length >= 2
			const hasRepoName = repositoryNamePattern.test(repo.name)

			let confidenceScore = 0
			if (hasRepoName) confidenceScore += 0.5
			if (hasRepoMethods) confidenceScore += 0.3
			if (methods.length >= 4) confidenceScore += 0.2

			if (confidenceScore >= 0.5) {
				patterns.push({
					type: "repository",
					confidence: confidenceScore >= 0.8 ? "high" : confidenceScore >= 0.6 ? "medium" : "low",
					confidenceScore,
					entities: [
						{ entityId: repo.id, role: "repository", name: repo.name, filePath: repo.filePath },
						...methods.map((m) => ({
							entityId: m.id,
							role: "method",
							name: m.name,
							filePath: m.filePath,
						})),
					],
					filePaths: [repo.filePath],
					description: `Repository pattern: ${repo.name} with ${methods.length} data access methods`,
					relationships: methods.map((m) => ({
						sourceId: repo.id,
						targetId: m.id,
						type: "defines" as const,
						roleDescription: "defines repository method",
					})),
				})
			}
		}

		return patterns
	}
}

/**
 * Factory Pattern Detector
 * Detects factory classes/functions
 */
export class FactoryPatternDetector implements IPatternDetector {
	readonly patternType: PatternType = "factory"

	detect(
		entities: CodeEntity[],
		_getRelatedEntities: (entityId: string, depth?: number) => CodeEntity[],
	): DetectedPattern[] {
		const patterns: DetectedPattern[] = []
		const factoryNamePattern = /factory|builder|creator/i
		const factoryMethodPattern = /^(create|make|build|new|get|produce)/i

		// Find factory classes
		const factoryClasses = entities.filter((e) => {
			if (e.type !== "class") return false
			return factoryNamePattern.test(e.name)
		})

		for (const factory of factoryClasses) {
			const methods = entities.filter(
				(e) => e.type === "function" && e.filePath === factory.filePath && factoryMethodPattern.test(e.name),
			)

			let confidenceScore = 0
			if (factoryNamePattern.test(factory.name)) confidenceScore += 0.5
			if (methods.length >= 1) confidenceScore += 0.3
			if (methods.length >= 3) confidenceScore += 0.2

			if (confidenceScore >= 0.5) {
				patterns.push({
					type: "factory",
					confidence: confidenceScore >= 0.8 ? "high" : confidenceScore >= 0.6 ? "medium" : "low",
					confidenceScore,
					entities: [
						{ entityId: factory.id, role: "factory", name: factory.name, filePath: factory.filePath },
						...methods.map((m) => ({
							entityId: m.id,
							role: "creator-method",
							name: m.name,
							filePath: m.filePath,
						})),
					],
					filePaths: [factory.filePath],
					description: `Factory pattern: ${factory.name} with ${methods.length} creation methods`,
					relationships: methods.map((m) => ({
						sourceId: factory.id,
						targetId: m.id,
						type: "defines" as const,
						roleDescription: "defines factory method",
					})),
				})
			}
		}

		// Also detect standalone factory functions
		const factoryFunctions = entities.filter((e) => {
			if (e.type !== "function") return false
			return factoryNamePattern.test(e.name) || /^create[A-Z]/.test(e.name)
		})

		for (const fn of factoryFunctions) {
			patterns.push({
				type: "factory",
				confidence: "medium",
				confidenceScore: 0.6,
				entities: [{ entityId: fn.id, role: "factory-function", name: fn.name, filePath: fn.filePath }],
				filePaths: [fn.filePath],
				description: `Factory function: ${fn.name}`,
				relationships: [],
			})
		}

		return patterns
	}
}

/**
 * Singleton Pattern Detector
 * Detects singleton implementations
 */
export class SingletonPatternDetector implements IPatternDetector {
	readonly patternType: PatternType = "singleton"

	detect(
		entities: CodeEntity[],
		_getRelatedEntities: (entityId: string, depth?: number) => CodeEntity[],
	): DetectedPattern[] {
		const patterns: DetectedPattern[] = []
		const singletonIndicators = /instance|singleton|shared|global/i
		const getInstancePattern = /^(get|shared|default)Instance$/i

		// Find classes with singleton indicators
		const classes = entities.filter((e) => e.type === "class")

		for (const cls of classes) {
			const classEntities = entities.filter((e) => e.filePath === cls.filePath)

			// Look for getInstance method
			const hasGetInstance = classEntities.some(
				(e) => e.type === "function" && (getInstancePattern.test(e.name) || e.name === "getInstance"),
			)

			// Look for private instance variable
			const hasInstanceVar = classEntities.some((e) => e.type === "variable" && singletonIndicators.test(e.name))

			// Look for singleton in name
			const hasSingletonName = singletonIndicators.test(cls.name)

			let confidenceScore = 0
			if (hasGetInstance) confidenceScore += 0.5
			if (hasInstanceVar) confidenceScore += 0.3
			if (hasSingletonName) confidenceScore += 0.2

			if (confidenceScore >= 0.5) {
				patterns.push({
					type: "singleton",
					confidence: confidenceScore >= 0.8 ? "high" : confidenceScore >= 0.6 ? "medium" : "low",
					confidenceScore,
					entities: [{ entityId: cls.id, role: "singleton", name: cls.name, filePath: cls.filePath }],
					filePaths: [cls.filePath],
					description: `Singleton pattern: ${cls.name}`,
					relationships: [],
				})
			}
		}

		return patterns
	}
}

/**
 * Service Pattern Detector
 * Detects service layer classes
 */
export class ServicePatternDetector implements IPatternDetector {
	readonly patternType: PatternType = "service"

	detect(
		entities: CodeEntity[],
		_getRelatedEntities: (entityId: string, depth?: number) => CodeEntity[],
	): DetectedPattern[] {
		const patterns: DetectedPattern[] = []
		const serviceNamePattern = /service|manager|handler|provider|helper|util/i

		// Find service classes
		const serviceClasses = entities.filter((e) => {
			if (e.type !== "class" && e.type !== "interface") return false
			return serviceNamePattern.test(e.name)
		})

		for (const service of serviceClasses) {
			const methods = entities.filter((e) => e.type === "function" && e.filePath === service.filePath)

			let confidenceScore = 0
			if (serviceNamePattern.test(service.name)) confidenceScore += 0.6
			if (methods.length >= 2) confidenceScore += 0.2
			if (methods.length >= 5) confidenceScore += 0.2

			if (confidenceScore >= 0.5) {
				patterns.push({
					type: "service",
					confidence: confidenceScore >= 0.8 ? "high" : confidenceScore >= 0.6 ? "medium" : "low",
					confidenceScore,
					entities: [
						{ entityId: service.id, role: "service", name: service.name, filePath: service.filePath },
						...methods.slice(0, 5).map((m) => ({
							entityId: m.id,
							role: "method",
							name: m.name,
							filePath: m.filePath,
						})),
					],
					filePaths: [service.filePath],
					description: `Service layer: ${service.name} with ${methods.length} methods`,
					relationships: methods.slice(0, 5).map((m) => ({
						sourceId: service.id,
						targetId: m.id,
						type: "defines" as const,
						roleDescription: "defines service method",
					})),
				})
			}
		}

		return patterns
	}
}
