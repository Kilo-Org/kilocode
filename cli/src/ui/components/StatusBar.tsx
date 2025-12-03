/**
 * StatusBar component - displays project info, git branch, mode, model, and context usage
 */

import React, { useEffect, useMemo, useState } from "react"
import { Box, Text } from "ink"
import { useAtomValue } from "jotai"
import os from "os"
import {
	cwdAtom,
	isParallelModeAtom,
	extensionModeAtom,
	apiConfigurationAtom,
	chatMessagesAtom,
	routerModelsAtom,
} from "../../state/atoms/index.js"
import { useGitInfo } from "../../state/hooks/useGitInfo.js"
import { useContextUsage } from "../../state/hooks/useContextUsage.js"
import { useTheme } from "../../state/hooks/useTheme.js"
import { formatContextUsage } from "../../utils/context.js"
import {
	getCurrentModelId,
	getModelsByProvider,
	prettyModelName,
	type RouterModels,
} from "../../constants/providers/models.js"
import type { ProviderSettings } from "../../types/messages.js"
import type { ProviderConfig } from "../../config/types.js"
import path from "path"
import { isGitWorktree } from "../../utils/git.js"

const MAX_MODEL_NAME_LENGTH = 40

/**
 * Format bytes to human readable format
 */
function formatBytes(bytes: number): string {
	const units = ["B", "KB", "MB", "GB", "TB"]
	let value = bytes
	let unitIndex = 0

	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024
		unitIndex++
	}

	return `${value.toFixed(1)}${units[unitIndex]}`
}

/**
 * Format CPU usage percentage
 */
function formatCpuUsage(cpuPercent: number): string {
	return `${cpuPercent.toFixed(1)}%`
}

/**
 * Format memory usage
 */
function formatMemoryUsage(used: number, total: number): string {
	const percent = (used / total) * 100
	return `${formatBytes(used)}/${formatBytes(total)} (${percent.toFixed(1)}%)`
}

/**
 * Format token count
 */
function formatTokenCount(tokens: number): string {
	if (tokens >= 1000000) {
		return `${(tokens / 1000000).toFixed(1)}M`
	} else if (tokens >= 1000) {
		return `${(tokens / 1000).toFixed(1)}K`
	}
	return tokens.toString()
}

/**
 * Get the display name for the current model
 */
function getModelDisplayName(apiConfig: ProviderSettings | null, routerModels: RouterModels | null): string {
	if (!apiConfig || !apiConfig.apiProvider) return "N/A"

	try {
		// Get current model ID
		const currentModelId = getCurrentModelId({
			providerConfig: {
				id: "default",
				provider: apiConfig.apiProvider || "",
				...apiConfig,
			} as ProviderConfig,
			routerModels,
			kilocodeDefaultModel: apiConfig.kilocodeModel || "",
		})

		// Get models for the provider
		const { models } = getModelsByProvider({
			provider: apiConfig.apiProvider,
			routerModels,
			kilocodeDefaultModel: apiConfig.kilocodeModel || "",
		})

		// Get model info
		const modelInfo = models[currentModelId]

		// Use displayName if available, otherwise use pretty name
		const displayName = modelInfo?.displayName || prettyModelName(currentModelId)

		// Limit length for display
		return displayName.length > MAX_MODEL_NAME_LENGTH
			? displayName.substring(0, MAX_MODEL_NAME_LENGTH - 3) + "..."
			: displayName
	} catch {
		// Fallback to simple model ID extraction
		const modelId =
			apiConfig.apiModelId ||
			apiConfig.openAiModelId ||
			apiConfig.ollamaModelId ||
			apiConfig.kilocodeModel ||
			"Unknown"

		return modelId.length > MAX_MODEL_NAME_LENGTH
			? modelId.substring(0, MAX_MODEL_NAME_LENGTH - 3) + "..."
			: modelId
	}
}

/**
 * Get project name from workspace path
 */
function getProjectName(cwd: string | null): string {
	if (!cwd) return "N/A"
	return path.basename(cwd)
}

/**
 * StatusBar component that displays current project status
 */
export const StatusBar: React.FC = () => {
	// Get theme
	const theme = useTheme()

	// Get data from atoms
	const cwd = useAtomValue(cwdAtom)
	const isParallelMode = useAtomValue(isParallelModeAtom)
	const mode = useAtomValue(extensionModeAtom)
	const apiConfig = useAtomValue(apiConfigurationAtom)
	const messages = useAtomValue(chatMessagesAtom)
	const routerModels = useAtomValue(routerModelsAtom)

	// Get git info
	const gitInfo = useGitInfo(cwd)

	// Calculate context usage
	const contextUsage = useContextUsage(messages, apiConfig)

	const [isWorktree, setIsWorktree] = useState(false)

	// System metrics state
	const [cpuUsage, setCpuUsage] = useState<number>(0)
	const [memoryUsage, setMemoryUsage] = useState<{ used: number; total: number }>({ used: 0, total: 0 })

	useEffect(() => {
		let latest = true

		const checkWorktree = async () => {
			if (!cwd) {
				return
			}

			let result = false

			try {
				result = await isGitWorktree(cwd)
			} catch {
				/* empty */
			} finally {
				if (latest) {
					setIsWorktree(result)
				}
			}
		}

		checkWorktree()

		return () => {
			latest = false
		}
	}, [cwd])

	// Update system metrics periodically
	useEffect(() => {
		let latest = true
		let previousCpus: os.CpuInfo[] | null = null
		let previousTime: number | null = null

		const updateSystemMetrics = () => {
			try {
				const currentTime = Date.now()
				const currentCpus = os.cpus()

				// CPU usage calculation
				if (previousCpus && previousTime) {
					let totalIdle = 0
					let totalTick = 0

					for (let i = 0; i < currentCpus.length; i++) {
						const currentCpu = currentCpus[i]
						const previousCpu = previousCpus[i]

						if (currentCpu && previousCpu) {
							const currentTimes = currentCpu.times
							const previousTimes = previousCpu.times

							const idle = currentTimes.idle - previousTimes.idle
							const tick =
								currentTimes.user +
								currentTimes.nice +
								currentTimes.sys +
								currentTimes.irq -
								(previousTimes.user + previousTimes.nice + previousTimes.sys + previousTimes.irq)

							totalIdle += idle
							totalTick += tick
						}
					}

					if (totalTick > 0) {
						const cpuPercent = (totalTick / (totalTick + totalIdle)) * 100
						if (latest) setCpuUsage(Math.min(100, Math.max(0, cpuPercent)))
					}
				}

				previousCpus = currentCpus
				previousTime = currentTime

				// Memory usage
				const totalMem = os.totalmem()
				const freeMem = os.freemem()
				const usedMem = totalMem - freeMem
				if (latest) {
					setMemoryUsage({ used: usedMem, total: totalMem })
				}
			} catch (error) {
				// Silently handle errors to avoid disrupting the UI
				console.warn("Failed to update system metrics:", error)
			}
		}

		// Initial update
		updateSystemMetrics()

		// Update every 2 seconds
		const interval = setInterval(updateSystemMetrics, 2000)

		return () => {
			latest = false
			clearInterval(interval)
		}
	}, [])

	// Prepare display values
	// In parallel mode, show the original directory (process.cwd()) instead of the worktree path
	const displayCwd = isParallelMode ? process.cwd() : cwd
	const projectName = `${getProjectName(displayCwd)}${isWorktree ? " (git worktree)" : ""}`
	const modelName = useMemo(() => getModelDisplayName(apiConfig, routerModels), [apiConfig, routerModels])

	// Get context color based on percentage using theme colors
	const contextColor = useMemo(() => {
		if (contextUsage.percentage >= 86) {
			return theme.semantic.error
		}
		if (contextUsage.percentage >= 61) {
			return theme.semantic.warning
		}
		return theme.semantic.success
	}, [contextUsage.percentage, theme])

	const contextText = formatContextUsage(contextUsage)

	// Git status color (success if clean, warning if dirty)
	const gitStatusColor = gitInfo.isClean ? theme.semantic.success : theme.semantic.warning

	return (
		<Box borderStyle="round" borderColor={theme.ui.border.default} paddingX={1} justifyContent="space-between">
			{/* Left side: Project and Git Branch */}
			<Box>
				{/* Project Name */}
				<Text color={theme.semantic.info} bold>
					{projectName}
				</Text>

				{/* Git Branch */}
				{gitInfo.isRepo && gitInfo.branch ? (
					<>
						<Text color={theme.ui.text.dimmed} dimColor>
							{" / "}
						</Text>
						<Text color={gitStatusColor}>{gitInfo.branch}</Text>
					</>
				) : null}
			</Box>

			{/* Right side: Mode, Model, Context, System Metrics */}
			<Box>
				{/* Mode */}
				<Text color={theme.ui.text.highlight} bold>
					{mode ? mode.charAt(0).toUpperCase() + mode.slice(1) : "N/A"}
				</Text>

				<Text color={theme.ui.text.dimmed} dimColor>
					{" | "}
				</Text>

				{/* Model */}
				<Text color={theme.messages.user}>{modelName}</Text>

				<Text color={theme.ui.text.dimmed} dimColor>
					{" | "}
				</Text>

				{/* Context Usage */}
				<Text color={contextColor} bold>
					{contextText}
				</Text>

				<Text color={theme.ui.text.dimmed} dimColor>
					{" | "}
				</Text>

				{/* CPU Usage */}
				<Text
					color={
						cpuUsage > 80
							? theme.semantic.error
							: cpuUsage > 60
								? theme.semantic.warning
								: theme.semantic.success
					}>
					CPU: {formatCpuUsage(cpuUsage)}
				</Text>

				<Text color={theme.ui.text.dimmed} dimColor>
					{" | "}
				</Text>

				{/* Memory Usage */}
				<Text
					color={
						memoryUsage.used / memoryUsage.total > 0.8
							? theme.semantic.error
							: memoryUsage.used / memoryUsage.total > 0.6
								? theme.semantic.warning
								: theme.semantic.success
					}>
					RAM: {formatMemoryUsage(memoryUsage.used, memoryUsage.total)}
				</Text>

				{/* Token Count - only show if there are tokens */}
				{contextUsage.tokensUsed > 0 && (
					<>
						<Text color={theme.ui.text.dimmed} dimColor>
							{" | "}
						</Text>
						<Text color={theme.semantic.info}>{formatTokenCount(contextUsage.tokensUsed)} tokens</Text>
					</>
				)}
			</Box>
		</Box>
	)
}
