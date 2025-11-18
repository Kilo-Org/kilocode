# Modular Completion Strategy Architecture Plan

## Overview

Design a pluggable strategy pattern for code completion that separates holefiller and FIM (Fill-In-Middle) approaches, allowing automatic selection based on model capabilities while maintaining consistency through shared GhostModel API calls.

## Current Architecture Analysis

### Existing Components

- **HoleFiller**: Handles prompt creation for hole-based completion using `{{FILL_HERE}}` placeholders
- **GhostInlineCompletionProvider**: Tightly coupled implementation that handles both strategies
- **GhostModel**: Provides API communication with support for both regular and FIM endpoints
- **GhostContextProvider**: Manages context retrieval and snippet processing

### Current Issues

- Tight coupling between completion logic and strategy selection
- Difficult to add new completion approaches
- Strategy selection logic embedded in provider
- Limited extensibility for experimental approaches

## Proposed Architecture

### Core Interfaces

```typescript
// Base strategy interface
interface ICompletionStrategy {
	readonly name: string
	readonly description: string

	// Check if strategy supports the given model
	supportsModel(model: GhostModel): boolean

	// Generate completion using this strategy
	generateCompletion(
		request: CompletionRequest,
		model: GhostModel,
		contextProvider: GhostContextProvider,
	): Promise<CompletionResult>

	// Get priority for strategy selection (higher = more preferred)
	getPriority(): number
}

// Request data structure
interface CompletionRequest {
	prefix: string
	suffix: string
	languageId: string
	autocompleteInput: AutocompleteInput
	document: vscode.TextDocument
	position: vscode.Position
}

// Result data structure
interface CompletionResult {
	suggestion: FillInAtCursorSuggestion
	cost: number
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
	strategyUsed: string
}
```

### Strategy Registry

```typescript
class CompletionStrategyRegistry {
	private strategies: Map<string, ICompletionStrategy> = new Map()

	register(strategy: ICompletionStrategy): void
	unregister(strategyName: string): void
	getStrategies(): ICompletionStrategy[]
	selectBestStrategy(model: GhostModel): ICompletionStrategy | null
}
```

### Concrete Strategy Implementations

#### 1. HoleFiller Strategy

```typescript
class HoleFillerStrategy implements ICompletionStrategy {
	readonly name = "holefiller"
	readonly description = "Uses {{FILL_HERE}} placeholder approach"

	supportsModel(model: GhostModel): boolean {
		return true // Fallback strategy, supports all models
	}

	getPriority(): number {
		return 1 // Lowest priority, used as fallback
	}

	async generateCompletion(
		request: CompletionRequest,
		model: GhostModel,
		contextProvider: GhostContextProvider,
	): Promise<CompletionResult>
}
```

#### 2. FIM Strategy

```typescript
class FimStrategy implements ICompletionStrategy {
	readonly name = "fim"
	readonly description = "Uses native Fill-In-Middle API"

	supportsModel(model: GhostModel): boolean {
		return model.supportsFim()
	}

	getPriority(): number {
		return 10 // High priority, preferred when available
	}

	async generateCompletion(
		request: CompletionRequest,
		model: GhostModel,
		contextProvider: GhostContextProvider,
	): Promise<CompletionResult>
}
```

### Strategy Manager

```typescript
class CompletionStrategyManager {
	private registry: CompletionStrategyRegistry
	private fallbackStrategy: ICompletionStrategy

	constructor(registry: CompletionStrategyRegistry) {
		this.registry = registry
		this.fallbackStrategy = new HoleFillerStrategy()
	}

	async executeCompletion(
		request: CompletionRequest,
		model: GhostModel,
		contextProvider: GhostContextProvider,
	): Promise<CompletionResult> {
		const strategy = this.registry.selectBestStrategy(model) || this.fallbackStrategy

		try {
			return await strategy.generateCompletion(request, model, contextProvider)
		} catch (error) {
			console.warn(`Strategy ${strategy.name} failed, falling back to holefiller`, error)
			return await this.fallbackStrategy.generateCompletion(request, model, contextProvider)
		}
	}
}
```

### Refactored Provider

```typescript
class GhostInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
	private strategyManager: CompletionStrategyManager
	private contextProvider: GhostContextProvider
	private model: GhostModel

	// Simplified completion logic
	private async getCompletionResult(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<CompletionResult> {
		const request = this.buildCompletionRequest(document, position)

		return await this.strategyManager.executeCompletion(request, this.model, this.contextProvider)
	}
}
```

## Implementation Plan

### Phase 1: Core Infrastructure

1. **Create strategy interfaces and base classes**

    - Define `ICompletionStrategy` interface
    - Create `CompletionRequest` and `CompletionResult` types
    - Implement `CompletionStrategyRegistry`

2. **Extract existing logic into strategies**
    - Move holefiller logic from `HoleFiller.ts` into `HoleFillerStrategy`
    - Move FIM logic from `GhostInlineCompletionProvider` into `FimStrategy`

### Phase 2: Strategy Manager Integration

1. **Implement strategy manager**

    - Create `CompletionStrategyManager` class
    - Add automatic strategy selection based on model capabilities
    - Implement fallback mechanism

2. **Refactor provider**
    - Update `GhostInlineCompletionProvider` to use strategy manager
    - Remove strategy-specific logic from provider
    - Maintain backward compatibility

### Phase 3: Enhanced Features

1. **Add strategy configuration**

    - Allow users to override automatic selection
    - Add strategy-specific settings
    - Implement strategy chaining/fallback options

2. **Add new strategies**
    - Example: `HybridStrategy` that combines multiple approaches
    - Example: `ContextAwareStrategy` for specialized contexts
    - Example: `ExperimentalStrategy` for testing new approaches

## Benefits

### Modularity

- Each strategy is self-contained with its own prompt creation logic
- Easy to add, remove, or modify strategies without affecting others
- Clear separation of concerns

### Extensibility

- New completion approaches can be added by implementing `ICompletionStrategy`
- No need to modify existing code when adding strategies
- Supports A/B testing and experimental approaches

### Maintainability

- Strategy-specific logic is isolated and easier to test
- Clear interfaces make the codebase more understandable
- Reduced coupling between components

### Flexibility

- Automatic selection based on model capabilities
- Fallback mechanisms ensure robustness
- User configuration options when needed

## Migration Strategy

### Backward Compatibility

- Existing API remains unchanged
- Current behavior preserved during transition
- Gradual migration of functionality

### Testing Strategy

- Unit tests for each strategy independently
- Integration tests for strategy manager
- End-to-end tests for provider behavior

### Performance Considerations

- Strategy selection is lightweight
- No significant overhead compared to current implementation
- Caching of strategy selection results

## Future Extensions

### Advanced Strategy Selection

- Context-aware strategy selection
- Performance-based strategy adaptation
- Machine learning for optimal strategy choice

### Strategy Composition

- Combine multiple strategies for better results
- Weighted voting between strategies
- Hierarchical strategy selection

### Monitoring and Analytics

- Track strategy performance and success rates
- A/B testing framework for strategies
- User feedback integration for strategy improvement

## Conclusion

This modular architecture provides a solid foundation for extensible code completion while maintaining the existing functionality and performance. The strategy pattern enables easy addition of new completion approaches and provides clear separation of concerns, making the codebase more maintainable and testable.
