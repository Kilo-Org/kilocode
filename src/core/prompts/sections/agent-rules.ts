import fs from "fs/promises"
import os from "os"
import path from "path"
import { findUpDirectoryChain } from "../../fs/find-up"

const AGENT_RULE_FILENAME = "AGENTS.md"
const MAX_AGENT_RULE_FILES = 6
const MAX_AGENT_RULE_CHARS = 10000
const AGENT_RULES_PRELOADED_NOTICE =
	"(The following rules are loaded automatically from AGENTS.md files and are already available in this context. Do not use read_file for AGENTS.md unless troubleshooting.)\n"

type AgentRuleContent = {
	filename: string
	content: string
	orderIndex: number
}

type AgentRuleFile = {
	filename: string
	resolvedPath: string
	content: string
	orderIndex: number
}

type AgentRulesOptions = {
	cwd: string
	activePath?: string
	readFile: (filePath: string) => Promise<string>
}

function normalizePathForCompare(value: string): string {
	return path.resolve(value)
}

function isPathWithin(parent: string, child: string): boolean {
	if (!parent || !child) {
		return false
	}
	const relativePath = path.relative(parent, child)
	return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
}

function getAgentRulesSearchStart(cwd: string, activePath?: string): string {
	if (!activePath) {
		return cwd
	}
	const activeDir = path.dirname(activePath)
	return isPathWithin(cwd, activeDir) ? activeDir : cwd
}

function toPosixPath(value: string): string {
	return value.replace(/\\/g, "/")
}

async function resolveAgentRuleFilePath(agentPath: string): Promise<string | null> {
	const lstat = typeof fs.lstat === "function" ? fs.lstat : undefined
	if (!lstat) {
		return agentPath
	}

	try {
		const stats = await lstat(agentPath)
		if (!stats?.isSymbolicLink || !stats.isSymbolicLink()) {
			return agentPath
		}
	} catch (error) {
		return null
	}

	const readlink = typeof fs.readlink === "function" ? fs.readlink : undefined
	const stat = typeof fs.stat === "function" ? fs.stat : undefined
	if (!readlink || !stat) {
		return agentPath
	}

	try {
		const linkTarget = await readlink(agentPath)
		const resolvedTarget = path.resolve(path.dirname(agentPath), linkTarget)
		const resolvedStats = await stat(resolvedTarget)
		if (!resolvedStats?.isFile || !resolvedStats.isFile()) {
			return null
		}
		return resolvedTarget
	} catch (error) {
		return agentPath
	}
}

async function readAgentRulesFile(
	filePath: string,
	readFile: (filePath: string) => Promise<string>,
): Promise<{ resolvedPath: string; content: string } | null> {
	const resolvedPath = await resolveAgentRuleFilePath(filePath)
	if (!resolvedPath) {
		return null
	}
	const content = await readFile(resolvedPath)
	if (!content) {
		return null
	}
	return { resolvedPath, content }
}

function truncateAgentRulesContent(content: string, maxLength: number): string {
	if (content.length <= maxLength) {
		return content
	}
	const truncationNote = "\n[truncated]"
	if (maxLength <= truncationNote.length) {
		return content.slice(0, maxLength)
	}
	return content.slice(0, maxLength - truncationNote.length) + truncationNote
}

function buildAgentRulesOutput(ruleContents: AgentRuleContent[]): string {
	if (ruleContents.length === 0) {
		return ""
	}

	const prioritizedRules = [...ruleContents].sort((a, b) => b.orderIndex - a.orderIndex)
	const selectedRules: Array<{ header: string; content: string; orderIndex: number }> = []
	let remainingChars = MAX_AGENT_RULE_CHARS - (AGENT_RULES_PRELOADED_NOTICE.length + 1)
	if (remainingChars <= 0) {
		return ""
	}

	for (const rule of prioritizedRules) {
		const header = `# Agent Rules Standard (${rule.filename}):\n`
		if (remainingChars <= header.length) {
			continue
		}
		const maxContentLength = remainingChars - header.length
		const truncatedContent = truncateAgentRulesContent(rule.content, maxContentLength)
		selectedRules.push({
			header,
			content: truncatedContent,
			orderIndex: rule.orderIndex,
		})
		remainingChars -= header.length + truncatedContent.length
		if (remainingChars <= 0) {
			break
		}
	}

	const body = selectedRules
		.sort((a, b) => a.orderIndex - b.orderIndex)
		.map((rule) => `${rule.header}${rule.content}`)
		.join("\n\n")

	return body ? `${AGENT_RULES_PRELOADED_NOTICE}\n${body}` : ""
}

export async function loadAgentRulesContent(options: AgentRulesOptions): Promise<string> {
	const normalizedCwd = normalizePathForCompare(options.cwd)
	const searchStart = normalizePathForCompare(getAgentRulesSearchStart(normalizedCwd, options.activePath))
	const startDir = isPathWithin(normalizedCwd, searchStart) ? searchStart : normalizedCwd

	const directories = findUpDirectoryChain(startDir, normalizedCwd).reverse()
	const seenPaths = new Set<string>()
	const localRules: AgentRuleFile[] = []

	for (const dirPath of directories) {
		const agentPath = path.join(dirPath, AGENT_RULE_FILENAME)
		const rule = await readAgentRulesFile(agentPath, options.readFile)
		if (!rule || seenPaths.has(rule.resolvedPath)) {
			continue
		}
		seenPaths.add(rule.resolvedPath)
		const label = toPosixPath(path.relative(normalizedCwd, agentPath) || AGENT_RULE_FILENAME)
		localRules.push({
			filename: label,
			resolvedPath: rule.resolvedPath,
			content: rule.content,
			orderIndex: localRules.length,
		})
	}

	const globalAgentsPath = path.join(os.homedir(), ".kilocode", AGENT_RULE_FILENAME)
	const globalRule = await readAgentRulesFile(globalAgentsPath, options.readFile)

	const ruleContents: AgentRuleContent[] = []
	let globalCount = 0
	if (globalRule && !seenPaths.has(globalRule.resolvedPath)) {
		ruleContents.push({
			filename: "~/.kilocode/AGENTS.md",
			content: globalRule.content,
			orderIndex: -1,
		})
		globalCount = 1
	}

	const maxLocalFiles = Math.max(0, MAX_AGENT_RULE_FILES - globalCount)
	const localRulesLimited = maxLocalFiles > 0 ? localRules.slice(-maxLocalFiles) : []

	for (const rule of localRulesLimited) {
		ruleContents.push({ filename: rule.filename, content: rule.content, orderIndex: rule.orderIndex })
	}

	return buildAgentRulesOutput(ruleContents)
}
