# Design Document: Advanced Context Engine

## Overview

هذا التصميم يحدد بنية Advanced Context Engine لـ Kilo Code - نظام متقدم لفهم السياق يجمع بين Knowledge Graph و Vector Embeddings و Git History لتوفير سياق غني ودقيق للـ AI coding assistant.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Advanced Context Engine                          │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │   AST Parser    │  │  Git History    │  │ Pattern         │         │
│  │   Service       │  │  Analyzer       │  │ Detector        │         │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘         │
│           │                    │                    │                   │
│           ▼                    ▼                    ▼                   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      Knowledge Graph                             │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │   │
│  │  │  Nodes   │  │  Edges   │  │ Patterns │  │ History  │        │   │
│  │  │(Entities)│  │(Relations)│  │  Tags    │  │  Data    │        │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│           │                                                             │
│           ▼                                                             │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Semantic Index (Hybrid)                       │   │
│  │  ┌──────────────────┐  ┌──────────────────┐                     │   │
│  │  │  Vector Store    │  │  Graph Traversal │                     │   │
│  │  │  (Embeddings)    │  │  (Relationships) │                     │   │
│  │  └──────────────────┘  └──────────────────┘                     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│           │                                                             │
│           ▼                                                             │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Context Aggregator                            │   │
│  │  - Relevance Ranking                                             │   │
│  │  - Token Budget Management                                       │   │
│  │  - Cross-Repo Linking                                            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│           │                                                             │
│           ▼                                                             │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Context Engine API                            │   │
│  │  - getContext(query, options)                                    │   │
│  │  - search(query, filters)                                        │   │
│  │  - getRelatedEntities(entity)                                    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Integration with Existing System

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           extension.ts                                   │
│  ┌─────────────────┐                    ┌─────────────────┐             │
│  │ CodeIndexManager│◄──────────────────►│ ContextEngine   │             │
│  │ (existing)      │   shares embedder  │ (new)           │             │
│  └─────────────────┘                    └─────────────────┘             │
│           │                                      │                       │
│           ▼                                      ▼                       │
│  ┌─────────────────┐                    ┌─────────────────┐             │
│  │ Vector Store    │                    │ Knowledge Graph │             │
│  │ (Qdrant)        │◄──────────────────►│ (new)           │             │
│  └─────────────────┘   hybrid search    └─────────────────┘             │
└─────────────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. AST Parser Service

```typescript
interface IASTParser {
	parse(filePath: string, content: string): Promise<ParseResult>
	getSupportedLanguages(): string[]
	registerParser(language: string, parser: ILanguageParser): void
}

interface ParseResult {
	entities: CodeEntity[]
	relationships: EntityRelationship[]
	errors: ParseError[]
}

interface CodeEntity {
	id: string
	name: string
	type: EntityType
	filePath: string
	startLine: number
	endLine: number
	signature?: string
	docstring?: string
	metadata: Record<string, unknown>
}

type EntityType = "function" | "class" | "interface" | "type" | "variable" | "import" | "export" | "method" | "property"

interface EntityRelationship {
	sourceId: string
	targetId: string
	type: RelationshipType
	metadata?: Record<string, unknown>
}

type RelationshipType =
	| "calls"
	| "imports"
	| "exports"
	| "extends"
	| "implements"
	| "uses"
	| "defines"
	| "returns"
	| "parameter"
```

### 2. Knowledge Graph

```typescript
interface IKnowledgeGraph {
	// Node operations
	addNode(entity: CodeEntity): Promise<void>
	updateNode(entityId: string, updates: Partial<CodeEntity>): Promise<void>
	removeNode(entityId: string): Promise<void>
	getNode(entityId: string): Promise<CodeEntity | null>

	// Edge operations
	addEdge(relationship: EntityRelationship): Promise<void>
	removeEdge(sourceId: string, targetId: string, type: RelationshipType): Promise<void>
	getEdges(entityId: string, direction: "in" | "out" | "both"): Promise<EntityRelationship[]>

	// Traversal
	traverse(startId: string, options: TraversalOptions): Promise<TraversalResult>
	findPath(sourceId: string, targetId: string): Promise<EntityRelationship[]>

	// Queries
	findEntities(query: EntityQuery): Promise<CodeEntity[]>
	getRelatedEntities(entityId: string, depth: number): Promise<CodeEntity[]>

	// Persistence
	save(): Promise<void>
	load(): Promise<void>
	clear(): Promise<void>
}

interface TraversalOptions {
	maxDepth: number
	relationshipTypes?: RelationshipType[]
	entityTypes?: EntityType[]
	limit?: number
}

interface TraversalResult {
	nodes: CodeEntity[]
	edges: EntityRelationship[]
	paths: EntityRelationship[][]
}
```

### 3. Git History Analyzer

```typescript
interface IGitHistoryAnalyzer {
	initialize(repoPath: string): Promise<void>
	getFileHistory(filePath: string, limit?: number): Promise<CommitInfo[]>
	getContributors(filePath: string): Promise<Contributor[]>
	getHotspots(limit?: number): Promise<Hotspot[]>
	getRecentChanges(since: Date): Promise<FileChange[]>
	isAvailable(): boolean
}

interface CommitInfo {
	hash: string
	author: string
	date: Date
	message: string
	filesChanged: string[]
}

interface Contributor {
	name: string
	email: string
	commitCount: number
	lastCommit: Date
}

interface Hotspot {
	filePath: string
	changeFrequency: number
	contributors: number
	lastModified: Date
}

interface FileChange {
	filePath: string
	changeType: "added" | "modified" | "deleted"
	commit: CommitInfo
}
```

### 4. Pattern Detector

```typescript
interface IPatternDetector {
	analyze(graph: IKnowledgeGraph): Promise<DetectedPattern[]>
	detectPattern(patternType: PatternType, entities: CodeEntity[]): Promise<PatternMatch | null>
	getSupportedPatterns(): PatternType[]
}

type PatternType =
	| "repository"
	| "factory"
	| "singleton"
	| "mvc"
	| "mvvm"
	| "service-layer"
	| "dependency-injection"
	| "observer"
	| "strategy"

interface DetectedPattern {
	type: PatternType
	confidence: number
	entities: CodeEntity[]
	description: string
}

interface PatternMatch {
	matched: boolean
	confidence: number
	matchedEntities: CodeEntity[]
}
```

### 5. Context Aggregator

```typescript
interface IContextAggregator {
	getContext(request: ContextRequest): Promise<AggregatedContext>
	rankContext(items: ContextItem[], criteria: RankingCriteria): ContextItem[]
	truncateContext(context: AggregatedContext, tokenLimit: number): AggregatedContext
}

interface ContextRequest {
	currentFile: string
	cursorPosition?: Position
	query?: string
	tokenBudget: number
	includeHistory?: boolean
	includePatterns?: boolean
}

interface AggregatedContext {
	currentFile: FileContext
	relatedFiles: FileContext[]
	entities: CodeEntity[]
	relationships: EntityRelationship[]
	patterns: DetectedPattern[]
	history: FileChange[]
	relevanceScores: Map<string, number>
}

interface FileContext {
	path: string
	content: string
	entities: CodeEntity[]
	relevanceScore: number
}

interface RankingCriteria {
	proximityWeight: number // Distance in graph
	relationshipWeight: number // Strength of relationship
	recencyWeight: number // How recently modified
	frequencyWeight: number // How often accessed/modified
}
```

### 6. Context Engine API

```typescript
interface IContextEngine {
	// Initialization
	initialize(workspacePaths: string[]): Promise<void>
	dispose(): void

	// Context retrieval
	getContext(request: ContextRequest): Promise<AggregatedContext>

	// Search
	search(query: string, filters?: SearchFilters): Promise<SearchResult[]>

	// Entity operations
	getEntity(entityId: string): Promise<CodeEntity | null>
	getRelatedEntities(entityId: string, options?: RelatedOptions): Promise<CodeEntity[]>

	// Real-time updates
	onFileChanged(filePath: string, content: string): Promise<void>
	onFileSaved(filePath: string): Promise<void>
	onFileDeleted(filePath: string): Promise<void>

	// Status
	getStatus(): EngineStatus
	onStatusChanged: vscode.Event<EngineStatus>
}

interface SearchFilters {
	fileTypes?: string[]
	directories?: string[]
	entityTypes?: EntityType[]
	patterns?: PatternType[]
	contributors?: string[]
	modifiedAfter?: Date
}

interface SearchResult {
	entity: CodeEntity
	relevanceScore: number
	relationshipPath?: EntityRelationship[]
	snippet: string
}

interface EngineStatus {
	state: "initializing" | "ready" | "indexing" | "error"
	indexedFiles: number
	totalEntities: number
	lastUpdate: Date
	error?: string
}
```

## Data Models

### Knowledge Graph Storage

```typescript
// Graph stored as adjacency list with node data
interface GraphStorage {
	nodes: Map<string, CodeEntity>
	adjacencyList: Map<string, EdgeList>
	reverseAdjacencyList: Map<string, EdgeList> // For efficient reverse lookups
	metadata: GraphMetadata
}

interface EdgeList {
	edges: Map<string, EntityRelationship[]> // targetId -> relationships
}

interface GraphMetadata {
	version: string
	createdAt: Date
	lastModified: Date
	nodeCount: number
	edgeCount: number
	workspacePaths: string[]
}
```

### Serialization Format

```typescript
// JSON format for persistence
interface SerializedGraph {
	version: string
	metadata: GraphMetadata
	nodes: SerializedNode[]
	edges: SerializedEdge[]
}

interface SerializedNode {
	id: string
	data: CodeEntity
}

interface SerializedEdge {
	source: string
	target: string
	relationship: EntityRelationship
}
```

## Correctness Properties

_A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees._

### Property 1: Entity Extraction Completeness

_For any_ valid source code file in a supported language, parsing the file SHALL extract all declared entities (functions, classes, interfaces, types, variables) with correct metadata (name, type, location).

**Validates: Requirements 1.1, 2.1, 2.2**

### Property 2: Relationship Creation Correctness

_For any_ code entity that references another entity (via call, import, extend, implement, or use), the Knowledge Graph SHALL contain an edge representing that relationship with the correct type.

**Validates: Requirements 1.2, 1.4**

### Property 3: Graph Traversal Completeness

_For any_ entity in the Knowledge Graph and any traversal query, the traversal SHALL return all entities reachable within the specified depth and relationship constraints.

**Validates: Requirements 1.3, 7.3**

### Property 4: Incremental Update Correctness

_For any_ file modification, the Knowledge Graph update SHALL only affect nodes and edges related to the modified file, leaving unrelated parts of the graph unchanged.

**Validates: Requirements 1.5, 6.3**

### Property 5: Graph Persistence Round-Trip

_For any_ valid Knowledge Graph state, serializing to disk and deserializing SHALL produce an equivalent graph (same nodes, edges, and metadata).

**Validates: Requirements 1.6**

### Property 6: AST Round-Trip

_For any_ valid AST produced by parsing, serializing and deserializing the AST SHALL produce an equivalent structure.

**Validates: Requirements 2.6**

### Property 7: Parser Error Resilience

_For any_ file that fails to parse (invalid syntax, unsupported constructs), the system SHALL log the error and continue processing other files without crashing.

**Validates: Requirements 2.3**

### Property 8: Cross-Repository Indexing

_For any_ set of workspace folders, the Context Engine SHALL index all folders and maintain separate but queryable indexes, with cross-repository links correctly identified.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

### Property 9: Pattern Detection Accuracy

_For any_ codebase containing known architectural patterns (Repository, Factory, Singleton, etc.), the Pattern Detector SHALL identify them with confidence scores and correctly tag related entities.

**Validates: Requirements 4.1, 4.2**

### Property 10: Git History Integration

_For any_ repository with git history, the Git History Analyzer SHALL extract commit history, identify contributors, detect hotspots, and weight recent changes higher in relevance scoring.

**Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**

### Property 11: Memory Management

_For any_ indexing operation, when memory usage exceeds 70%, the system SHALL pause indexing until memory is available, and large files (>1MB) SHALL be chunked for processing.

**Validates: Requirements 6.2, 6.4**

### Property 12: Hybrid Search Ranking

_For any_ search query, the Semantic Index SHALL combine vector similarity scores with Knowledge Graph relationship scores, boosting results that are related in the graph.

**Validates: Requirements 7.1, 7.2, 7.4**

### Property 13: Search Filtering

_For any_ search with filters (file type, directory, entity type, pattern, contributor), the results SHALL only include entities matching all specified filters.

**Validates: Requirements 7.5**

### Property 14: Context Aggregation Completeness

_For any_ context request, the Context Aggregator SHALL provide current file context, related files, relevant entities, detected patterns, and recent changes, ranked by proximity, relationships, recency, and frequency.

**Validates: Requirements 8.1, 8.2, 8.5**

### Property 15: Context Truncation Intelligence

_For any_ context that exceeds the token limit, truncation SHALL preserve the most relevant parts based on ranking criteria, and output SHALL be valid structured JSON.

**Validates: Requirements 8.3, 8.4**

### Property 16: Real-time Update Handling

_For any_ rapid sequence of file changes, the system SHALL debounce updates, batch simultaneous changes, use shadow buffers for unsaved edits, and retry failed updates with exponential backoff.

**Validates: Requirements 9.2, 9.3, 9.4, 9.5**

### Property 17: Graceful Degradation

_For any_ error during Context Engine operation, the system SHALL log the error and continue operating with degraded functionality without crashing the extension.

**Validates: Requirements 10.5**

## Error Handling

### Parser Errors

```typescript
try {
	const result = await parser.parse(filePath, content)
	if (result.errors.length > 0) {
		Logger.warn("ContextEngine", `Parse warnings for ${filePath}`, result.errors)
	}
	return result
} catch (error) {
	Logger.error("ContextEngine", `Failed to parse ${filePath}`, error)
	// Return empty result, don't crash
	return { entities: [], relationships: [], errors: [error] }
}
```

### Graph Operation Errors

```typescript
try {
	await graph.addNode(entity)
} catch (error) {
	Logger.error("KnowledgeGraph", `Failed to add node ${entity.id}`, error)
	// Queue for retry
	this.retryQueue.push({ operation: "addNode", data: entity })
}
```

### Memory Pressure

```typescript
const memoryUsage = process.memoryUsage().heapUsed / process.memoryUsage().heapTotal
if (memoryUsage > 0.7) {
	Logger.warn("ContextEngine", "Memory pressure detected, pausing indexing")
	await this.pauseIndexing()
	// Wait for GC
	await new Promise((resolve) => setTimeout(resolve, 5000))
}
```

## Testing Strategy

### Unit Tests

1. **AST Parser Tests**: Test parsing for each supported language with various code constructs
2. **Knowledge Graph Tests**: Test CRUD operations, traversal, and persistence
3. **Pattern Detector Tests**: Test detection of each supported pattern
4. **Git History Tests**: Test history extraction with mock git data
5. **Context Aggregator Tests**: Test ranking and truncation logic

### Property-Based Tests

Using `fast-check` for TypeScript property-based testing:

1. **Entity Extraction**: Generate random valid code, verify all entities extracted
2. **Graph Round-Trip**: Generate random graphs, verify serialization/deserialization
3. **AST Round-Trip**: Generate random ASTs, verify serialization/deserialization
4. **Incremental Updates**: Generate random modifications, verify only affected nodes change
5. **Search Filtering**: Generate random filters, verify results match all criteria

**Configuration**:

- Minimum 100 iterations per property test
- Each test tagged with: **Feature: advanced-context-engine, Property N: {property_text}**

### Integration Tests

1. **Full Indexing**: Index a real codebase and verify graph completeness
2. **Cross-Repo**: Test with multiple workspace folders
3. **Real-time Updates**: Test file change handling
4. **Extension Integration**: Test with CodeIndexManager

## Implementation Order

### Phase 1: Core Infrastructure

1. AST Parser Service with TypeScript/JavaScript support
2. Knowledge Graph with in-memory storage
3. Basic persistence (JSON file)

### Phase 2: Analysis Features

4. Git History Analyzer
5. Pattern Detector (basic patterns)
6. Cross-repository support

### Phase 3: Search & Context

7. Hybrid search (vector + graph)
8. Context Aggregator
9. Context Engine API

### Phase 4: Integration & Optimization

10. Extension integration
11. Performance optimization
12. Additional language support
