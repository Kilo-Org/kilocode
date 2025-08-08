import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"

import type {
	SystemPromptComponentType,
	SystemPromptComponentConfig,
	SystemPromptComponentsConfig,
} from "../types/system-prompt-components"
import {
	getComponentPath,
	getDefaultComponentPath,
	defaultSystemPromptComponentsConfig,
} from "../types/system-prompt-components"

/**
 * 读取自定义提示词组件文件内容
 * @param cwd 工作目录
 * @param componentType 组件类型
 * @param config 组件配置
 * @returns 文件内容，如果文件不存在或读取失败则返回null
 */
export async function loadCustomPromptComponent(
	cwd: string,
	componentType: SystemPromptComponentType,
	config: SystemPromptComponentConfig,
): Promise<string | null> {
	if (config.type !== "custom") {
		return null
	}

	try {
		const filePath = getComponentPath(config, componentType)
		const fullPath = path.resolve(cwd, filePath)

		// 检查文件是否存在
		if (!fs.existsSync(fullPath)) {
			console.warn(`Custom prompt component file not found: ${fullPath}`)
			return null
		}

		// 读取文件内容
		const content = fs.readFileSync(fullPath, "utf-8")
		return content.trim()
	} catch (error) {
		console.error(`Error loading custom prompt component ${componentType}:`, error)
		return null
	}
}

/**
 * 确保.kilo/prompt目录存在
 * @param cwd 工作目录
 */
export async function ensurePromptDirectory(cwd: string): Promise<void> {
	try {
		const promptDir = path.resolve(cwd, ".kilo", "prompt")
		if (!fs.existsSync(promptDir)) {
			fs.mkdirSync(promptDir, { recursive: true })
		}
	} catch (error) {
		console.error("Error creating prompt directory:", error)
	}
}

/**
 * 获取系统提示词组件配置
 * @param context VSCode扩展上下文
 * @returns 组件配置
 */
export function getSystemPromptComponentsConfig(context: vscode.ExtensionContext): SystemPromptComponentsConfig {
	const config = context.workspaceState.get<SystemPromptComponentsConfig>("systemPromptComponentsConfig")

	if (!config) {
		// 返回默认配置
		return defaultSystemPromptComponentsConfig
	}

	return config
}

/**
 * 保存系统提示词组件配置
 * @param context VSCode扩展上下文
 * @param config 组件配置
 */
export async function saveSystemPromptComponentsConfig(
	context: vscode.ExtensionContext,
	config: SystemPromptComponentsConfig,
): Promise<void> {
	await context.workspaceState.update("systemPromptComponentsConfig", config)
}

/**
 * 创建默认的自定义提示词文件
 * @param cwd 工作目录
 * @param componentType 组件类型
 * @param defaultContent 默认内容
 */
export async function createDefaultPromptFile(
	cwd: string,
	componentType: SystemPromptComponentType,
	defaultContent: string,
): Promise<void> {
	try {
		await ensurePromptDirectory(cwd)

		const filePath = getDefaultComponentPath(componentType)
		const fullPath = path.resolve(cwd, filePath)

		// 如果文件不存在，创建默认文件
		if (!fs.existsSync(fullPath)) {
			fs.writeFileSync(fullPath, defaultContent, "utf-8")
		}
	} catch (error) {
		console.error(`Error creating default prompt file for ${componentType}:`, error)
	}
}
