import Parser from "web-tree-sitter"

// Stub types that were in yaml-package (no longer needed for minimal autocomplete)
export type ModelRole = "chat" | "edit" | "autocomplete" | "apply" | "repoMapFileSelection"
export type PromptTemplates = Record<string, any>

declare global {
	interface Window {
		ide?: "vscode"
		windowId: string
		serverUrl: string
		vscMachineId: string
		vscMediaUrl: string
		fullColorTheme?: {
			rules?: {
				token?: string
				foreground?: string
			}[]
		}
		colorThemeName?: string
		workspacePaths?: string[]
		postIntellijMessage?: (messageType: string, data: any, messageIde: string) => void
	}
}

export interface ChunkWithoutID {
	content: string
	startLine: number
	endLine: number
	signature?: string
	otherMetadata?: { [key: string]: any }
}

export interface Chunk extends ChunkWithoutID {
	digest: string
	filepath: string
	index: number // Index of the chunk in the document at filepath
}

export interface IndexingProgressUpdate {
	progress: number
	desc: string
	shouldClearIndexes?: boolean
	status: "loading" | "waiting" | "indexing" | "done" | "failed" | "paused" | "disabled" | "cancelled"
	debugInfo?: string
	warnings?: string[]
}

export type PromptTemplateFunction = (
	history: ChatMessage[],
	otherData: Record<string, string>,
) => string | ChatMessage[]

export type PromptTemplate = string | PromptTemplateFunction

type RequiredLLMOptions = "uniqueId" | "contextLength" | "completionOptions"

export interface ILLM extends Omit<LLMOptions, RequiredLLMOptions>, Required<Pick<LLMOptions, RequiredLLMOptions>> {
	get providerName(): string
	get underlyingProviderName(): string

	autocompleteOptions?: Partial<TabAutocompleteOptions>

	lastRequestId?: string

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

	chat(messages: ChatMessage[], signal: AbortSignal, options?: LLMFullCompletionOptions): Promise<ChatMessage>

	rerank(query: string, chunks: Chunk[]): Promise<number[]>

	countTokens(text: string): number

	supportsFim(): boolean
}

// Narrowed interface for autocomplete and NextEdit consumers
export interface IAutocompleteNextEditLLM {
	// Core identification
	readonly providerName: string
	readonly underlyingProviderName: string
	model: string
	title?: string

	// API configuration
	apiKey?: string
	apiBase?: string

	// Capabilities and options
	capabilities?: ModelCapability
	contextLength: number
	completionOptions: CompletionOptions
	autocompleteOptions?: Partial<TabAutocompleteOptions>
	promptTemplates?: Partial<Record<keyof PromptTemplates, PromptTemplate>>
	useLegacyCompletionsEndpoint?: boolean

	// State
	lastRequestId?: string

	// Required methods for autocomplete
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

	supportsFim(): boolean

	// Required methods for NextEdit
	chat(messages: ChatMessage[], signal: AbortSignal, options?: LLMFullCompletionOptions): Promise<ChatMessage>

	// Required for token counting
	countTokens(text: string): number

	// Required for reranking (NextEdit editable region calculation)
	rerank(query: string, chunks: Chunk[]): Promise<number[]>
}

export type ContextProviderType = "normal" | "query" | "submenu"
export type ContextIndexingType = "chunk" | "embeddings" | "fullTextSearch" | "codeSnippets"

export interface ContextProviderDescription {
	title: ContextProviderName
	displayTitle: string
	description: string
	renderInlineAs?: string
	type: ContextProviderType
	dependsOnIndexing?: ContextIndexingType[]
}

export type FetchFunction = (url: string | URL, init?: any) => Promise<any>

export interface RangeInFile {
	filepath: string
	range: Range
}

export interface Location {
	filepath: string
	position: Position
}

export interface Range {
	start: Position
	end: Position
}

export interface Position {
	line: number
	character: number
}

export interface CompletionOptions extends BaseCompletionOptions {
	model: string
}

export type ChatMessageRole = "user" | "assistant" | "system" | "tool"

export type TextMessagePart = {
	type: "text"
	text: string
}

export type MessagePart = TextMessagePart

export type MessageContent = string | MessagePart[]

export interface UserChatMessage {
	role: "user"
	content: MessageContent
}

/**
 * This is meant to be equivalent to the OpenAI [usage object](https://platform.openai.com/docs/api-reference/chat/object#chat/object-usage)
 * but potentially with additional information that is needed for other providers.
 */
export interface Usage {
	completionTokens: number
	promptTokens: number
	promptTokensDetails?: {
		cachedTokens?: number
		/** This an Anthropic-specific property */
		cacheWriteTokens?: number
		audioTokens?: number
	}
}

export interface AssistantChatMessage {
	role: "assistant"
	content: MessageContent
	usage?: Usage
}

export interface SystemChatMessage {
	role: "system"
	content: string
}

export type ChatMessage = UserChatMessage | AssistantChatMessage | SystemChatMessage

export interface ContextItemId {
	providerTitle: string
	itemId: string
}

export type ContextItemUriTypes = "file" | "url"

export interface ContextItemUri {
	type: ContextItemUriTypes
	value: string
}

export interface SymbolWithRange extends RangeInFile {
	name: string
	type: Parser.SyntaxNode["type"]
	content: string
}

export interface PromptLog {
	modelTitle: string
	modelProvider: string
	prompt: string
	completion: string
}

export interface LLMFullCompletionOptions extends BaseCompletionOptions {
	log?: boolean
}

export interface LLMInteractionBase {
	interactionId: string
	timestamp: number
}

export interface LLMInteractionStartChat extends LLMInteractionBase {
	kind: "startChat"
	messages: ChatMessage[]
	options: CompletionOptions
	provider: string
}

export interface LLMInteractionStartComplete extends LLMInteractionBase {
	kind: "startComplete"
	prompt: string
	options: CompletionOptions
	provider: string
}

export interface LLMInteractionStartFim extends LLMInteractionBase {
	kind: "startFim"
	prefix: string
	suffix: string
	options: CompletionOptions
	provider: string
}

export interface LLMInteractionChunk extends LLMInteractionBase {
	kind: "chunk"
	chunk: string
}

export interface LLMInteractionMessage extends LLMInteractionBase {
	kind: "message"
	message: ChatMessage
}

export interface LLMInteractionEnd extends LLMInteractionBase {
	promptTokens: number
	generatedTokens: number
	usage: Usage | undefined
}

export interface LLMInteractionSuccess extends LLMInteractionEnd {
	kind: "success"
}

export interface LLMInteractionCancel extends LLMInteractionEnd {
	kind: "cancel"
}

export interface LLMInteractionError extends LLMInteractionEnd {
	kind: "error"
	name: string
	message: string
}

export type LLMInteractionItem =
	| LLMInteractionStartChat
	| LLMInteractionStartComplete
	| LLMInteractionStartFim
	| LLMInteractionChunk
	| LLMInteractionMessage
	| LLMInteractionSuccess
	| LLMInteractionCancel
	| LLMInteractionError

// When we log a LLM interaction, we want to add the interactionId and timestamp
// in the logger code, so we need a type that omits these members from *each*
// member of the union. This can be done by using the distributive behavior of
// conditional types in Typescript.
//
// www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types
// https://stackoverflow.com/questions/57103834/typescript-omit-a-property-from-all-interfaces-in-a-union-but-keep-the-union-s
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type LLMInteractionItemDetails = DistributiveOmit<LLMInteractionItem, "interactionId" | "timestamp">

export interface ILLMInteractionLog {
	logItem(item: LLMInteractionItemDetails): void
}

export interface ILLMLogger {
	createInteractionLog(): ILLMInteractionLog
}

export interface LLMOptions {
	model: string
	title?: string
	uniqueId?: string
	autocompleteOptions?: Partial<TabAutocompleteOptions>
	contextLength?: number
	maxStopWords?: number
	completionOptions?: CompletionOptions
	chatStreams?: MockMessage[][]
	apiKey?: string
	apiBase?: string
	useLegacyCompletionsEndpoint?: boolean
	capabilities?: ModelCapability
	env?: Record<string, string | number | boolean | undefined>
	promptTemplates?: Partial<Record<keyof PromptTemplates, PromptTemplate>>
	fimProvider?: IFimProvider // to call a kilocode provider definition
}

type RequireAtLeastOne<T, Keys extends keyof T = keyof T> = Pick<T, Exclude<keyof T, Keys>> &
	{
		[K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>>
	}[Keys]

export interface CustomLLMWithOptionals {
	options: LLMOptions
	streamCompletion?: (
		prompt: string,
		signal: AbortSignal,
		options: CompletionOptions,
		fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
	) => AsyncGenerator<string>
	streamChat?: (
		messages: ChatMessage[],
		signal: AbortSignal,
		options: CompletionOptions,
		fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
	) => AsyncGenerator<ChatMessage | string>
}

/**
 * The LLM interface requires you to specify either `streamCompletion` or `streamChat` (or both).
 */
export type CustomLLM = RequireAtLeastOne<CustomLLMWithOptionals, "streamCompletion" | "streamChat">

// IDE

export type DiffType = "new" | "old" | "same"

export interface DiffObject {
	type: DiffType
}

export interface DiffLine extends DiffObject {
	line: string
}

export interface DiffChar extends DiffObject {
	char: string
	oldIndex?: number // Character index assuming a flattened line string.
	newIndex?: number
	oldCharIndexInLine?: number // Character index assuming new lines reset the character index to 0.
	newCharIndexInLine?: number
	oldLineIndex?: number
	newLineIndex?: number
}

export type IdeType = "vscode" | "jetbrains"

export interface IdeInfo {
	ideType: IdeType
}

export interface BranchAndDir {
	branch: string
	directory: string
}

export interface IndexTag extends BranchAndDir {
	artifactId: string
}

export interface FileStats {
	size: number
	lastModified: number
}

/** Map of file name to stats */
export type FileStatsMap = {
	[path: string]: FileStats
}

export interface IDE {
	getIdeInfo(): Promise<IdeInfo>

	getClipboardContent(): Promise<{ text: string; copiedAt: string }>

	getUniqueId(): Promise<string>

	getWorkspaceDirs(): Promise<string[]>

	fileExists(fileUri: string): Promise<boolean>

	writeFile(path: string, contents: string): Promise<void>

	saveFile(fileUri: string): Promise<void>

	readFile(fileUri: string): Promise<string>

	readRangeInFile(fileUri: string, range: Range): Promise<string>

	getOpenFiles(): Promise<string[]>

	getCurrentFile(): Promise<
		| undefined
		| {
				isUntitled: boolean
				path: string
				contents: string
		  }
	>

	getFileStats(files: string[]): Promise<FileStatsMap>

	// LSP
	gotoDefinition(location: Location): Promise<RangeInFile[]>
	gotoTypeDefinition(location: Location): Promise<RangeInFile[]> // TODO: add to jetbrains
	getSignatureHelp(location: Location): Promise<SignatureHelp | null> // TODO: add to jetbrains
	getReferences(location: Location): Promise<RangeInFile[]>
	getDocumentSymbols(textDocumentIdentifier: string): Promise<DocumentSymbol[]>

	// Callbacks
	onDidChangeActiveTextEditor(callback: (fileUri: string) => void): void
}
export type ContextProviderName =
	| "diff"
	| "terminal"
	| "debugger"
	| "open"
	| "google"
	| "search"
	| "tree"
	| "http"
	| "codebase"
	| "problems"
	| "folder"
	| "jira"
	| "postgres"
	| "database"
	| "code"
	| "docs"
	| "gitlab-mr"
	| "os"
	| "currentFile"
	| "greptile"
	| "outline"
	| "continue-proxy"
	| "highlights"
	| "file"
	| "issue"
	| "repo-map"
	| "url"
	| "commit"
	| "web"
	| "discord"
	| "clipboard"
	| string

export interface CacheBehavior {
	cacheSystemMessage?: boolean
	cacheConversation?: boolean
}

export interface BaseCompletionOptions {
	temperature?: number
	topP?: number
	presencePenalty?: number
	frequencyPenalty?: number
	stop?: string[]
	maxTokens?: number
	raw?: boolean
	stream?: boolean
	reasoning?: boolean
	reasoningBudgetTokens?: number
	promptCaching?: boolean
}

export interface ModelCapability {
	uploadImage?: boolean
	tools?: boolean
	nextEdit?: boolean
}

export interface JSONEmbedOptions {
	apiBase?: string
	apiKey?: string
	model?: string
	deployment?: string
	apiType?: string
	apiVersion?: string
	maxEmbeddingChunkSize?: number
	maxEmbeddingBatchSize?: number

	// AWS options
	profile?: string

	// AWS and VertexAI Options
	region?: string

	// VertexAI and Watsonx Options
	projectId?: string
}

// TODO: We should consider renaming this to AutocompleteOptions.
export interface TabAutocompleteOptions {
	disable: boolean
	maxPromptTokens: number
	debounceDelay: number
	modelTimeout: number
	maxSuffixPercentage: number
	prefixPercentage: number
	maxSnippetPercentage: number
	transform?: boolean
	multilineCompletions: "always" | "never" | "auto"
	slidingWindowPrefixPercentage: number
	slidingWindowSize: number
	useCache: boolean
	onlyMyCode: boolean
	useRecentlyEdited: boolean
	useRecentlyOpened: boolean
	disableInFiles?: string[]
	useImports?: boolean
	showWhateverWeHaveAtXMs?: number
	// true = enabled, false = disabled, number = enabled with priority
	experimental_includeClipboard: boolean | number
	experimental_includeRecentlyVisitedRanges: boolean | number
	experimental_includeRecentlyEditedRanges: boolean | number
	experimental_includeDiff: boolean | number
	experimental_enableStaticContextualization: boolean
}

export interface RangeInFileWithContents {
	filepath: string
	range: {
		start: { line: number; character: number }
		end: { line: number; character: number }
	}
	contents: string
}

export interface RangeInFileWithNextEditInfo {
	filepath: string
	range: Range
	fileContents: string
	editText: string
	afterCursorPos: Position
	beforeCursorPos: Position
	workspaceDir: string
}

/**
 * Signature help represents the signature of something
 * callable. There can be multiple signatures but only one
 * active and only one active parameter.
 */
export class SignatureHelp {
	/**
	 * One or more signatures.
	 */
	signatures: SignatureInformation[]

	/**
	 * The active signature.
	 */
	activeSignature: number

	/**
	 * The active parameter of the active signature.
	 */
	activeParameter: number
}

/**
 * Represents the signature of something callable. A signature
 * can have a label, like a function-name, a doc-comment, and
 * a set of parameters.
 */
export class SignatureInformation {
	/**
	 * The label of this signature. Will be shown in
	 * the UI.
	 */
	label: string
	/**
	 * The parameters of this signature.
	 */
	parameters: ParameterInformation[]

	/**
	 * The index of the active parameter.
	 *
	 * If provided, this is used in place of {@linkcode SignatureHelp.activeParameter}.
	 */
	activeParameter?: number
}

export type ConfigMergeType = "merge" | "overwrite"

export interface CompiledMessagesResult {
	compiledChatMessages: ChatMessage[]
	didPrune: boolean
	contextPercentage: number
}

export interface MessageOption {
	precompiled: boolean
}

// See https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#symbolKind.
// We shift this one index down to match vscode.SymbolKind.
export enum SymbolKind {
	File = 0,
	Module = 1,
	Namespace = 2,
	Package = 3,
	Class = 4,
	Method = 5,
	Property = 6,
	Field = 7,
	Constructor = 8,
	Enum = 9,
	Interface = 10,
	Function = 11,
	Variable = 12,
	Constant = 13,
	String = 14,
	Number = 15,
	Boolean = 16,
	Array = 17,
	Object = 18,
	Key = 19,
	Null = 20,
	EnumMember = 21,
	Struct = 22,
	Event = 23,
	Operator = 24,
	TypeParameter = 25,
}

// See https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#symbolTag.
export type SymbolTag = 1

// See https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#documentSymbol.
export interface DocumentSymbol {
	name: string
	detail?: string
	kind: SymbolKind
	tags?: SymbolTag[]
	deprecated?: boolean
	range: Range
	selectionRange: Range
	children?: DocumentSymbol[]
}
