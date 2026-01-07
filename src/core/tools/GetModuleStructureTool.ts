// kilocode_change - new file

import * as path from "path"

import { Task } from "../task/Task"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { formatResponse } from "../prompts/responses"
import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { listFiles } from "../../services/glob/list-files"

interface GetModuleStructureParams {
	path?: string | null
	depth?: number | null
}

function clampDepth(depth: number | null | undefined): number {
	if (typeof depth !== "number" || Number.isNaN(depth)) return 2
	return Math.max(1, Math.min(4, Math.floor(depth)))
}

function toTree(paths: string[], root: string, depth: number): string {
	const rootAbs = path.resolve(root)
	const lines: string[] = []
	const seen = new Set<string>()

	const filtered = paths
		.map((p) => (p.endsWith("/") ? p.slice(0, -1) : p))
		.map((p) => path.resolve(p))
		.filter((p) => p.startsWith(rootAbs))
		.map((p) => path.relative(rootAbs, p))
		.filter((p) => p && p !== ".")

	for (const rel of filtered) {
		const parts = rel.split(path.sep).filter(Boolean)
		const limited = parts.slice(0, depth)
		let current = ""
		for (let i = 0; i < limited.length; i++) {
			current = current ? path.join(current, limited[i]) : limited[i]
			if (seen.has(current)) continue
			seen.add(current)
			lines.push(
				`${"  ".repeat(i)}- ${limited[i]}${i === limited.length - 1 && parts.length > limited.length ? "/…" : ""}`,
			)
		}
	}

	lines.sort((a, b) => a.localeCompare(b))
	return lines.join("\n")
}

export class GetModuleStructureTool extends BaseTool<"get_module_structure"> {
	readonly name = "get_module_structure" as const

	parseLegacy(params: Partial<Record<string, string>>): GetModuleStructureParams {
		const depthRaw = params.depth
		const depth = depthRaw ? Number(depthRaw) : undefined
		return {
			path: params.path || undefined,
			depth: Number.isFinite(depth as number) ? (depth as number) : undefined,
		}
	}

	async execute(params: GetModuleStructureParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks

		const relDirPath = params.path ?? ""
		const depth = clampDepth(params.depth)

		const absolutePath = relDirPath ? path.resolve(task.cwd, relDirPath) : task.cwd
		const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)

		const sharedMessageProps: ClineSayTool = {
			tool: "listFilesRecursive",
			path: getReadablePath(task.cwd, relDirPath || "."),
			isOutsideWorkspace,
		}

		try {
			const [files] = await listFiles(absolutePath, true, 2000)
			const tree = toTree(files, absolutePath, depth)
			const result = tree || "(no files found)"

			const completeMessage = JSON.stringify({ ...sharedMessageProps, content: result } satisfies ClineSayTool)
			const didApprove = await askApproval("tool", completeMessage)
			if (!didApprove) {
				return
			}

			pushToolResult(formatResponse.toolResult(result))
		} catch (error) {
			await handleError("getting module structure", error as Error)
			pushToolResult(formatResponse.toolError((error as Error).message))
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"get_module_structure">): Promise<void> {
		const relDirPath = block.params.path
		const sharedMessageProps: ClineSayTool = {
			tool: "listFilesRecursive",
			path: getReadablePath(task.cwd, this.removeClosingTag("path", relDirPath, block.partial)),
			isOutsideWorkspace: false,
		}
		await task
			.ask("tool", JSON.stringify({ ...sharedMessageProps, content: "" } satisfies ClineSayTool), block.partial)
			.catch(() => {})
	}
}

export const getModuleStructureTool = new GetModuleStructureTool()
