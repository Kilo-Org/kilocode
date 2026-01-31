import type { CLIConfig, AutoApprovalConfig, CodebaseIndexConfig } from "./types.js"

/**
 * Default code indexing configuration
 * Disabled by default - users must explicitly enable and configure
 */
export const DEFAULT_CODEBASE_INDEX_CONFIG: CodebaseIndexConfig = {
	codebaseIndexEnabled: false,
	codebaseIndexVectorStoreProvider: "qdrant",
	codebaseIndexQdrantUrl: "http://localhost:6333",
	codebaseIndexEmbedderProvider: "openai",
	codebaseIndexEmbedderBaseUrl: "",
	codebaseIndexEmbedderModelId: "",
	codebaseIndexBedrockRegion: "us-east-1",
}

/**
 * Default auto approval configuration
 * Matches the defaults from the webview settings
 */
export const DEFAULT_AUTO_APPROVAL: AutoApprovalConfig = {
	enabled: true,
	read: {
		enabled: true,
		outside: false,
	},
	write: {
		enabled: true,
		outside: true,
		protected: false,
	},
	browser: {
		enabled: false,
	},
	retry: {
		enabled: false,
		delay: 10,
	},
	mcp: {
		enabled: true,
	},
	mode: {
		enabled: true,
	},
	subtasks: {
		enabled: true,
	},
	execute: {
		enabled: true,
		allowed: ["ls", "cat", "echo", "pwd"],
		denied: ["rm -rf", "sudo rm", "mkfs", "dd if="],
	},
	question: {
		enabled: false,
		timeout: 60,
	},
	todo: {
		enabled: true,
	},
}

export const DEFAULT_CONFIG = {
	version: "1.0.0",
	mode: "code",
	telemetry: true,
	provider: "default",
	providers: [
		{
			id: "default",
			provider: "kilocode",
			kilocodeToken: "",
			kilocodeModel: "x-ai/grok-code-fast-1",
		},
	],
	autoApproval: DEFAULT_AUTO_APPROVAL,
	codebaseIndexConfig: DEFAULT_CODEBASE_INDEX_CONFIG,
	theme: "dark",
	customThemes: {},
} satisfies CLIConfig
