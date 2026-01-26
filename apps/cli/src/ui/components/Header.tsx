import { memo } from "react"
import { Text, Box } from "ink"

import type { TokenUsage } from "@roo-code/types"

import { ASCII_ROO } from "@/types/constants.js"
import { User } from "@/lib/sdk/types.js"

import { useTerminalSize } from "../hooks/TerminalSizeContext.js"
import * as theme from "../theme.js"

import MetricsDisplay from "./MetricsDisplay.js"

interface HeaderProps {
	cwd: string
	user: User | null
	provider: string
	model: string
	mode: string
	reasoningEffort?: string
	version: string
	tokenUsage?: TokenUsage | null
	contextWindow?: number
}

function Header({
	cwd,
	user,
	provider,
	model,
	mode,
	reasoningEffort,
	version,
	tokenUsage,
	contextWindow,
}: HeaderProps) {
	const { columns } = useTerminalSize()

	const homeDir = process.env.HOME || process.env.USERPROFILE || ""
	const title = `Roo Code CLI v${version}`
	const remainingDashes = Math.max(0, columns - `── ${title} `.length)

	return (
		<Box flexDirection="column" width={columns}>
			<Text color={theme.borderColor}>
				── <Text color={theme.titleColor}>{title}</Text> {"─".repeat(remainingDashes)}
			</Text>
			<Box width={columns}>
				<Box flexDirection="row">
					<Box marginY={1}>
						<Text color="magenta">{ASCII_ROO}</Text>
					</Box>
					<Box flexDirection="column" marginLeft={1} marginTop={1}>
						{user && <Text color={theme.dimText}>Welcome back, {user.name}</Text>}
						<Text color={theme.dimText}>
							cwd: {cwd.startsWith(homeDir) ? cwd.replace(homeDir, "~") : cwd}
						</Text>
						<Text color={theme.dimText}>
							{provider}: {model} [{reasoningEffort}]
						</Text>
						<Text color={theme.dimText}>mode: {mode}</Text>
					</Box>
				</Box>
			</Box>
			{tokenUsage && contextWindow && contextWindow > 0 && (
				<Box alignSelf="flex-end" marginTop={-1}>
					<MetricsDisplay tokenUsage={tokenUsage} contextWindow={contextWindow} />
				</Box>
			)}
			<Text color={theme.borderColor}>{"─".repeat(columns)}</Text>
		</Box>
	)
}

export default memo(Header)
