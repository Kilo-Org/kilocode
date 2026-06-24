export { CodeIndexManager } from "./manager"
export { CodeIndexConfigManager, type IndexingConfigInput } from "./config-manager"
export { CodeIndexStateManager, type IndexingState } from "./state-manager"
export { CodeIndexSearchService } from "./search-service"
export { CodeIndexOrchestrator } from "./orchestrator"
export { CodeIndexServiceFactory } from "./service-factory"
export { CacheManager } from "./cache-manager"
export { Emitter, type Disposable } from "./runtime"

// kilocode_change - graph indexing exports
export { GraphDatabase } from "./graph/database"
export { GraphBuilder } from "./graph/builder"
export { GraphSearch } from "./graph/search"
export { GraphIntegration } from "./graph/integration"
export { extractJavaScriptGraph } from "./extractor/javascript"

export type {
  GraphNode,
  GraphEdge,
  GraphNodeKind,
  GraphEdgeKind,
  GraphSearchResult,
  DependencyChain,
} from "./graph/types"

export type { ExtractedGraph } from "./extractor/javascript"

export type { ICodeIndexManager, IndexProgressUpdate, EmbedderProvider } from "./interfaces/manager"

export type {
  IndexingTelemetryEvent,
  IndexingTelemetryMode,
  IndexingTelemetryReporter,
  IndexingTelemetrySource,
  IndexingTelemetryTrigger,
} from "./interfaces/telemetry"

export type { CodeIndexConfig, PreviousConfigSnapshot } from "./interfaces/config"

export type { IEmbedder, EmbeddingResponse, EmbedderInfo, AvailableEmbedders } from "./interfaces/embedder"

export type { IVectorStore, VectorStoreSearchResult, PointStruct, Payload } from "./interfaces/vector-store"

export type {
  ICodeParser,
  IDirectoryScanner,
  IFileWatcher,
  CodeBlock,
  FileProcessingResult,
  BatchProcessingSummary,
} from "./interfaces/file-processor"

export type { ICacheManager } from "./interfaces/cache"
