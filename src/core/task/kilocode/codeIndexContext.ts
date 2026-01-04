// kilocode_change - new file

import type { VectorStoreSearchResult } from "../../../services/code-index/interfaces"
import type { ApiMessage } from "../../task-persistence/apiMessages"

export type CodeIndexContextOptions = {
	maxResults: number
	maxChars: number
}

const DEFAULT_OPTIONS: CodeIndexContextOptions = {
	maxResults: 8,
	maxChars: 6000,
}

export function extractLatestUserQuery(messages: ApiMessage[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]
		if (m?.role !== "user") continue

		const content: any = m.content
		if (typeof content === "string") {
			const trimmed = content.trim()
			return trimmed.length ? trimmed : undefined
		}

		if (Array.isArray(content)) {
			const text = content
				.filter((b: any) => b?.type === "text" && typeof b.text === "string")
				.map((b: any) => b.text)
				.join("\n")
				.trim()
			return text.length ? text : undefined
		}
	}

	return undefined
}

export function formatCodeIndexContext(
	results: VectorStoreSearchResult[],
	options: Partial<CodeIndexContextOptions> = {},
): string {
	const { maxResults, maxChars } = { ...DEFAULT_OPTIONS, ...options }

	const rows = results.filter((r) => r.payload && r.payload.filePath && r.payload.codeChunk).slice(0, maxResults)

	if (rows.length === 0) return ""

	let out = "\n\n# Retrieved Code Context\n\n"
	for (const r of rows) {
		const p = r.payload!
		out += `File: ${p.filePath}\nLines: ${p.startLine}-${p.endLine}\nScore: ${r.score}\n\n${p.codeChunk}\n\n---\n\n`
		if (out.length >= maxChars) {
			out = out.slice(0, maxChars)
			break
		}
	}

	return out.trimEnd()
}
