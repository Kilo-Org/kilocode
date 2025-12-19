import type { ClineSayTool } from "../../shared/ExtensionMessage"

export function isWriteToolAction(tool: ClineSayTool): boolean {
	return ["editedExistingFile", "appliedDiff", "newFileCreated", "generateImage"].includes(tool.tool)
}

export function isReadOnlyToolAction(tool: ClineSayTool): boolean {
	return [
		"readFile",
		"listFiles",
		"listFilesTopLevel",
		"listFilesRecursive",
		"searchFiles",
		"codebaseSearch",
		"runSlashCommand",
	].includes(tool.tool)
}
