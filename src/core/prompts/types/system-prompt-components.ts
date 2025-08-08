export type SystemPromptComponentType =
	| "roleDefinition"
	| "toolUse"
	| "rules"
	| "systemInfo"
	| "capabilities"
	| "modes"
	| "objective"
	| "customInstructions"
	| "markdownFormatting"
	| "mcpServers"

export type SystemPromptComponentConfig = {
	type: "default" | "custom"
	customPath?: string // 相对于项目根目录的路径，默认为 .kilo/prompt/{componentType}.md
}

export type SystemPromptComponentsConfig = {
	[K in SystemPromptComponentType]: SystemPromptComponentConfig
}

// 默认配置
export const defaultSystemPromptComponentsConfig: SystemPromptComponentsConfig = {
	roleDefinition: { type: "default" },
	toolUse: { type: "default" },
	rules: { type: "default" },
	systemInfo: { type: "default" },
	capabilities: { type: "default" },
	modes: { type: "default" },
	objective: { type: "default" },
	customInstructions: { type: "default" },
	markdownFormatting: { type: "default" },
	mcpServers: { type: "default" },
}

// 获取组件的默认文件路径
export function getDefaultComponentPath(componentType: SystemPromptComponentType): string {
	return `.kilo/prompt/${componentType}.md`
}

// 获取组件的实际文件路径
export function getComponentPath(
	config: SystemPromptComponentConfig,
	componentType: SystemPromptComponentType,
): string {
	return config.customPath || getDefaultComponentPath(componentType)
}
