# Usage Examples

Practical examples for integrating and using the Autocomplete & NextEdit library.

## Table of Contents

- [Autocomplete Examples](#autocomplete-examples)
- [NextEdit Examples](#nextedit-examples)
- [Configuration Examples](#configuration-examples)
- [Integration Examples](#integration-examples)
- [Advanced Usage](#advanced-usage)

---

## Autocomplete Examples

### Basic Autocomplete Setup

```typescript
import { CompletionProvider } from "./core/autocomplete/CompletionProvider"
import { MinimalConfigProvider } from "./core/autocomplete/MinimalConfig"
import { IDE, ILLM } from "./core/index.d"
import { OpenAI } from "./core/llm/llms/OpenAI"

// 1. Create configuration
const config = new MinimalConfigProvider({
	tabAutocompleteOptions: {
		debounceDelay: 150,
		maxPromptTokens: 1024,
		useCache: true,
	},
})

// 2. Create LLM provider
async function getLlm(): Promise<ILLM | undefined> {
	return new OpenAI({
		apiKey: process.env.OPENAI_API_KEY || "",
		model: "gpt-4",
		completionOptions: {
			temperature: 0.1,
			maxTokens: 1000,
		},
	})
}

// 3. Error handler
function onError(error: any) {
	console.error("Autocomplete error:", error)
	// Show user notification
}

// 4. LSP definitions function (optional but recommended)
async function getDefinitionsFromLsp(filepath: string, contents: string, cursorIndex: number, ide: IDE, lang: any) {
	// Implement LSP integration or return empty array
	return []
}

// 5. Create completion provider
const completionProvider = new CompletionProvider(
	config,
	ide, // Your IDE implementation
	getLlm,
	onError,
	getDefinitionsFromLsp,
)
```

### Requesting a Completion

```typescript
import { v4 as uuidv4 } from "uuid"

async function requestCompletion(filepath: string, line: number, character: number) {
	// Create abort controller for cancellation
	const abortController = new AbortController()

	// Create completion request
	const outcome = await completionProvider.provideInlineCompletionItems(
		{
			filepath: filepath,
			pos: { line, character },
			completionId: uuidv4(),
			recentlyEditedRanges: [],
			recentlyEditedFiles: new Map(),
			clipboardText: "",
		},
		abortController.signal,
	)

	if (outcome) {
		console.log("Completion:", outcome.completion)
		console.log("Latency:", outcome.latency, "ms")
		console.log("Cache hit:", outcome.cacheHit)

		return outcome
	}

	return null
}
```

### Handling Completion Lifecycle

```typescript
class AutocompleteManager {
	private currentCompletionId: string | null = null
	private currentOutcome: any = null

	async requestCompletion(filepath: string, position: Position) {
		const completionId = uuidv4()
		this.currentCompletionId = completionId

		const outcome = await completionProvider.provideInlineCompletionItems(
			{
				filepath,
				pos: position,
				completionId,
				recentlyEditedRanges: [],
				recentlyEditedFiles: new Map(),
				clipboardText: "",
			},
			this.abortController.signal,
		)

		if (outcome) {
			this.currentOutcome = outcome
			this.displayCompletion(outcome)

			// Mark as displayed for logging
			completionProvider.markDisplayed(completionId, outcome)
		}
	}

	acceptCompletion() {
		if (this.currentCompletionId && this.currentOutcome) {
			// Apply the completion to the editor
			this.applyToEditor(this.currentOutcome.completion)

			// Notify provider of acceptance
			completionProvider.accept(this.currentCompletionId)

			this.currentCompletionId = null
			this.currentOutcome = null
		}
	}

	rejectCompletion() {
		// Just clear without notifying (rejection is default)
		this.currentCompletionId = null
		this.currentOutcome = null
		this.hideCompletion()
	}

	cancelInProgress() {
		completionProvider.cancel()
		this.currentCompletionId = null
	}

	private displayCompletion(outcome: any) {
		// Display as ghost text in your editor
	}

	private hideCompletion() {
		// Remove ghost text from editor
	}

	private applyToEditor(completion: string) {
		// Insert completion into editor
	}
}
```

### Autocomplete with Context

```typescript
async function requestCompletionWithContext(
	filepath: string,
	position: Position,
	recentEdits: Range[],
	recentFiles: Map<string, [Range, number][]>,
) {
	const outcome = await completionProvider.provideInlineCompletionItems(
		{
			filepath,
			pos: position,
			completionId: uuidv4(),
			recentlyEditedRanges: recentEdits,
			recentlyEditedFiles: recentFiles,
			clipboardText: await getClipboard(),
		},
		abortController.signal,
	)

	return outcome
}

// Track recent edits
class RecentEditsTracker {
	private edits: Map<string, Range[]> = new Map()

	recordEdit(filepath: string, range: Range) {
		const fileEdits = this.edits.get(filepath) || []
		fileEdits.push(range)

		// Keep only last 10 edits per file
		if (fileEdits.length > 10) {
			fileEdits.shift()
		}

		this.edits.set(filepath, fileEdits)
	}

	getRecentEdits(filepath: string): Range[] {
		return this.edits.get(filepath) || []
	}

	getAllRecentFiles(): Map<string, [Range, number][]> {
		const result = new Map()
		for (const [file, ranges] of this.edits.entries()) {
			result.set(
				file,
				ranges.map((r, i) => [r, Date.now() - i * 1000]),
			)
		}
		return result
	}
}
```

---

## NextEdit Examples

### Basic NextEdit Setup

```typescript
import { NextEditProvider } from "./core/nextEdit/NextEditProvider"
import { MinimalConfigProvider } from "./core/autocomplete/MinimalConfig"
import { ILLM, IDE } from "./core"

// 1. Configuration (shared with autocomplete)
const config = new MinimalConfigProvider()

// 2. LLM provider for NextEdit (can be different from autocomplete)
async function getNextEditLlm(): Promise<ILLM | undefined> {
	return new OpenAI({
		apiKey: process.env.OPENAI_API_KEY || "",
		model: "gpt-4", // Or specialized model like 'instinct' or 'mercury-coder'
	})
}

// 3. Error handler
function onNextEditError(error: any) {
	console.error("NextEdit error:", error)
}

// 4. Create NextEdit provider
const nextEditProvider = new NextEditProvider(
	config,
	ide, // Your IDE implementation
	getNextEditLlm,
	onNextEditError,
)
```

### Requesting Edit Predictions

```typescript
async function requestEditPrediction(
	filepath: string,
	position: Position,
	fileContents: string,
	userRecentEdit?: string,
) {
	const outcome = await nextEditProvider.getNextEditPrediction(
		{
			filepath,
			pos: position,
			fileContents,
			userEdits: userRecentEdit || "",
			// Additional context can be provided here
		},
		abortController.signal,
		false, // Use partial file diff (faster)
	)

	if (outcome) {
		console.log("Edit regions:", outcome.editableRegions)
		console.log("Number of changes:", outcome.diffLines.length)
		console.log("New cursor position:", outcome.finalCursorPosition)

		return outcome
	}

	return null
}
```

### NextEdit with Full File Diff

```typescript
async function requestFullFileEdit(filepath: string, position: Position, fileContents: string) {
	// Use full file diff for comprehensive changes
	const outcome = await nextEditProvider.getNextEditPrediction(
		{
			filepath,
			pos: position,
			fileContents,
			userEdits: "",
		},
		abortController.signal,
		true, // Use full file diff
	)

	if (outcome) {
		// Apply all changes to the file
		await applyDiffToFile(filepath, outcome.diffLines)

		// Move cursor to final position
		moveCursorTo(outcome.finalCursorPosition)
	}
}
```

### NextEdit with User Confirmation

```typescript
import { DiffLine } from "./core"

class NextEditManager {
	async requestAndConfirmEdit(filepath: string, position: Position, fileContents: string) {
		const outcome = await nextEditProvider.getNextEditPrediction(
			{ filepath, pos: position, fileContents, userEdits: "" },
			abortController.signal,
		)

		if (!outcome) {
			return
		}

		// Show diff preview to user
		const userAccepted = await this.showDiffPreview(outcome.diffLines)

		if (userAccepted) {
			await this.applyEdits(filepath, outcome)
			console.log("Edit applied successfully")
		} else {
			console.log("Edit rejected by user")
		}
	}

	private async showDiffPreview(diffLines: DiffLine[]): Promise<boolean> {
		// Display diff in UI and get user confirmation
		console.log("Diff preview:")
		for (const line of diffLines) {
			const prefix = line.type === "new" ? "+" : line.type === "old" ? "-" : " "
			console.log(`${prefix} ${line.line}`)
		}

		// Return true if user accepts
		return true
	}

	private async applyEdits(filepath: string, outcome: any) {
		// Apply the edits to the file
		await ide.writeFile(filepath, outcome.edits)

		// Move cursor
		await ide.setCursorPosition(outcome.finalCursorPosition)
	}
}
```

### Multi-Region NextEdit

```typescript
async function handleMultiRegionEdit(filepath: string, position: Position, fileContents: string) {
	const outcome = await nextEditProvider.getNextEditPrediction(
		{ filepath, pos: position, fileContents, userEdits: "" },
		abortController.signal,
		false, // Partial file mode for multiple regions
	)

	if (!outcome || !outcome.editableRegions) {
		return
	}

	console.log(`Found ${outcome.editableRegions.length} edit regions:`)

	// Display each region
	for (const region of outcome.editableRegions) {
		console.log(`Region: lines ${region.start.line} - ${region.end.line}`)

		// Extract changes for this region
		const regionDiff = outcome.diffLines.filter(
			(line) => line.lineNumber >= region.start.line && line.lineNumber <= region.end.line,
		)

		// Show region preview
		displayRegionPreview(region, regionDiff)
	}

	// Allow user to jump between regions or accept all
}

function displayRegionPreview(region: Range, diffLines: DiffLine[]) {
	console.log(`\nRegion ${region.start.line}-${region.end.line}:`)
	for (const line of diffLines) {
		console.log(`  ${line.type}: ${line.line}`)
	}
}
```

---

## Configuration Examples

### Custom Autocomplete Configuration

````typescript
const customConfig = new MinimalConfigProvider({
	tabAutocompleteOptions: {
		// Timing
		debounceDelay: 200, // Wait 200ms after typing stops

		// Token limits
		maxPromptTokens: 2048, // Max tokens for entire prompt
		prefixPercentage: 0.6, // 60% of tokens for prefix
		suffixPercentage: 0.2, // 20% of tokens for suffix
		maxSuffixPercentage: 0.4, // Never more than 40% for suffix

		// Context
		maxSnippetPercentage: 0.5, // 50% max for code snippets
		useOtherFiles: true, // Include other files
		onlyMyCode: false, // Include library code

		// Behavior
		useCache: true, // Enable caching
		useFileSuffix: true, // Include code after cursor
		multilineCompletions: "auto", // Auto-detect multiline

		// Performance
		slidingWindowSize: 500, // Sliding window for context
		slidingWindowPrefixPercentage: 0.75, // Use 75% for prefix in window

		// Generation
		tokensPerCompletion: 256, // Max tokens to generate
		transform: true, // Apply post-processing

		// Filtering
		disableInFiles: ["*.md", "*.txt"], // Disable in these files
		stopTokens: ["```", "---"], // Custom stop sequences
	},

	experimental: {
		enableStaticContextualization: true, // Experimental features
	},
})
````

### Model-Specific Configuration

```typescript
// Configuration optimized for different models
const gpt4Config = new MinimalConfigProvider({
	tabAutocompleteOptions: {
		maxPromptTokens: 4096,
		tokensPerCompletion: 512,
		temperature: 0.1,
	},
})

const claudeConfig = new MinimalConfigProvider({
	tabAutocompleteOptions: {
		maxPromptTokens: 8192,
		tokensPerCompletion: 1024,
		temperature: 0.2,
	},
})

const codelamaConfig = new MinimalConfigProvider({
	tabAutocompleteOptions: {
		maxPromptTokens: 2048,
		tokensPerCompletion: 256,
		multilineCompletions: "always",
	},
})
```

### Dynamic Configuration

```typescript
class DynamicConfigProvider extends MinimalConfigProvider {
	constructor() {
		super()
	}

	async loadConfig() {
		// Adjust config based on file type
		const currentFile = await ide.getCurrentFile()
		const fileExtension = currentFile?.filepath.split(".").pop()

		if (fileExtension === "py") {
			// Python-specific settings
			this.config.tabAutocompleteOptions = {
				...this.config.tabAutocompleteOptions,
				multilineCompletions: "always",
				stopTokens: ['"""', "'''"],
			}
		} else if (fileExtension === "ts" || fileExtension === "tsx") {
			// TypeScript-specific settings
			this.config.tabAutocompleteOptions = {
				...this.config.tabAutocompleteOptions,
				maxPromptTokens: 2048,
			}
		}

		return { config: this.config }
	}
}
```

---

## Integration Examples

### Complete VSCode-like Integration

```typescript
import * as vscode from 'vscode';
import {
  CompletionProvider,
  MinimalConfigProvider
} from './core/autocomplete';

class VSCodeAutocompleteIntegration
  implements vscode.InlineCompletionItemProvider
{
  private completionProvider: CompletionProvider;
  private currentCompletionId: string | null = null;

  constructor() {
    const config = new MinimalConfigProvider();
    const ide = new VSCodeIdeAdapter();

    this.completionProvider = new CompletionProvider(
      config,
      ide,
      this.getLlm.bind(this),
      this.onError.bind(this),
      this.getDefinitionsFromLsp.bind(this)
    );
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[]> {

    const completionId = uuidv4();
    this.currentCompletionId = completionId;

    const outcome = await this.completionProvider.provideInlineCompletionItems(
      {
        filepath: document.uri.fsPath,
        pos: { line: position.line, character: position.character },
        completionId,
        recentlyEditedRanges: this.getRecentEdits(document),
        recentlyEditedFiles: this.getRecentFiles(),
        clipboardText: await vscode.env.clipboard.readText(),
      },
      this.toAbortSignal(token)
    );

    if (!outcome) {
      return [];
    }

    // Mark as displayed
    this.completionProvider.markDisplayed(completionId, outcome);

    // Convert to VSCode format
    return [
      new vscode.InlineCompletionItem(
        outcome.completion,
        new vscode.Range(position, position)
      )
    ];
  }

  private async getLlm() {
    return new OpenAI({
      apiKey: vscode.workspace.getConfiguration('continue').get('apiKey'),
      model: 'gpt-4',
    });
  }

  private onError(error: any) {
    vscode.window.showErrorMessage(`Autocomplete error: ${error.message}`);
  }

  private async getDefinitionsFromLsp(
    filepath: string,
    contents: string,
    cursorIndex: number,
    ide: IDE,
    lang: any
  ) {
    // Use VSCode's LSP
    const uri = vscode.Uri.file(filepath);
    const position = /* convert cursorIndex to Position */;
    const definitions = await vscode.commands.executeCommand(
      'vscode.executeDefinitionProvider',
      uri,
      position
    );
    return /* convert to expected format */;
  }

  private getRecentEdits(document: vscode.TextDocument): Range[] {
    // Track edits in your extension
    return [];
  }

  private getRecentFiles(): Map<string, [Range, number][]> {
    // Track recently edited files
    return new Map();
  }

  private toAbortSignal(token: vscode.CancellationToken): AbortSignal {
    const controller = new AbortController();
    token.onCancellationRequested(() => controller.abort());
    return controller.signal;
  }
}

// Register the provider
export function activate(context: vscode.ExtensionContext) {
  const provider = new VSCodeAutocompleteIntegration();

  const disposable = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: '**' },
    provider
  );

  context.subscriptions.push(disposable);
}
```

### Simple IDE Implementation

```typescript
import { IDE, Position, Range, FileEdit } from "./core"
import * as fs from "fs"
import * as path from "path"

class SimpleFileSystemIDE implements IDE {
	private workspaceDir: string
	private currentFile: string | null = null

	constructor(workspaceDir: string) {
		this.workspaceDir = workspaceDir
	}

	async readFile(filepath: string): Promise<string> {
		return fs.readFileSync(filepath, "utf-8")
	}

	async writeFile(filepath: string, contents: string): Promise<void> {
		fs.writeFileSync(filepath, contents, "utf-8")
	}

	async getWorkspaceDirs(): Promise<string[]> {
		return [this.workspaceDir]
	}

	async getCurrentFile() {
		if (!this.currentFile) {
			return undefined
		}
		return {
			filepath: this.currentFile,
			contents: await this.readFile(this.currentFile),
		}
	}

	async getCursorPosition(): Promise<Position> {
		// In a simple implementation, you'd track this
		return { line: 0, character: 0 }
	}

	async listWorkspaceContents(directory?: string): Promise<string[]> {
		const dir = directory || this.workspaceDir
		return fs.readdirSync(dir)
	}

	async getVisibleFiles(): Promise<string[]> {
		return this.currentFile ? [this.currentFile] : []
	}

	async applyEdits(edits: FileEdit[]): Promise<void> {
		for (const edit of edits) {
			const contents = await this.readFile(edit.filepath)
			const lines = contents.split("\n")

			// Apply edit
			const startLine = edit.range.start.line
			const endLine = edit.range.end.line
			const startChar = edit.range.start.character
			const endChar = edit.range.end.character

			const before = lines.slice(0, startLine).join("\n") + "\n" + lines[startLine].substring(0, startChar)
			const after = lines[endLine].substring(endChar) + "\n" + lines.slice(endLine + 1).join("\n")

			const newContents = before + edit.replacement + after
			await this.writeFile(edit.filepath, newContents)
		}
	}

	// Implement other required IDE methods...
	async getDefinition(filepath: string, position: Position) {
		return [] // No LSP support in simple implementation
	}

	async getIdeInfo() {
		return {
			name: "SimpleIDE",
			version: "1.0.0",
			remoteName: "",
			extensionVersion: "1.0.0",
		}
	}

	async getIdeSettings() {
		return {
			remoteConfigServerUrl: undefined,
			remoteConfigSyncPeriod: 60,
			userToken: "",
			enableControlServerBeta: false,
			enableDebugLogs: false,
		}
	}

	async isTelemetryEnabled() {
		return false
	}

	async getUniqueId() {
		return "simple-ide-instance"
	}

	// ... implement remaining IDE methods
}
```

---

## Advanced Usage

### Streaming Completions with Progress

```typescript
import { CompletionStreamer } from './core/autocomplete/generation/CompletionStreamer';

class ProgressiveCompletionDisplay {
  private currentCompletion = '';

  async streamCompletion(
    llm: ILLM,
    prefix: string,
    suffix: string,
    prompt: string
  ) {
    const streamer = new CompletionStreamer((error) => {
      console.error('Streaming error:', error);
    });

    const helper = /* create HelperVars */;
    const completionOptions = { /* ... */ };

    const stream = streamer.streamCompletionWithFilters(
      abortController.signal,
      llm,
      prefix,
      suffix,
      prompt,
      true,  // multiline
      completionOptions,
      helper
    );

    // Stream and display progressively
    for await (const chunk of stream) {
      this.currentCompletion += chunk;
      this.updateDisplay(this.currentCompletion);
    }

    return this.currentCompletion;
  }

  private updateDisplay(completion: string) {
    // Update UI with partial completion
    console.log('Current completion:', completion);
  }
}
```

### Custom Context Provider

```typescript
class DatabaseContextProvider {
  async getContextForFile(filepath: string): Promise<string> {
    // Fetch relevant context from database
    const apiDocs = await this.fetchApiDocs(filepath);
    const examples = await this.fetchExamples(filepath);

    return `
API Documentation:
${apiDocs}

Examples:
${examples}
`;
  }

  private async fetchApiDocs(filepath: string): Promise<string> {
    // Query your database for API documentation
    return '/* API docs */';
  }

  private async fetchExamples(filepath: string): Promise<string> {
    // Query for code examples
    return '/* Examples */';
  }
}

// Integrate into context gathering
class EnhancedContextRetrieval {
  private dbProvider = new DatabaseContextProvider();

  async gatherContext(filepath: string, helper: HelperVars) {
    // Standard context
    const standardContext = /* gather using ContextRetrievalService */;

    // Custom context from database
    const dbContext = await this.dbProvider.getContextForFile(filepath);

    return {
      ...standardContext,
      additionalContext: dbContext,
    };
  }
}
```

### Performance Monitoring

```typescript
class PerformanceMonitor {
  private metrics: Map<string, number[]> = new Map();

  async monitorCompletionPerformance() {
    const startTime = Date.now();

    const outcome = await completionProvider.provideInlineCompletionItems(
      /* ... */,
      abortController.signal
    );

    const latency = Date.now() - startTime;

    // Record metric
    this.recordMetric('completion_latency', latency);

    // Log detailed timing
    console.log('Performance:', {
      totalLatency: latency,
      llmLatency: outcome?.latency,
      cacheHit: outcome?.cacheHit,
      completionLength: outcome?.completion.length,
    });

    return outcome;
  }

  private recordMetric(name: string, value: number) {
    const values = this.metrics.get(name) || [];
    values.push(value);
    this.metrics.set(name, values);
  }

  getAverageLatency(): number {
    const latencies = this.metrics.get('completion_latency') || [];
    return latencies.reduce((a, b) => a + b, 0) / latencies.length;
  }

  getCacheHitRate(): number {
    // Calculate from logged outcomes
    return 0.75;  // 75% cache hit rate
  }
}
```

### Error Recovery

```typescript
class ResilientCompletionProvider {
	private fallbackLlm: ILLM
	private maxRetries = 3

	async provideWithFallback(input: any, signal: AbortSignal) {
		for (let attempt = 0; attempt < this.maxRetries; attempt++) {
			try {
				const outcome = await completionProvider.provideInlineCompletionItems(input, signal)

				if (outcome) {
					return outcome
				}
			} catch (error) {
				console.error(`Attempt ${attempt + 1} failed:`, error)

				if (attempt < this.maxRetries - 1) {
					// Wait before retry
					await this.delay(1000 * (attempt + 1))
				} else {
					// Try fallback LLM on final attempt
					return await this.tryFallbackLlm(input, signal)
				}
			}
		}

		return null
	}

	private async tryFallbackLlm(input: any, signal: AbortSignal) {
		console.log("Trying fallback LLM...")
		// Use a simpler/faster model as fallback
		return null
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}
}
```

---

## Testing Examples

### Unit Testing Autocomplete

```typescript
import { CompletionProvider } from "./core/autocomplete"
import { describe, it, expect, vi } from "vitest"

describe("CompletionProvider", () => {
	it("should generate completion", async () => {
		// Mock dependencies
		const mockIde = {
			readFile: vi.fn().mockResolvedValue("file contents"),
			getWorkspaceDirs: vi.fn().mockResolvedValue(["/workspace"]),
			// ... other methods
		}

		const mockLlm = {
			model: "gpt-4",
			streamFim: async function* (prefix, suffix, signal) {
				yield "function "
				yield "test() {"
				yield "\n  return true;\n}"
			},
			// ... other methods
		}

		const config = new MinimalConfigProvider()
		const provider = new CompletionProvider(
			config,
			mockIde as any,
			async () => mockLlm as any,
			(e) => console.error(e),
			async () => [],
		)

		// Request completion
		const outcome = await provider.provideInlineCompletionItems(
			{
				filepath: "/test.ts",
				pos: { line: 5, character: 0 },
				completionId: "test-1",
				recentlyEditedRanges: [],
				recentlyEditedFiles: new Map(),
				clipboardText: "",
			},
			new AbortController().signal,
		)

		expect(outcome).toBeDefined()
		expect(outcome?.completion).toContain("function test()")
	})
})
```

---

## See Also

- [README.md](README.md) - Project overview
- [API_REFERENCE.md](API_REFERENCE.md) - Detailed API documentation
- [ARCHITECTURE.md](ARCHITECTURE.md) - Technical architecture
- [VSCode Test Harness](core/vscode-test-harness/) - Complete integration example
