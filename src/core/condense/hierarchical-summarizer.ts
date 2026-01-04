// kilocode_change - new file
// Task 4.1.1: Hierarchical Summarizer

import { ApiHandler } from "../../api"
import { ApiMessage } from "../task-persistence/apiMessages"

/**
 * Summary level in the hierarchy
 */
export type SummaryLevel = "detailed" | "standard" | "brief" | "minimal"

/**
 * A node in the summary tree
 */
export interface SummaryNode {
	id: string
	level: SummaryLevel
	content: string
	tokenCount: number
	parentId?: string
	childIds: string[]
	messageRange: {
		startIndex: number
		endIndex: number
	}
	createdAt: number
	metadata?: Record<string, any>
}

/**
 * Summary tree structure
 */
export interface SummaryTree {
	rootId: string
	nodes: Map<string, SummaryNode>
	totalTokens: number
	levels: SummaryLevel[]
}

/**
 * Configuration for hierarchical summarization
 */
export interface HierarchicalSummarizerConfig {
	/** Target token counts for each level */
	levelTokenTargets: Record<SummaryLevel, number>
	/** Minimum messages before creating a summary */
	minMessagesForSummary: number
	/** Maximum messages per summary node */
	maxMessagesPerNode: number
	/** Whether to preserve code blocks */
	preserveCodeBlocks: boolean
	/** Custom summarization prompts per level */
	customPrompts?: Record<SummaryLevel, string>
}

const DEFAULT_CONFIG: HierarchicalSummarizerConfig = {
	levelTokenTargets: {
		detailed: 2000,
		standard: 1000,
		brief: 500,
		minimal: 200,
	},
	minMessagesForSummary: 5,
	maxMessagesPerNode: 20,
	preserveCodeBlocks: true,
}

const LEVEL_PROMPTS: Record<SummaryLevel, string> = {
	detailed: `Create a detailed summary of the following conversation segment. 
Include:
- All key decisions and their rationale
- Technical details and code changes
- File paths and function names mentioned
- Any issues or errors discussed
- Next steps or pending items

Be thorough but concise. Preserve important context.`,

	standard: `Summarize this conversation segment, covering:
- Main topics discussed
- Key decisions made
- Important technical details
- Current status

Keep the summary focused and informative.`,

	brief: `Create a brief summary of this conversation:
- Main topic
- Key outcomes
- Critical decisions

Be very concise while retaining essential information.`,

	minimal: `Provide a one-paragraph summary capturing only the most critical points of this conversation.`,
}

/**
 * Hierarchical conversation summarizer that creates multi-level summaries
 * for efficient context management.
 */
export class HierarchicalSummarizer {
	private config: HierarchicalSummarizerConfig
	private summaryTrees: Map<string, SummaryTree> = new Map()

	constructor(config: Partial<HierarchicalSummarizerConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config }
	}

	/**
	 * Create or update a summary tree for a conversation
	 */
	async createSummaryTree(taskId: string, messages: ApiMessage[], apiHandler: ApiHandler): Promise<SummaryTree> {
		const existingTree = this.summaryTrees.get(taskId)

		if (existingTree && this.canUpdateExisting(existingTree, messages)) {
			return this.updateSummaryTree(existingTree, messages, apiHandler)
		}

		return this.buildNewTree(taskId, messages, apiHandler)
	}

	/**
	 * Get the best summary for a given token budget
	 */
	getSummaryForBudget(taskId: string, tokenBudget: number): string[] {
		const tree = this.summaryTrees.get(taskId)
		if (!tree) return []

		const summaries: string[] = []
		let tokensUsed = 0

		// Start with the most condensed (root) and expand as budget allows
		const queue: string[] = [tree.rootId]
		const visited = new Set<string>()

		while (queue.length > 0 && tokensUsed < tokenBudget) {
			const nodeId = queue.shift()!
			if (visited.has(nodeId)) continue
			visited.add(nodeId)

			const node = tree.nodes.get(nodeId)
			if (!node) continue

			// Check if we can fit this node
			if (tokensUsed + node.tokenCount <= tokenBudget) {
				summaries.push(node.content)
				tokensUsed += node.tokenCount

				// If we have budget, try to expand with children (more detailed)
				if (node.childIds.length > 0) {
					const childTokens = node.childIds.reduce((sum, id) => {
						const child = tree.nodes.get(id)
						return sum + (child?.tokenCount ?? 0)
					}, 0)

					// Only expand if children fit and are more useful
					if (tokensUsed - node.tokenCount + childTokens <= tokenBudget) {
						// Remove parent summary, add children
						summaries.pop()
						tokensUsed -= node.tokenCount
						queue.push(...node.childIds)
					}
				}
			}
		}

		return summaries
	}

	/**
	 * Get a specific level of summary
	 */
	getSummaryAtLevel(taskId: string, level: SummaryLevel): string | null {
		const tree = this.summaryTrees.get(taskId)
		if (!tree) return null

		// Find nodes at the requested level
		const levelNodes: SummaryNode[] = []
		for (const node of tree.nodes.values()) {
			if (node.level === level) {
				levelNodes.push(node)
			}
		}

		if (levelNodes.length === 0) return null

		// Sort by message range and concatenate
		levelNodes.sort((a, b) => a.messageRange.startIndex - b.messageRange.startIndex)
		return levelNodes.map((n) => n.content).join("\n\n---\n\n")
	}

	/**
	 * Expand a summary node to get more detail
	 */
	async expandNode(
		taskId: string,
		nodeId: string,
		messages: ApiMessage[],
		apiHandler: ApiHandler,
	): Promise<SummaryNode[]> {
		const tree = this.summaryTrees.get(taskId)
		if (!tree) return []

		const node = tree.nodes.get(nodeId)
		if (!node) return []

		// If already has children, return them
		if (node.childIds.length > 0) {
			return node.childIds.map((id) => tree.nodes.get(id)).filter((n): n is SummaryNode => n !== undefined)
		}

		// Create more detailed summaries for sub-ranges
		const range = node.messageRange
		const messageCount = range.endIndex - range.startIndex
		const segmentSize = Math.ceil(messageCount / 3)

		const childNodes: SummaryNode[] = []
		const nextLevel = this.getNextDetailedLevel(node.level)

		for (let i = 0; i < 3; i++) {
			const startIndex = range.startIndex + i * segmentSize
			const endIndex = Math.min(startIndex + segmentSize, range.endIndex)

			if (startIndex >= endIndex) break

			const segmentMessages = messages.slice(startIndex, endIndex)
			const childNode = await this.summarizeSegment(segmentMessages, nextLevel, apiHandler, node.id, {
				startIndex,
				endIndex,
			})

			childNodes.push(childNode)
			tree.nodes.set(childNode.id, childNode)
			node.childIds.push(childNode.id)
		}

		return childNodes
	}

	/**
	 * Get statistics about summaries
	 */
	getStats(taskId: string): {
		levels: number
		totalNodes: number
		totalTokens: number
		nodesByLevel: Record<SummaryLevel, number>
	} | null {
		const tree = this.summaryTrees.get(taskId)
		if (!tree) return null

		const nodesByLevel: Record<SummaryLevel, number> = {
			detailed: 0,
			standard: 0,
			brief: 0,
			minimal: 0,
		}

		for (const node of tree.nodes.values()) {
			nodesByLevel[node.level]++
		}

		return {
			levels: tree.levels.length,
			totalNodes: tree.nodes.size,
			totalTokens: tree.totalTokens,
			nodesByLevel,
		}
	}

	/**
	 * Clear summaries for a task
	 */
	clear(taskId: string): void {
		this.summaryTrees.delete(taskId)
	}

	/**
	 * Clear all summaries
	 */
	clearAll(): void {
		this.summaryTrees.clear()
	}

	// Private methods

	private async buildNewTree(taskId: string, messages: ApiMessage[], apiHandler: ApiHandler): Promise<SummaryTree> {
		const tree: SummaryTree = {
			rootId: "",
			nodes: new Map(),
			totalTokens: 0,
			levels: ["minimal", "brief", "standard", "detailed"],
		}

		// Create the root (most condensed) summary
		const rootNode = await this.summarizeSegment(messages, "minimal", apiHandler, undefined, {
			startIndex: 0,
			endIndex: messages.length,
		})

		tree.rootId = rootNode.id
		tree.nodes.set(rootNode.id, rootNode)
		tree.totalTokens = rootNode.tokenCount

		// Create intermediate levels
		await this.buildIntermediateLevels(tree, messages, apiHandler)

		this.summaryTrees.set(taskId, tree)
		return tree
	}

	private async buildIntermediateLevels(
		tree: SummaryTree,
		messages: ApiMessage[],
		apiHandler: ApiHandler,
	): Promise<void> {
		const levels: SummaryLevel[] = ["brief", "standard"]
		let currentParentIds = [tree.rootId]

		for (const level of levels) {
			const newParentIds: string[] = []

			for (const parentId of currentParentIds) {
				const parent = tree.nodes.get(parentId)
				if (!parent) continue

				const range = parent.messageRange
				const messageCount = range.endIndex - range.startIndex

				// Only split if enough messages
				if (messageCount < this.config.minMessagesForSummary * 2) {
					continue
				}

				const segmentSize = Math.ceil(messageCount / 2)

				for (let i = 0; i < 2; i++) {
					const startIndex = range.startIndex + i * segmentSize
					const endIndex = Math.min(startIndex + segmentSize, range.endIndex)

					if (startIndex >= endIndex) break

					const segmentMessages = messages.slice(startIndex, endIndex)
					const childNode = await this.summarizeSegment(segmentMessages, level, apiHandler, parentId, {
						startIndex,
						endIndex,
					})

					tree.nodes.set(childNode.id, childNode)
					parent.childIds.push(childNode.id)
					tree.totalTokens += childNode.tokenCount
					newParentIds.push(childNode.id)
				}
			}

			currentParentIds = newParentIds
		}
	}

	private async summarizeSegment(
		messages: ApiMessage[],
		level: SummaryLevel,
		apiHandler: ApiHandler,
		parentId: string | undefined,
		range: { startIndex: number; endIndex: number },
	): Promise<SummaryNode> {
		const prompt = this.config.customPrompts?.[level] ?? LEVEL_PROMPTS[level]
		const targetTokens = this.config.levelTokenTargets[level]

		// Format messages for summarization
		const formattedMessages = messages
			.map((msg, i) => {
				const role = msg.role === "assistant" ? "Assistant" : "User"
				const content = this.extractTextContent(msg)
				return `[${role}]: ${content}`
			})
			.join("\n\n")

		// Generate summary using API
		const summary = await this.generateSummary(formattedMessages, prompt, targetTokens, apiHandler)

		const id = `summary_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

		return {
			id,
			level,
			content: summary,
			tokenCount: await this.estimateTokens(summary, apiHandler),
			parentId,
			childIds: [],
			messageRange: range,
			createdAt: Date.now(),
		}
	}

	private async generateSummary(
		content: string,
		prompt: string,
		targetTokens: number,
		apiHandler: ApiHandler,
	): Promise<string> {
		const fullPrompt = `${prompt}

Target length: approximately ${targetTokens} tokens.

Conversation to summarize:
${content}`

		try {
			// Use the API handler to generate summary
			// This is a simplified version - actual implementation would use proper API call
			const response = await apiHandler.createMessage(
				"gpt-4o-mini", // Use a fast model for summarization
				[{ role: "user", content: fullPrompt }],
			)

			// Extract text from response
			if (typeof response === "object" && "text" in response) {
				return (response as any).text
			}

			// Handle streaming response
			let text = ""
			for await (const chunk of response as AsyncIterable<any>) {
				if (chunk.type === "text") {
					text += chunk.text
				}
			}
			return text || content.slice(0, targetTokens * 4)
		} catch {
			// Fallback: simple truncation
			return content.slice(0, targetTokens * 4)
		}
	}

	private extractTextContent(message: ApiMessage): string {
		if (typeof message.content === "string") {
			return message.content
		}

		if (Array.isArray(message.content)) {
			return message.content
				.filter((block: any) => block.type === "text")
				.map((block: any) => block.text)
				.join("\n")
		}

		return ""
	}

	private async estimateTokens(text: string, apiHandler: ApiHandler): Promise<number> {
		// Simple estimation: ~4 characters per token
		return Math.ceil(text.length / 4)
	}

	private canUpdateExisting(tree: SummaryTree, messages: ApiMessage[]): boolean {
		const rootNode = tree.nodes.get(tree.rootId)
		if (!rootNode) return false

		// Can update if only new messages were added
		return rootNode.messageRange.endIndex < messages.length
	}

	private async updateSummaryTree(
		tree: SummaryTree,
		messages: ApiMessage[],
		apiHandler: ApiHandler,
	): Promise<SummaryTree> {
		// For now, rebuild the tree
		// A more sophisticated implementation would only update affected nodes
		const taskId = Array.from(this.summaryTrees.entries()).find(([, t]) => t === tree)?.[0]

		if (taskId) {
			return this.buildNewTree(taskId, messages, apiHandler)
		}

		return tree
	}

	private getNextDetailedLevel(current: SummaryLevel): SummaryLevel {
		const order: SummaryLevel[] = ["minimal", "brief", "standard", "detailed"]
		const index = order.indexOf(current)
		return order[Math.min(index + 1, order.length - 1)]
	}
}

// Singleton instance
let summarizerInstance: HierarchicalSummarizer | null = null

export function getHierarchicalSummarizer(config?: Partial<HierarchicalSummarizerConfig>): HierarchicalSummarizer {
	if (!summarizerInstance) {
		summarizerInstance = new HierarchicalSummarizer(config)
	}
	return summarizerInstance
}

export function resetHierarchicalSummarizer(): void {
	summarizerInstance = null
}
