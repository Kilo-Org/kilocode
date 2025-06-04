import { z } from "zod"

// Generic context for LLM interactions that can be extended for specific use cases
export interface LLMToolContext {
	[key: string]: any
}

// LLM prompt section structure
export interface LLMPromptSection {
	id: string
	title: string
	content: string
	order: number
}

// Generic LLM tool result
export interface LLMToolResult<T = any> {
	toolId: string
	type: string
	data: T
	confidence?: number
	timestamp: Date
	metadata?: Record<string, any>
}

// LLM prompt template system
export interface LLMPromptTemplate {
	systemPrefix?: string
	systemSuffix?: string
	sectionSeparator?: string
	includeToolList?: boolean
	customFormatting?: (sections: LLMPromptSection[]) => string
}

// Tool configuration for functional API
export interface ToolConfig<TSchema extends z.ZodTypeAny = z.ZodTypeAny, TData = z.infer<TSchema>> {
	id: string
	name: string
	description: string
	schema: TSchema
	xmlTag: string
	handler?: (data: TData, context: LLMToolContext) => Promise<any> | any
	enabled?: boolean
	metadata?: Record<string, any>
	version?: string
	category?: string
}

// Tool interface for functional API
export interface Tool<TSchema extends z.ZodTypeAny = z.ZodTypeAny, TData = z.infer<TSchema>> {
	id: string
	name: string
	description: string
	schema: TSchema
	xmlTag: string
	enabled: boolean
	metadata?: Record<string, any>
	version: string
	category: string
	generateXML: () => string
	generatePrompt: (instructions?: string[]) => LLMPromptSection
	handleResponse: (data: TData, context: LLMToolContext) => Promise<any> | any
}

// Type for tool registry to maintain type information
export type ToolRegistry = {
	[id: string]: {
		tool: Tool<any, any>
		schema: z.ZodTypeAny
		dataType: any
	}
}

// Tool system interface for functional API
export interface ToolSystem<T extends ToolRegistry = {}> {
	// Add a tool and return a new system with updated registry type
	addTool: <S extends z.ZodTypeAny, R = z.infer<S>>(
		tool: Tool<S, R>,
	) => ToolSystem<T & { [K in typeof tool.id]: { tool: Tool<S, R>; schema: S; dataType: R } }>

	// Type-safe callbacks
	onToolResponse: {
		// Global callback for any tool
		<K extends keyof T>(callback: (toolId: K, data: T[K]["dataType"]) => void): ToolSystem<T>

		// Tool-specific callback with proper typing
		<K extends keyof T & string>(toolId: K, callback: (data: T[K]["dataType"]) => void): ToolSystem<T>
	}

	generatePrompt: (options: { userMessage: string; systemMessage?: string }) => string

	processStream: (
		stream: AsyncIterable<string>,
		options?: {
			onChunk?: (chunk: string) => void
			onComplete?: () => void
			onError?: (error: Error) => void
		},
	) => Promise<ToolSystem<T>>

	terminateStream: (reason?: string) => ToolSystem<T>

	// Type-safe results
	getResults: () => { [K in keyof T]?: T[K]["dataType"] }
	getResult: <K extends keyof T>(toolId: K) => T[K]["dataType"] | undefined
}

// XML parser interface for functional API
export interface XMLParser {
	processChunk: (chunk: string) => Array<{ toolId: string; data: any }>
}
