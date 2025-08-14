import path from "path"
import { GlobalSettings } from "@roo-code/types"

/**
 * 检查文件是否为markdown文件
 * @param filePath 文件路径
 * @returns 是否为markdown文件
 */
export function isMarkdownFile(filePath: string): boolean {
	const ext = path.extname(filePath).toLowerCase()
	return ext === ".md" || ext === ".markdown"
}

/**
 * 检查文件操作是否被markdown限制设置阻止
 * @param filePath 文件路径
 * @param globalSettings 全局设置
 * @throws 如果操作被阻止则抛出错误
 */
export function validateMarkdownOnlyRestriction(filePath: string, globalSettings: GlobalSettings): void {
	// 如果markdown限制设置未启用，允许所有操作
	if (!globalSettings.alwaysAllowEditMarkdownOnly) {
		return
	}

	// 如果启用了markdown限制，检查文件是否为markdown文件
	if (!isMarkdownFile(filePath)) {
		throw new Error(
			`File operation blocked: Only markdown files (.md, .markdown) are allowed when "Edit Markdown Only" setting is enabled. Attempted to edit: ${filePath}`,
		)
	}
}

/**
 * 检查多个文件路径是否都符合markdown限制
 * @param filePaths 文件路径数组
 * @param globalSettings 全局设置
 * @throws 如果任何文件操作被阻止则抛出错误
 */
export function validateMarkdownOnlyRestrictionForMultipleFiles(
	filePaths: string[],
	globalSettings: GlobalSettings,
): void {
	for (const filePath of filePaths) {
		validateMarkdownOnlyRestriction(filePath, globalSettings)
	}
}
