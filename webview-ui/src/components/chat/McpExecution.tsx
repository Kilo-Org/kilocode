import { useCallback, useEffect, useMemo, useState, memo } from "react"
import { Server, ChevronDown, ChevronRight } from "lucide-react"
import { useEvent } from "react-use"
import { useTranslation } from "react-i18next"

import {
	type ExtensionMessage,
	type ClineAskUseMcpServer,
	type McpExecutionStatus,
	mcpExecutionStatusSchema,
} from "@roo-code/types"

import { safeJsonParse } from "@roo/core"

import { cn } from "@src/lib/utils"
import { Button } from "@src/components/ui"
import CodeBlock from "../kilocode/common/CodeBlock" // kilocode_change
import McpToolRow from "../mcp/McpToolRow"

import { Markdown } from "./Markdown"

interface McpExecutionProps {
	executionId: string
	text?: string
	serverName?: string
	toolName?: string
	isArguments?: boolean
	server?: {
		tools?: Array<{
			name: string
			description?: string
			alwaysAllow?: boolean
		}>
		source?: "global" | "project"
	}
	useMcpServer?: ClineAskUseMcpServer
	alwaysAllowMcp?: boolean
	initiallyExpanded?: boolean // kilocode_change: For Storybook stories only
}

function removeRenamedPrefix_kilocode(text: string): string {
	// Remove "renamed_" prefix from property names in JSON (native tool calling)
	const prefix = "renamed_"
	if (!text || !text.startsWith(prefix)) return text
	return text.substring(prefix.length)
}

export const McpExecution = ({
	executionId,
	text,
	serverName: initialServerName,
	toolName: initialToolName,
	isArguments = false,
	server,
	useMcpServer,
	alwaysAllowMcp = false,
	initiallyExpanded = false, // kilocode_change
}: McpExecutionProps) => {
	const { t } = useTranslation("mcp")

	// State for tracking MCP response status
	const [status, setStatus] = useState<McpExecutionStatus | null>(null)
	const [responseText, setResponseText] = useState(text || "")
	const [argumentsText, setArgumentsText] = useState(text || "")
	const [serverName, setServerName] = useState(initialServerName)
	const [toolName, setToolName] = useState(initialToolName)

	// kilocode_change: Main collapse state for the entire MCP execution content
	const [isResponseExpanded, setIsResponseExpanded] = useState(initiallyExpanded)

	// Try to parse JSON and return both the result and formatted text
	const tryParseJson = useCallback((text: string): { isJson: boolean; formatted: string } => {
		if (!text) return { isJson: false, formatted: "" }

		try {
			const parsed = JSON.parse(text)
			return {
				isJson: true,
				formatted: JSON.stringify(parsed, null, 2),
			}
		} catch {
			return {
				isJson: false,
				formatted: text,
			}
		}
	}, [])

	// kilocode_change: Only parse response data when main content is expanded AND complete to avoid parsing partial JSON
	const responseData = useMemo(() => {
		if (!isResponseExpanded) {
			return { isJson: false, formatted: responseText }
		}
		// Only try to parse JSON if the response is complete
		if (status && status.status === "completed") {
			return tryParseJson(responseText)
		}
		// For partial responses, just return as-is without parsing
		return { isJson: false, formatted: responseText }
	}, [responseText, isResponseExpanded, tryParseJson, status])

	// Only parse arguments data when complete to avoid parsing partial JSON
	const argumentsData = useMemo(() => {
		if (!argumentsText) {
			return { isJson: false, formatted: "" }
		}

		// For arguments, we don't have a streaming status, so we check if it looks like complete JSON
		const trimmed = argumentsText.trim()

		// Basic check for complete JSON structure
		if (
			trimmed &&
			((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]")))
		) {
			// Try to parse, but if it fails, return as-is
			try {
				const parsed = JSON.parse(trimmed)
				return {
					isJson: true,
					formatted: JSON.stringify(parsed, null, 2),
				}
			} catch {
				// JSON structure looks complete but is invalid, return as-is
				return { isJson: false, formatted: argumentsText }
			}
		}

		// For non-JSON or incomplete data, just return as-is
		return { isJson: false, formatted: argumentsText }
	}, [argumentsText])

	const formattedResponseText = responseData.formatted
	const formattedArgumentsText = argumentsData.formatted
	const responseIsJson = responseData.isJson

	const onToggleResponseExpand = useCallback(() => {
		setIsResponseExpanded(!isResponseExpanded)
	}, [isResponseExpanded])

	// Listen for MCP execution status messages
	const onMessage = useCallback(
		(event: MessageEvent) => {
			const message: ExtensionMessage = event.data

			if (message.type === "mcpExecutionStatus") {
				try {
					const result = mcpExecutionStatusSchema.safeParse(safeJsonParse(message.text || "{}", {}))

					if (result.success) {
						const data = result.data

						// Only update if this message is for our response
						if (data.executionId === executionId) {
							setStatus(data)

							if (data.status === "output" && data.response) {
								setResponseText((prev) => prev + data.response)
							} else if (data.status === "completed" && data.response) {
								setResponseText(data.response)
							}
						}
					}
				} catch (e) {
					console.error("Failed to parse MCP execution status", e)
				}
			}
		},
		[executionId],
	)

	useEvent("message", onMessage)

	// Initialize with text if provided and parse command/response sections
	useEffect(() => {
		// Handle arguments text - don't parse JSON here as it might be incomplete
		if (text) {
			setArgumentsText(text)
		}

		// Handle response text
		if (useMcpServer?.response) {
			setResponseText(useMcpServer.response)
		}

		if (initialServerName && initialServerName !== serverName) {
			setServerName(initialServerName)
		}

		if (initialToolName && initialToolName !== toolName) {
			setToolName(initialToolName)
		}
	}, [text, useMcpServer, initialServerName, initialToolName, serverName, toolName, isArguments])

	return (
		<>
			<div
				className="flex flex-row items-center justify-between gap-2 mb-1 cursor-pointer select-none"
				onClick={onToggleResponseExpand /* kilocode_change */}>
				<div className="flex flex-row items-center gap-1 flex-wrap">
					<Server size={16} className="text-vscode-descriptionForeground" />
					<div className="flex items-center gap-1 flex-wrap">
						{/* kilocode_change: Show tool name instead of server name since server is already shown above */}
						{toolName && <span className="font-bold text-vscode-foreground">{toolName}</span>}
					</div>
				</div>
				<div className="flex flex-row items-center justify-between gap-2 px-1">
					<div className="flex flex-row items-center gap-1">
						{status && (
							<div className="flex flex-row items-center gap-2 font-mono text-xs">
								<div
									className={cn("rounded-full size-1.5", {
										"bg-lime-400": status.status === "started" || status.status === "completed",
										"bg-red-400": status.status === "error",
									})}
								/>
								<div
									className={cn("whitespace-nowrap", {
										"text-vscode-foreground":
											status.status === "started" || status.status === "completed",
										"text-vscode-errorForeground": status.status === "error",
									})}>
									{status.status === "started"
										? t("execution.running")
										: status.status === "completed"
											? t("execution.completed")
											: t("execution.error")}
								</div>
								{status.status === "error" && "error" in status && status.error && (
									<div className="whitespace-nowrap">({status.error})</div>
								)}
							</div>
						)}
					</div>
					{/* kilocode_change start - moved Chevron button */}
					<Button
						variant="ghost"
						size="icon"
						onClick={(e) => {
							e.stopPropagation()
							onToggleResponseExpand()
						}}>
						{!isResponseExpanded ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
					</Button>
					{/* kilocode_change end - moved Chevron button */}
				</div>
			</div>

			<div className={cn("w-full bg-vscode-editor-background rounded-xs p-2", !isResponseExpanded && "hidden")}>
				{/* Tool information section */}
				{useMcpServer?.type === "use_mcp_tool" && (
					<div onClick={(e) => e.stopPropagation()}>
						<McpToolRow
							tool={{
								name: useMcpServer.toolName || "",
								description:
									server?.tools?.find((tool) => tool.name === useMcpServer.toolName)?.description ||
									"",
								alwaysAllow:
									server?.tools?.find((tool) => tool.name === useMcpServer.toolName)?.alwaysAllow ||
									false,
							}}
							serverName={useMcpServer.serverName}
							serverSource={server?.source}
							alwaysAllowMcp={alwaysAllowMcp}
							isInChatContext={true}
						/>
					</div>
				)}
				{!useMcpServer && toolName && serverName && (
					<div onClick={(e) => e.stopPropagation()}>
						<McpToolRow
							tool={{
								name: toolName || "",
								description: "",
								alwaysAllow: false,
							}}
							serverName={serverName}
							serverSource={undefined}
							alwaysAllowMcp={alwaysAllowMcp}
							isInChatContext={true}
						/>
					</div>
				)}

				{/* Arguments section - display like command (always visible) */}
				{(isArguments || useMcpServer?.arguments || argumentsText) && (
					<div
						className={cn({
							"mt-1 pt-1":
								!isArguments && (useMcpServer?.type === "use_mcp_tool" || (toolName && serverName)),
						})}>
						<CodeBlock source={removeRenamedPrefix_kilocode(formattedArgumentsText)} language="json" />
					</div>
				)}

				{/* Response section - use main collapse state for memory management */}
				<ResponseContainer
					isExpanded={isResponseExpanded}
					response={formattedResponseText}
					isJson={responseIsJson}
					hasArguments={!!(isArguments || useMcpServer?.arguments || argumentsText)}
					isPartial={status ? status.status !== "completed" : false}
				/>
			</div>
		</>
	)
}

McpExecution.displayName = "McpExecution"

const ResponseContainerInternal = ({
	isExpanded,
	response,
	isJson,
	hasArguments,
	isPartial = false,
}: {
	isExpanded: boolean
	response: string
	isJson: boolean
	hasArguments?: boolean
	isPartial?: boolean
}) => {
	// Only render content when expanded to prevent performance issues with large responses
	if (!isExpanded || response.length === 0) {
		return (
			<div
				className={cn("overflow-hidden", {
					"max-h-0": !isExpanded,
				})}
			/>
		)
	}

	return (
		<div
			className={cn("overflow-hidden", {
				"max-h-96 overflow-y-auto mt-1 pt-1 border-t border-border/25": hasArguments,
				"max-h-96 overflow-y-auto mt-1 pt-1": !hasArguments,
			})}>
			{isJson ? (
				<CodeBlock source={response} language="json" />
			) : (
				<Markdown markdown={response} partial={isPartial} />
			)}
		</div>
	)
}

const ResponseContainer = memo(ResponseContainerInternal)
