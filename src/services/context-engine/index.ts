// kilocode_change - new file
/**
 * Advanced Context Engine
 *
 * Main entry point for the Context Engine service.
 * Provides unified access to AST parsing, Knowledge Graph, and context aggregation.
 */

// Re-export types
export * from "./types"

// Re-export Context Engine (main class)
export { ContextEngine, getContextEngine, resetContextEngine } from "./engine"
export type { IContextEngine, ContextEngineConfig, EngineStatus, EngineState } from "./engine"

// Re-export AST Parser
export { ASTParserService, getASTParserService, resetASTParserService, generateEntityId } from "./ast-parser"
export type { IASTParserService, ILanguageParser, SupportedLanguage, ParseOptions } from "./ast-parser"

// Re-export Knowledge Graph
export { KnowledgeGraph, getKnowledgeGraph, resetKnowledgeGraph } from "./knowledge-graph"
export type { IKnowledgeGraph, GraphOptions } from "./knowledge-graph"

// Re-export Git History Analyzer
export { GitHistoryAnalyzer, getGitHistoryAnalyzer, resetGitHistoryAnalyzer } from "./git-analyzer"
export type {
	IGitHistoryAnalyzer,
	GitAnalyzerOptions,
	CommitInfo,
	Contributor,
	Hotspot,
	FileChange,
} from "./git-analyzer"

// Re-export Pattern Detector
export {
	PatternDetectorService,
	getPatternDetectorService,
	resetPatternDetectorService,
	RepositoryPatternDetector,
	FactoryPatternDetector,
	SingletonPatternDetector,
	ServicePatternDetector,
} from "./pattern-detector"
export type {
	IPatternDetectorService,
	IPatternDetector,
	DetectedPattern,
	PatternType,
	ConfidenceLevel,
	PatternEntity,
	PatternRelationship,
	PatternDetectorOptions,
} from "./pattern-detector"

// Re-export Cross-Repository Manager
export { CrossRepoManager, getCrossRepoManager, resetCrossRepoManager } from "./cross-repo"
export type {
	ICrossRepoManager,
	RepositoryInfo,
	CrossRepoLink,
	CrossRepoLinkType,
	SharedDependency,
	CrossRepoSearchOptions,
	CrossRepoSearchResult,
	CrossRepoStats,
} from "./cross-repo"

// Re-export Hybrid Search Service
export { HybridSearchService, getHybridSearchService, resetHybridSearchService } from "./search"
export type {
	IHybridSearchService,
	SearchResult,
	SearchOptions,
	SearchWeights,
	SearchServiceConfig,
	ScoreBreakdown,
	RelationshipPath,
	MatchHighlight,
} from "./search"

// Re-export Context Aggregator
export { ContextAggregator, getContextAggregator, resetContextAggregator } from "./aggregator"
export type {
	IContextAggregator,
	AggregatedContext,
	ContextOptions,
	AggregatorConfig,
	RelatedEntityGroup,
	ImportContext,
	ExportContext,
	PrioritizationStrategy,
} from "./aggregator"

// Re-export Performance Configuration
export {
	PERFORMANCE_CONFIG,
	PERFORMANCE_PARSE_OPTIONS,
	DEV_CONFIG,
	getOptimalConfig,
	shouldEnableContextEngine,
} from "./performance-config"

// Re-export Performance Monitor
export {
	PerformanceMonitor,
	getPerformanceMonitor,
	resetPerformanceMonitor,
	monitorPerformance,
} from "./performance-monitor"
export type { PerformanceMetrics, PerformanceThresholds } from "./performance-monitor"
