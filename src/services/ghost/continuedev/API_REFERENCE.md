# API Reference

Complete API documentation for the Autocomplete & NextEdit library.

## Table of Contents

- [CompletionProvider](#completionprovider)
- [NextEditProvider](#nexteditprovider)
- [MinimalConfigProvider](#minimalconfigprovider)
- [Core Interfaces](#core-interfaces)
- [LLM Adapters](#llm-adapters)
- [Types and Interfaces](#types-and-interfaces)

---

## CompletionProvider

The main class for providing AI-powered code autocompletion.

**Location**: [`core/autocomplete/CompletionProvider.ts`](core/autocomplete/CompletionProvider.ts)

### Constructor

```typescript
constructor(
  configHandler: MinimalConfigProvider,
  ide: IDE,
  _injectedGetLlm: () => Promise<ILLM | undefined>,
  _onError: (e: any) => void,
  getDefinitionsFromLsp: GetLspDefinitionsFunction
)
```

**Parameters**:

- `configHandler`: Configuration provider for autocomplete options
- `ide`: IDE interface implementation for file I/O and editor operations
- `_injectedGetLlm`: Async function that returns the LLM to use for completions
- `_onError`: Error callback function for handling autocomplete errors
- `getDefinitionsFromLsp`: Function to retrieve LSP definitions for enhanced context

### Methods

#### `provideInlineCompletionItems()`

Generates an autocomplete completion for the given input.

```typescript
async provideInlineCompletionItems(
  input: AutocompleteInput,
  token: AbortSignal | undefined,
  force?: boolean
): Promise<AutocompleteOutcome | undefined>
```

**Parameters**:

- `input`: Autocomplete context including file path, cursor position, recent edits
- `token`: AbortSignal to cancel the request
- `force`: If true, bypasses debouncing

**Returns**: `AutocompleteOutcome` containing the completion text and metadata, or `undefined` if no completion

**Example**:

```typescript
const outcome = await completionProvider.provideInlineCompletionItems(
	{
		filepath: "/path/to/file.ts",
		pos: { line: 10, character: 5 },
		completionId: "unique-completion-id",
		recentlyEditedRanges: [],
		recentlyEditedFiles: new Map(),
		clipboardText: "",
	},
	abortController.signal,
)
```

#### `accept()`

Marks a completion as accepted by the user.

```typescript
accept(completionId: string): void
```

**Parameters**:

- `completionId`: Unique identifier for the accepted completion

**Side Effects**: Updates bracket matching service and completion cache

#### `markDisplayed()`

Marks a completion as having been displayed to the user.

```typescript
markDisplayed(completionId: string, outcome: AutocompleteOutcome): void
```

**Parameters**:

- `completionId`: Unique identifier for the completion
- `outcome`: The autocomplete outcome that was displayed

#### `cancel()`

Cancels any in-progress autocomplete requests.

```typescript
cancel(): void
```

### Configuration Options

See [`MinimalConfigProvider`](#minimalconfigprovider) for configuration options.

---

## NextEditProvider

The main class for providing predictive multi-location code edits.

**Location**: [`core/nextEdit/NextEditProvider.ts`](core/nextEdit/NextEditProvider.ts)

### Constructor

```typescript
constructor(
  configHandler: MinimalConfigProvider,
  ide: IDE,
  _injectedGetLlm: () => Promise<ILLM | undefined>,
  _onError: (e: any) => void
)
```

**Parameters**:

- `configHandler`: Configuration provider
- `ide`: IDE interface implementation
- `_injectedGetLlm`: Function returning the LLM for edit predictions
- `_onError`: Error callback

### Methods

#### `getNextEditPrediction()`

Generates predicted edits based on context and recent changes.

```typescript
async getNextEditPrediction(
  context: ModelSpecificContext,
  signal?: AbortSignal,
  usingFullFileDiff?: boolean
): Promise<NextEditOutcome | undefined>
```

**Parameters**:

- `context`: Context including file contents, cursor position, recent edits
- `signal`: Optional AbortSignal to cancel the request
- `usingFullFileDiff`: If true, generates full-file diffs; if false, only edits within a region

**Returns**: `NextEditOutcome` containing predicted edits and final cursor position

**Example**:

```typescript
const outcome = await nextEditProvider.getNextEditPrediction(
	{
		filepath: "/path/to/file.ts",
		pos: { line: 15, character: 0 },
		fileContents: currentFileContents,
		userEdits: recentDiff,
		// ... other context
	},
	abortController.signal,
	false, // Use partial file diff
)

if (outcome) {
	console.log("Edit regions:", outcome.editableRegions)
	console.log("Diff lines:", outcome.diffLines)
	console.log("New cursor:", outcome.finalCursorPosition)
}
```

---

## MinimalConfigProvider

Simple configuration provider that replaces the complex Continue config system.

**Location**: [`core/autocomplete/MinimalConfig.ts`](core/autocomplete/MinimalConfig.ts)

### Constructor

```typescript
constructor(config?: Partial<MinimalConfig>)
```

**Parameters**:

- `config`: Optional partial configuration to override defaults

**Example**:

```typescript
const configProvider = new MinimalConfigProvider({
	tabAutocompleteOptions: {
		debounceDelay: 200,
		maxPromptTokens: 2048,
		prefixPercentage: 0.5,
		suffixPercentage: 0.3,
		useCache: true,
		onlyMyCode: false,
	},
	experimental: {
		enableStaticContextualization: true,
	},
})
```

### Methods

#### `loadConfig()`

Returns the configuration object.

```typescript
async loadConfig(): Promise<{ config: MinimalConfig }>
```

**Returns**: Promise resolving to an object containing the config

#### `getAutocompleteOptions()`

Gets autocomplete-specific options.

```typescript
getAutocompleteOptions(): TabAutocompleteOptions
```

**Returns**: Autocomplete configuration options

#### `isStaticContextualizationEnabled()`

Checks if static contextualization is enabled.

```typescript
isStaticContextualizationEnabled(): boolean
```

**Returns**: True if enabled, false otherwise

### Configuration Interface

```typescript
interface MinimalConfig {
	tabAutocompleteOptions?: TabAutocompleteOptions
	experimental?: {
		enableStaticContextualization?: boolean
	}
	modelsByRole?: {
		autocomplete?: ILLM[]
	}
	selectedModelByRole?: {
		autocomplete?: ILLM
	}
}
```

### TabAutocompleteOptions

```typescript
interface TabAutocompleteOptions {
	debounceDelay?: number // Debounce delay in ms (default: 150)
	maxPromptTokens?: number // Max tokens for prompt (default: 1024)
	prefixPercentage?: number // Percentage of tokens for prefix (default: 0.5)
	suffixPercentage?: number // Percentage of tokens for suffix (default: 0.3)
	maxSuffixPercentage?: number // Max suffix tokens percentage (default: 0.5)
	useCache?: boolean // Enable completion caching (default: true)
	onlyMyCode?: boolean // Only use workspace files for context (default: false)
	template?: string // Custom prompt template
	useFileSuffix?: boolean // Include file suffix in context (default: true)
	multilineCompletions?: "always" | "never" | "auto" // Multiline behavior (default: 'auto')
	slidingWindowPrefixPercentage?: number // Sliding window prefix % (default: 0.75)
	slidingWindowSize?: number // Sliding window size (default: 500)
	maxSnippetPercentage?: number // Max tokens for snippets (default: 0.6)
	recentlyEditedSimilarityThreshold?: number // Similarity threshold (default: 0.3)
	useOtherFiles?: boolean // Use other files for context (default: true)
	disableInFiles?: string[] // Glob patterns to disable autocomplete
	stopTokens?: string[] // Custom stop tokens
	tokensPerCompletion?: number // Tokens per completion (default: 256)
	transform?: boolean // Apply post-processing transforms (default: true)
}
```

---

## Core Interfaces

### IDE Interface

The IDE interface abstracts editor operations. Implement this to integrate with your editor.

**Location**: [`core/index.d.ts`](core/index.d.ts)

```typescript
interface IDE {
	// File Operations
	readFile(filepath: string): Promise<string>
	writeFile(filepath: string, contents: string): Promise<void>

	// Workspace
	getWorkspaceDirs(): Promise<string[]>
	listWorkspaceContents(directory?: string): Promise<string[]>

	// Editor State
	getCurrentFile(): Promise<FileWithContents | undefined>
	getCursorPosition(): Promise<Position>
	getVisibleFiles(): Promise<string[]>

	// Code Navigation
	getDefinition(filepath: string, position: Position): Promise<Location[]>
	getReferences(filepath: string, position: Position): Promise<Location[]>
	getSymbols(filepath: string): Promise<SymbolWithRange[]>

	// File Information
	readRangeInFile(filepath: string, range: Range): Promise<string>
	getStats(filepath: string): Promise<FileStats>

	// Edits
	applyEdits(edits: FileEdit[]): Promise<void>

	// Diff/SCM
	getDiff(includeUnstaged: boolean): Promise<string>
	getRepoName(dir: string): Promise<string | undefined>
	getBranch(dir: string): Promise<string>

	// UI
	showMessage(message: string, severity?: "info" | "warning" | "error"): Promise<void>
	showToast(type: "info" | "warning" | "error", message: string, ...actions: string[]): Promise<string | undefined>

	// Terminal
	runCommand(command: string, options?: TerminalOptions): Promise<string>

	// Clipboard
	getClipboardContent(): Promise<{ text: string; copiedAt: number } | undefined>

	// Search
	getSearchResults(query: string): Promise<string>
	subprocess(command: string, cwd?: string): Promise<[string, string]>

	// Other
	getIdeInfo(): Promise<IdeInfo>
	getIdeSettings(): Promise<IdeSettings>
	isTelemetryEnabled(): Promise<boolean>
	getUniqueId(): Promise<string>
}
```

**Key Methods to Implement**:

- `readFile()`, `writeFile()`: Essential for file I/O
- `getWorkspaceDirs()`: Returns workspace root directories
- `getCurrentFile()`, `getCursorPosition()`: Current editor state
- `applyEdits()`: Apply code changes
- `getDefinition()`: LSP-like functionality for context gathering

### ILLM Interface

The ILLM (Language Model) interface abstracts LLM providers.

**Location**: [`core/index.d.ts`](core/index.d.ts)

```typescript
interface ILLM {
	// Required properties
	uniqueId: string
	model: string
	contextLength: number
	completionOptions: CompletionOptions

	// Provider info
	get providerName(): string
	get underlyingProviderName(): string

	// Optional
	apiKey?: string
	apiBase?: string
	autocompleteOptions?: Partial<TabAutocompleteOptions>
	promptTemplates?: PromptTemplates

	// Completion methods
	complete(prompt: string, signal: AbortSignal, options?: LLMFullCompletionOptions): Promise<string>

	streamComplete(
		prompt: string,
		signal: AbortSignal,
		options?: LLMFullCompletionOptions,
	): AsyncGenerator<string, PromptLog>

	streamFim(
		prefix: string,
		suffix: string,
		signal: AbortSignal,
		options?: LLMFullCompletionOptions,
	): AsyncGenerator<string, PromptLog>

	// Chat methods
	chat(messages: ChatMessage[], signal: AbortSignal, options?: LLMFullCompletionOptions): Promise<ChatMessage>

	streamChat(
		messages: ChatMessage[],
		signal: AbortSignal,
		options?: LLMFullCompletionOptions,
	): AsyncGenerator<ChatMessage, PromptLog>

	// Utility methods
	countTokens(text: string): number
	supportsImages(): boolean
	supportsCompletions(): boolean
	supportsFim(): boolean
	listModels(): Promise<string[]>
}
```

---

## LLM Adapters

### OpenAI

Pre-built adapter for OpenAI and OpenAI-compatible APIs.

**Location**: [`core/llm/llms/OpenAI.ts`](core/llm/llms/OpenAI.ts)

```typescript
import OpenAI from "@continuedev/core/llm/llms/OpenAI"

const llm = new OpenAI({
	model: "gpt-4",
	apiKey: process.env.OPENAI_API_KEY,
	apiBase: "https://api.openai.com/v1", // Optional custom base URL
	completionOptions: {
		temperature: 0.1,
		maxTokens: 1000,
	},
})
```

**Constructor Options**:

```typescript
interface OpenAIOptions {
	model: string
	apiKey: string
	apiBase?: string
	completionOptions?: CompletionOptions
	contextLength?: number
	autocompleteOptions?: Partial<TabAutocompleteOptions>
}
```

### Creating Custom LLM Adapters

To create a custom LLM adapter, implement the `ILLM` interface:

```typescript
import { ILLM, CompletionOptions } from "@continuedev/core"

class CustomLLM implements ILLM {
	uniqueId = "custom-llm"
	model: string
	contextLength: number
	completionOptions: CompletionOptions

	get providerName() {
		return "custom"
	}
	get underlyingProviderName() {
		return "custom"
	}

	constructor(options: { model: string }) {
		this.model = options.model
		this.contextLength = 4096
		this.completionOptions = {
			model: options.model,
			temperature: 0.1,
		}
	}

	async complete(prompt: string, signal: AbortSignal): Promise<string> {
		// Call your LLM API
		const response = await fetch("your-api-endpoint", {
			method: "POST",
			body: JSON.stringify({ prompt }),
			signal,
		})
		return await response.text()
	}

	async *streamComplete(prompt: string, signal: AbortSignal) {
		// Stream from your LLM API
		for await (const chunk of streamFromAPI(prompt, signal)) {
			yield chunk
		}
		return { modelTitle: this.model, prompt, completion: "" }
	}

	// Implement other required methods...
	countTokens(text: string): number {
		return text.length / 4 // Rough estimate
	}

	supportsImages() {
		return false
	}
	supportsCompletions() {
		return true
	}
	supportsFim() {
		return false
	}

	// ... other methods
}
```

---

## Types and Interfaces

### AutocompleteInput

Input for autocomplete requests.

```typescript
interface AutocompleteInput {
	filepath: string // Path to the file being edited
	pos: Position // Cursor position
	completionId: string // Unique ID for this completion request
	recentlyEditedRanges: Range[] // Recently edited ranges in this file
	recentlyEditedFiles: Map<string, [Range, number][]> // Recently edited files
	clipboardText: string // Current clipboard content
	manuallyPassFileContext?: RangeInFile[] // Manually provided context
}
```

### AutocompleteOutcome

Result of an autocomplete request.

```typescript
interface AutocompleteOutcome {
	completion: string // The completion text
	completionId: string // Unique ID for this completion
	filepath: string // File path
	prefix: string // Code prefix (before cursor)
	suffix: string // Code suffix (after cursor)
	prompt: string // Full prompt sent to LLM
	modelTitle: string // Model used
	modelProvider: string // Provider used
	completionOptions: CompletionOptions // Options used
	cacheHit: boolean // Whether cached
	latency: number // Response latency in ms
}
```

### NextEditOutcome

Result of a NextEdit prediction.

```typescript
interface NextEditOutcome {
	edits: string // The predicted edit text
	diffLines: DiffLine[] // Diff representation
	editableRegions: Range[] // Regions that were edited
	finalCursorPosition: Position // Predicted cursor position after edits
	filepath: string // File path
	prompt: string // Prompt sent to LLM
	modelTitle: string // Model used
	latency: number // Response latency in ms
}
```

### Position

Position in a text document.

```typescript
interface Position {
	line: number // 0-based line number
	character: number // 0-based character offset
}
```

### Range

Range in a text document.

```typescript
interface Range {
	start: Position // Start position (inclusive)
	end: Position // End position (exclusive)
}
```

### RangeInFile

Range in a specific file.

```typescript
interface RangeInFile {
	filepath: string // File path
	range: Range // Range within the file
}
```

### DiffLine

A single line in a diff.

```typescript
interface DiffLine {
	type: "same" | "new" | "old" // Type of change
	line: string // Line content
	lineNumber: number // Line number in file
}
```

### FileEdit

An edit to apply to a file.

```typescript
interface FileEdit {
	filepath: string // File to edit
	range: Range // Range to replace
	replacement: string // New content
}
```

---

## Usage Examples

### Complete Example: Autocomplete with Custom IDE

```typescript
import { CompletionProvider, MinimalConfigProvider } from "@continuedev/core/autocomplete"
import { IDE, ILLM, Position } from "@continuedev/core"
import OpenAI from "@continuedev/core/llm/llms/OpenAI"

// 1. Implement IDE interface
class MyIDE implements IDE {
	async readFile(filepath: string): Promise<string> {
		return fs.readFileSync(filepath, "utf-8")
	}

	async getWorkspaceDirs(): Promise<string[]> {
		return ["/path/to/workspace"]
	}

	async getCurrentFile() {
		return {
			filepath: this.currentFilePath,
			contents: await this.readFile(this.currentFilePath),
		}
	}

	async getCursorPosition(): Promise<Position> {
		return this.cursorPosition
	}

	// ... implement other methods
}

// 2. Set up configuration
const config = new MinimalConfigProvider({
	tabAutocompleteOptions: {
		debounceDelay: 150,
		maxPromptTokens: 1024,
		useCache: true,
	},
})

// 3. Set up LLM
const getLlm = async (): Promise<ILLM> => {
	return new OpenAI({
		apiKey: process.env.OPENAI_API_KEY,
		model: "gpt-4",
	})
}

// 4. Create completion provider
const ide = new MyIDE()
const provider = new CompletionProvider(
	config,
	ide,
	getLlm,
	(error) => console.error(error),
	async () => [], // LSP definitions function
)

// 5. Request completion
const outcome = await provider.provideInlineCompletionItems(
	{
		filepath: "/path/to/file.ts",
		pos: { line: 10, character: 5 },
		completionId: "completion-1",
		recentlyEditedRanges: [],
		recentlyEditedFiles: new Map(),
		clipboardText: "",
	},
	new AbortController().signal,
)

if (outcome) {
	console.log("Completion:", outcome.completion)
	provider.markDisplayed("completion-1", outcome)
}
```

---

## Error Handling

Both `CompletionProvider` and `NextEditProvider` accept an error callback:

```typescript
const onError = (error: any) => {
	if (error instanceof Error) {
		console.error("Error:", error.message)
		// Show user notification
		showNotification(error.message)
	}
}

const provider = new CompletionProvider(
	config,
	ide,
	getLlm,
	onError, // Error callback
	getLspDefinitions,
)
```

Common errors:

- **LLM API errors**: Network failures, invalid API keys, rate limits
- **File I/O errors**: Missing files, permission errors
- **Timeout errors**: Long-running requests that are aborted

---

## Performance Considerations

### Caching

Completions are automatically cached using an LRU cache. Configure caching:

```typescript
const config = new MinimalConfigProvider({
	tabAutocompleteOptions: {
		useCache: true, // Enable caching (default)
	},
})
```

### Debouncing

Prevent excessive LLM calls during rapid typing:

```typescript
const config = new MinimalConfigProvider({
	tabAutocompleteOptions: {
		debounceDelay: 150, // Wait 150ms before requesting (default)
	},
})
```

### Abort Signals

Always provide AbortSignals to cancel in-progress requests:

```typescript
const controller = new AbortController()

// Start request
const promise = provider.provideInlineCompletionItems(input, controller.signal)

// Cancel if needed
controller.abort()
```

---

## See Also

- [README.md](README.md) - Project overview and quick start
- [ARCHITECTURE.md](ARCHITECTURE.md) - Technical architecture details
- [EXAMPLES.md](EXAMPLES.md) - More usage examples
- [Core TypeScript Definitions](core/index.d.ts) - Full type definitions
