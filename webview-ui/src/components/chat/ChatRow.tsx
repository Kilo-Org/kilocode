import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { appendImages } from "@src/utils/imageUtils"
import { McpExecution } from "./McpExecution"
import { useSize } from "react-use"
import { useTranslation, Trans } from "react-i18next"
import deepEqual from "fast-deep-equal"
import { VSCodeBadge, VSCodeButton } from "@vscode/webview-ui-toolkit/react"

import type { ClineMessage } from "@roo-code/types"
// import { Mode } from "@roo/modes" // kilocode_change

import { ClineApiReqInfo, ClineAskUseMcpServer, ClineSayTool } from "@roo/ExtensionMessage"
import { COMMAND_OUTPUT_STRING } from "@roo/combineCommandSequences"
import { safeJsonParse } from "@roo/safeJsonParse"
import { FollowUpData, SuggestionItem } from "@roo-code/types"

import { useCopyToClipboard } from "@src/utils/clipboard"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { findMatchingResourceOrTemplate } from "@src/utils/mcp"
import { vscode } from "@src/utils/vscode"
import { removeLeadingNonAlphanumeric } from "@src/utils/removeLeadingNonAlphanumeric"
import { getLanguageFromPath } from "@src/utils/getLanguageFromPath"
// import { Button } from "@src/components/ui" // kilocode_change

// import ChatTextArea from "./ChatTextArea" // kilocode_change
import { MAX_IMAGES_PER_MESSAGE } from "./ChatView"

import { ToolUseBlock, ToolUseBlockHeader } from "../common/ToolUseBlock"
import UpdateTodoListToolBlock from "./UpdateTodoListToolBlock"
import CodeAccordian from "../common/CodeAccordian"
import CodeBlock from "../common/CodeBlock"
import MarkdownBlock from "../common/MarkdownBlock"
import { ReasoningBlock } from "./ReasoningBlock"
// import Thumbnails from "../common/Thumbnails" // kilocode_change
import McpResourceRow from "../mcp/McpResourceRow"

// import { Mention } from "./Mention" // kilocode_change
import { CheckpointSaved } from "./checkpoints/CheckpointSaved"
import { FollowUpSuggest } from "./FollowUpSuggest"
import { LowCreditWarning } from "../kilocode/chat/LowCreditWarning" // kilocode_change
import { BatchFilePermission } from "./BatchFilePermission"
import { BatchDiffApproval } from "./BatchDiffApproval"
import { ProgressIndicator } from "./ProgressIndicator"
import { Markdown } from "./Markdown"
import { CommandExecution } from "./CommandExecution"
import { CommandExecutionError } from "./CommandExecutionError"
import ReportBugPreview from "./ReportBugPreview"

import { NewTaskPreview } from "../kilocode/chat/NewTaskPreview" // kilocode_change
import { KiloChatRowGutterBar } from "../kilocode/chat/KiloChatRowGutterBar" // kilocode_change
import { AutoApprovedRequestLimitWarning } from "./AutoApprovedRequestLimitWarning"
import { CondenseContextErrorRow, CondensingContextRow, ContextCondenseRow } from "./ContextCondenseRow"
import CodebaseSearchResultsDisplay from "./CodebaseSearchResultsDisplay"
import { cn } from "@/lib/utils"
import { KiloChatRowUserFeedback } from "../kilocode/chat/KiloChatRowUserFeedback" // kilocode_change
import { StandardTooltip } from "../ui" // kilocode_change
import { ApiRequestModal } from "./ApiRequestModal" // kilocode_change
import "./ChatRow.css"

interface ChatRowProps {
	message: ClineMessage
	lastModifiedMessage?: ClineMessage
	isExpanded: boolean
	isLast: boolean
	isStreaming: boolean
	onToggleExpand: (ts: number) => void
	onHeightChange: (isTaller: boolean) => void
	onSuggestionClick?: (suggestion: SuggestionItem, event?: React.MouseEvent) => void
	onBatchFileResponse?: (response: { [key: string]: boolean }) => void
	highlighted?: boolean // kilocode_change: Add highlighted prop
	onChatReset?: () => void // kilocode_change
	onFollowUpUnmount?: () => void
	isFollowUpAnswered?: boolean
	editable?: boolean
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ChatRowContentProps extends Omit<ChatRowProps, "onHeightChange"> {}

const ChatRow = memo(
	(props: ChatRowProps) => {
		const { highlighted } = props // kilocode_change: Add highlighted prop
		const { showTaskTimeline } = useExtensionState() // kilocode_change: Used by KiloChatRowGutterBar
		const { isLast, onHeightChange, message } = props
		// Store the previous height to compare with the current height
		// This allows us to detect changes without causing re-renders
		const prevHeightRef = useRef(0)

		const [chatrow, { height }] = useSize(
			<div
				// kilocode_change: add highlighted className
				className={cn("chat-row-base", highlighted ? "animate-message-highlight" : "")}>
				{showTaskTimeline && <KiloChatRowGutterBar message={message} />}
				<ChatRowContent {...props} />
			</div>,
		)

		useEffect(() => {
			// used for partials, command output, etc.
			// NOTE: it's important we don't distinguish between partial or complete here since our scroll effects in chatview need to handle height change during partial -> complete
			const isInitialRender = prevHeightRef.current === 0 // prevents scrolling when new element is added since we already scroll for that
			// height starts off at Infinity
			if (isLast && height !== 0 && height !== Infinity && height !== prevHeightRef.current) {
				if (!isInitialRender) {
					onHeightChange(height > prevHeightRef.current)
				}
				prevHeightRef.current = height
			}
		}, [height, isLast, onHeightChange, message])

		// we cannot return null as virtuoso does not support it, so we use a separate visibleMessages array to filter out messages that should not be rendered
		return chatrow
	},
	// memo does shallow comparison of props, so we need to do deep comparison of arrays/objects whose properties might change
	deepEqual,
)

export default ChatRow

export const ChatRowContent = ({
	message,
	lastModifiedMessage,
	isExpanded,
	isLast,
	isStreaming,
	onToggleExpand,
	onSuggestionClick,
	onFollowUpUnmount,
	onBatchFileResponse,
	onChatReset, // kilocode_change
	isFollowUpAnswered,
	editable,
}: ChatRowContentProps) => {
	const { t } = useTranslation()
	const { mcpServers, alwaysAllowMcp, currentCheckpoint } = useExtensionState()
	const { copyWithFeedback } = useCopyToClipboard()
	const [reasoningCollapsed, setReasoningCollapsed] = useState(true)
	const [isDiffErrorExpanded, setIsDiffErrorExpanded] = useState(false)
	const [showDetailedError, setShowDetailedError] = useState(false) // kilocode_change: 添加详细错误信息显示状态
	const [showApiRequestModal, setShowApiRequestModal] = useState(false) // kilocode_change: 添加API请求模态窗口状态
	const [showCopySuccess, setShowCopySuccess] = useState(false)
	const [isEditing, _setIsEditing] = useState(false) // kilocode_change
	// const [editedContent, setEditedContent] = useState("") // kilocode_change
	// const [editMode, setEditMode] = useState<Mode>(mode || "code") // kilocode_change
	const [_editImages, setEditImages] = useState<string[]>([]) // kilocode_change

	// Handle message events for image selection during edit mode
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const msg = event.data
			if (msg.type === "selectedImages" && msg.context === "edit" && msg.messageTs === message.ts && isEditing) {
				setEditImages((prevImages) => appendImages(prevImages, msg.images, MAX_IMAGES_PER_MESSAGE))
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [isEditing, message.ts])

	// Memoized callback to prevent re-renders caused by inline arrow functions
	const handleToggleExpand = useCallback(() => {
		onToggleExpand(message.ts)
	}, [onToggleExpand, message.ts])

	/* kilocode_change
	// Handle edit button click
	const handleEditClick = useCallback(() => {
		setIsEditing(true)
		setEditedContent(message.text || "")
		setEditImages(message.images || [])
		setEditMode(mode || "code")
		// Edit mode is now handled entirely in the frontend
		// No need to notify the backend
	}, [message.text, message.images, mode])

	// Handle cancel edit
	const handleCancelEdit = useCallback(() => {
		setIsEditing(false)
		setEditedContent(message.text || "")
		setEditImages(message.images || [])
		setEditMode(mode || "code")
	}, [message.text, message.images, mode])

	// Handle save edit
	const handleSaveEdit = useCallback(() => {
		setIsEditing(false)
		// Send edited message to backend
		vscode.postMessage({
			type: "submitEditedMessage",
			value: message.ts,
			editedMessageContent: editedContent,
			images: editImages,
		})
	}, [message.ts, editedContent, editImages])

	// Handle image selection for editing
	const handleSelectImages = useCallback(() => {
		vscode.postMessage({ type: "selectImages", context: "edit", messageTs: message.ts })
	}, [message.ts])
	*/

	// kilocode_change: usageMissing
	const [cost, usageMissing, apiReqCancelReason, apiReqStreamingFailedMessage] = useMemo(() => {
		if (message.text !== null && message.text !== undefined && message.say === "api_req_started") {
			const info = safeJsonParse<ClineApiReqInfo>(message.text)
			return [info?.cost, info?.usageMissing, info?.cancelReason, info?.streamingFailedMessage]
		}

		return [undefined, undefined, undefined]
	}, [message.text, message.say])

	// When resuming task, last wont be api_req_failed but a resume_task
	// message, so api_req_started will show loading spinner. That's why we just
	// remove the last api_req_started that failed without streaming anything.
	const apiRequestFailedMessage =
		isLast && lastModifiedMessage?.ask === "api_req_failed" // if request is retried then the latest message is a api_req_retried
			? lastModifiedMessage?.text
			: undefined

	const isCommandExecuting =
		isLast && lastModifiedMessage?.ask === "command" && lastModifiedMessage?.text?.includes(COMMAND_OUTPUT_STRING)

	const isMcpServerResponding = isLast && lastModifiedMessage?.say === "mcp_server_request_started"

	const type = message.type === "ask" ? message.ask : message.say

	const [icon, title] = useMemo(() => {
		switch (type) {
			case "error":
				return [
					<span className="codicon codicon-error icon-margin-bottom color-error"></span>,
					<span className="font-weight-bold color-error">{t("chat:error")}</span>,
				]
			case "mistake_limit_reached":
				return [
					<span className="codicon codicon-error icon-margin-bottom color-error"></span>,
					<span className="font-weight-bold color-error">{t("chat:troubleMessage")}</span>,
				]
			case "command":
				return [
					isCommandExecuting ? (
						<ProgressIndicator />
					) : (
						<span className="codicon codicon-terminal icon-margin-bottom color-normal"></span>
					),
					<span className="font-weight-bold color-normal">{t("chat:runCommand.title")}:</span>,
				]
			case "use_mcp_server":
				const mcpServerUse = safeJsonParse<ClineAskUseMcpServer>(message.text)
				if (mcpServerUse === undefined) {
					return [null, null]
				}
				return [
					isMcpServerResponding ? (
						<ProgressIndicator />
					) : (
						<span className="codicon codicon-server icon-margin-bottom color-normal"></span>
					),
					<span className="font-weight-bold color-normal">
						{mcpServerUse.type === "use_mcp_tool"
							? t("chat:mcp.wantsToUseTool", { serverName: mcpServerUse.serverName })
							: t("chat:mcp.wantsToAccessResource", { serverName: mcpServerUse.serverName })}
					</span>,
				]
			case "completion_result":
				return [
					<span className="codicon codicon-check icon-margin-bottom color-success"></span>,
					<span className="font-weight-bold color-success">{t("chat:taskCompleted")}</span>,
				]
			case "api_req_retry_delayed":
				return []
			case "api_req_started":
				const getIconSpan = (iconName: string, colorClass: string) => (
					<div className="flex-center icon-container">
						<span className={`codicon codicon-${iconName} font-size-16 icon-margin-bottom ${colorClass}`} />
					</div>
				)
				return [
					apiReqCancelReason !== null && apiReqCancelReason !== undefined ? (
						apiReqCancelReason === "user_cancelled" ? (
							getIconSpan("error", "color-cancelled")
						) : (
							getIconSpan("error", "color-error")
						)
					) : cost !== null && cost !== undefined ? (
						getIconSpan("check", "color-success")
					) : apiRequestFailedMessage ? (
						getIconSpan("error", "color-error")
					) : (
						<ProgressIndicator />
					),
					apiReqCancelReason !== null && apiReqCancelReason !== undefined ? (
						apiReqCancelReason === "user_cancelled" ? (
							<span className="font-weight-bold color-normal">{t("chat:apiRequest.cancelled")}</span>
						) : (
							<span className="font-weight-bold color-error">{t("chat:apiRequest.streamingFailed")}</span>
						)
					) : cost !== null && cost !== undefined ? (
						<span className="font-weight-bold color-normal">{t("chat:apiRequest.title")}</span>
					) : apiRequestFailedMessage ? (
						<span className="font-weight-bold color-error">{t("chat:apiRequest.failed")}</span>
					) : (
						<span className="font-weight-bold color-normal">{t("chat:apiRequest.streaming")}</span>
					),
				]
			case "followup":
				return [
					<span className="codicon codicon-question icon-margin-bottom color-normal" />,
					<span className="font-weight-bold color-normal">{t("chat:questions.hasQuestion")}</span>,
				]
			default:
				return [null, null]
		}
	}, [type, isCommandExecuting, message, isMcpServerResponding, apiReqCancelReason, cost, apiRequestFailedMessage, t])

	// headerStyle is now replaced with CSS class 'header-style'

	// pStyle is now replaced with CSS class 'p-style'

	const tool = useMemo(
		() => (message.ask === "tool" ? safeJsonParse<ClineSayTool>(message.text) : null),
		[message.ask, message.text],
	)

	const followUpData = useMemo(() => {
		if (message.type === "ask" && message.ask === "followup" && !message.partial) {
			return safeJsonParse<FollowUpData>(message.text)
		}
		return null
	}, [message.type, message.ask, message.partial, message.text])

	if (tool) {
		const toolIcon = (name: string) => (
			<span className={`codicon codicon-${name} color-vscode-foreground icon-margin-bottom`}></span>
		)

		switch (tool.tool) {
			case "editedExistingFile":
			case "appliedDiff":
				// Check if this is a batch diff request
				if (message.type === "ask" && tool.batchDiffs && Array.isArray(tool.batchDiffs)) {
					return (
						<>
							<div className="header-style">
								{toolIcon("diff")}
								<span className="font-weight-bold">
									{t("chat:fileOperations.wantsToApplyBatchChanges")}
								</span>
							</div>
							<BatchDiffApproval files={tool.batchDiffs} ts={message.ts} />
						</>
					)
				}

				// Regular single file diff
				return (
					<>
						<div className="header-style">
							{tool.isProtected ? (
								<span className="codicon codicon-lock color-warning" />
							) : (
								toolIcon(tool.tool === "appliedDiff" ? "diff" : "edit")
							)}
							<span className="font-weight-bold">
								{tool.isProtected
									? t("chat:fileOperations.wantsToEditProtected")
									: tool.isOutsideWorkspace
										? t("chat:fileOperations.wantsToEditOutsideWorkspace")
										: t("chat:fileOperations.wantsToEdit")}
							</span>
						</div>
						<CodeAccordian
							path={tool.path}
							code={tool.content ?? tool.diff}
							language="diff"
							progressStatus={message.progressStatus}
							isLoading={message.partial}
							isExpanded={isExpanded}
							onToggleExpand={handleToggleExpand}
						/>
					</>
				)
			case "insertContent":
				return (
					<>
						<div className="header-style">
							{tool.isProtected ? (
								<span className="codicon codicon-lock color-warning" />
							) : (
								toolIcon("insert")
							)}
							<span className="font-weight-bold">
								{tool.isProtected
									? t("chat:fileOperations.wantsToEditProtected")
									: tool.isOutsideWorkspace
										? t("chat:fileOperations.wantsToEditOutsideWorkspace")
										: tool.lineNumber === 0
											? t("chat:fileOperations.wantsToInsertAtEnd")
											: t("chat:fileOperations.wantsToInsertWithLineNumber", {
													lineNumber: tool.lineNumber,
												})}
							</span>
						</div>
						<CodeAccordian
							path={tool.path}
							code={tool.diff}
							language="diff"
							progressStatus={message.progressStatus}
							isLoading={message.partial}
							isExpanded={isExpanded}
							onToggleExpand={handleToggleExpand}
						/>
					</>
				)
			case "searchAndReplace":
				return (
					<>
						<div className="header-style">
							{tool.isProtected ? (
								<span className="codicon codicon-lock color-warning" />
							) : (
								toolIcon("replace")
							)}
							<span className="font-weight-bold">
								{tool.isProtected && message.type === "ask"
									? t("chat:fileOperations.wantsToEditProtected")
									: message.type === "ask"
										? t("chat:fileOperations.wantsToSearchReplace")
										: t("chat:fileOperations.didSearchReplace")}
							</span>
						</div>
						<CodeAccordian
							path={tool.path}
							code={tool.diff}
							language="diff"
							progressStatus={message.progressStatus}
							isLoading={message.partial}
							isExpanded={isExpanded}
							onToggleExpand={handleToggleExpand}
						/>
					</>
				)
			case "codebaseSearch": {
				return (
					<div className="header-style">
						{toolIcon("search")}
						<span className="font-weight-bold">
							{tool.path ? (
								<Trans
									i18nKey="chat:codebaseSearch.wantsToSearchWithPath"
									components={{ code: <code></code> }}
									values={{ query: tool.query, path: tool.path }}
								/>
							) : (
								<Trans
									i18nKey="chat:codebaseSearch.wantsToSearch"
									components={{ code: <code></code> }}
									values={{ query: tool.query }}
								/>
							)}
						</span>
					</div>
				)
			}
			case "updateTodoList" as any: {
				const todos = (tool as any).todos || []
				return (
					<UpdateTodoListToolBlock
						todos={todos}
						content={(tool as any).content}
						onChange={(updatedTodos) => {
							if (typeof vscode !== "undefined" && vscode?.postMessage) {
								vscode.postMessage({ type: "updateTodoList", payload: { todos: updatedTodos } })
							}
						}}
						editable={editable && isLast}
					/>
				)
			}
			case "newFileCreated":
				return (
					<>
						<div className="header-style">
							{tool.isProtected ? (
								<span className="codicon codicon-lock color-warning icon-margin-bottom" />
							) : (
								toolIcon("new-file")
							)}
							<span className="font-weight-bold">
								{tool.isProtected
									? t("chat:fileOperations.wantsToEditProtected")
									: t("chat:fileOperations.wantsToCreate")}
							</span>
						</div>
						<CodeAccordian
							path={tool.path}
							code={tool.content}
							language={getLanguageFromPath(tool.path || "") || "log"}
							isLoading={message.partial}
							isExpanded={isExpanded}
							onToggleExpand={handleToggleExpand}
							onJumpToFile={() => vscode.postMessage({ type: "openFile", text: "./" + tool.path })}
						/>
					</>
				)
			case "readFile":
				// Check if this is a batch file permission request
				const isBatchRequest = message.type === "ask" && tool.batchFiles && Array.isArray(tool.batchFiles)

				if (isBatchRequest) {
					return (
						<>
							<div className="header-style">
								{toolIcon("files")}
								<span className="font-weight-bold">{t("chat:fileOperations.wantsToReadMultiple")}</span>
							</div>
							<BatchFilePermission
								files={tool.batchFiles || []}
								onPermissionResponse={(response) => {
									onBatchFileResponse?.(response)
								}}
								ts={message?.ts}
							/>
						</>
					)
				}

				// Regular single file read request
				return (
					<>
						<div className="header-style">
							{toolIcon("file-code")}
							<span className="font-weight-bold">
								{message.type === "ask"
									? tool.isOutsideWorkspace
										? t("chat:fileOperations.wantsToReadOutsideWorkspace")
										: tool.additionalFileCount && tool.additionalFileCount > 0
											? t("chat:fileOperations.wantsToReadAndXMore", {
													count: tool.additionalFileCount,
												})
											: t("chat:fileOperations.wantsToRead")
									: t("chat:fileOperations.didRead")}
							</span>
						</div>
						<ToolUseBlock>
							<ToolUseBlockHeader
								onClick={() => vscode.postMessage({ type: "openFile", text: tool.content })}>
								{tool.path?.startsWith(".") && <span>.</span>}
								<span className="whitespace-nowrap overflow-hidden text-ellipsis text-left mr-2 rtl">
									{removeLeadingNonAlphanumeric(tool.path ?? "") + "\u200E"}
									{tool.reason}
								</span>
								<div className="flex-grow"></div>
								<span className={`codicon codicon-link-external font-size-13-5`} />
							</ToolUseBlockHeader>
						</ToolUseBlock>
					</>
				)
			case "fetchInstructions":
				return (
					<>
						<div className="header-style">
							{toolIcon("file-code")}
							<span className="font-weight-bold">{t("chat:instructions.wantsToFetch")}</span>
						</div>
						<CodeAccordian
							code={tool.content}
							language="markdown"
							isLoading={message.partial}
							isExpanded={isExpanded}
							onToggleExpand={handleToggleExpand}
						/>
					</>
				)
			case "listFilesTopLevel":
				return (
					<>
						<div className="header-style">
							{toolIcon("folder-opened")}
							<span className="font-weight-bold">
								{message.type === "ask"
									? tool.isOutsideWorkspace
										? t("chat:directoryOperations.wantsToViewTopLevelOutsideWorkspace")
										: t("chat:directoryOperations.wantsToViewTopLevel")
									: tool.isOutsideWorkspace
										? t("chat:directoryOperations.didViewTopLevelOutsideWorkspace")
										: t("chat:directoryOperations.didViewTopLevel")}
							</span>
						</div>
						<CodeAccordian
							path={tool.path}
							code={tool.content}
							language="shell-session"
							isExpanded={isExpanded}
							onToggleExpand={handleToggleExpand}
						/>
					</>
				)
			case "listFilesRecursive":
				return (
					<>
						<div className="header-style">
							{toolIcon("folder-opened")}
							<span className="font-weight-bold">
								{message.type === "ask"
									? tool.isOutsideWorkspace
										? t("chat:directoryOperations.wantsToViewRecursiveOutsideWorkspace")
										: t("chat:directoryOperations.wantsToViewRecursive")
									: tool.isOutsideWorkspace
										? t("chat:directoryOperations.didViewRecursiveOutsideWorkspace")
										: t("chat:directoryOperations.didViewRecursive")}
							</span>
						</div>
						<CodeAccordian
							path={tool.path}
							code={tool.content}
							language="shellsession"
							isExpanded={isExpanded}
							onToggleExpand={handleToggleExpand}
						/>
					</>
				)
			case "listCodeDefinitionNames":
				return (
					<>
						<div className="header-style">
							{toolIcon("file-code")}
							<span className="font-weight-bold">
								{message.type === "ask"
									? tool.isOutsideWorkspace
										? t("chat:directoryOperations.wantsToViewDefinitionsOutsideWorkspace")
										: t("chat:directoryOperations.wantsToViewDefinitions")
									: tool.isOutsideWorkspace
										? t("chat:directoryOperations.didViewDefinitionsOutsideWorkspace")
										: t("chat:directoryOperations.didViewDefinitions")}
							</span>
						</div>
						<CodeAccordian
							path={tool.path}
							code={tool.content}
							language="markdown"
							isExpanded={isExpanded}
							onToggleExpand={handleToggleExpand}
						/>
					</>
				)
			case "searchFiles":
				return (
					<>
						<div className="flex items-center gap-10 margin-bottom-10 word-break-word">
							{toolIcon("search")}
							<span className="font-weight-bold">
								{message.type === "ask" ? (
									<Trans
										i18nKey={
											tool.isOutsideWorkspace
												? "chat:directoryOperations.wantsToSearchOutsideWorkspace"
												: "chat:directoryOperations.wantsToSearch"
										}
										components={{ code: <code>{tool.regex}</code> }}
										values={{ regex: tool.regex }}
									/>
								) : (
									<Trans
										i18nKey={
											tool.isOutsideWorkspace
												? "chat:directoryOperations.didSearchOutsideWorkspace"
												: "chat:directoryOperations.didSearch"
										}
										components={{ code: <code>{tool.regex}</code> }}
										values={{ regex: tool.regex }}
									/>
								)}
							</span>
						</div>
						<CodeAccordian
							path={tool.path! + (tool.filePattern ? `/(${tool.filePattern})` : "")}
							code={tool.content}
							language="shellsession"
							isExpanded={isExpanded}
							onToggleExpand={handleToggleExpand}
						/>
					</>
				)
			case "switchMode":
				return (
					<>
						<div className="flex items-center gap-10 margin-bottom-10 word-break-word">
							{toolIcon("symbol-enum")}
							<span className="font-weight-bold">
								{message.type === "ask" ? (
									<>
										{tool.reason ? (
											<Trans
												i18nKey="chat:modes.wantsToSwitchWithReason"
												components={{ code: <code>{tool.mode}</code> }}
												values={{ mode: tool.mode, reason: tool.reason }}
											/>
										) : (
											<Trans
												i18nKey="chat:modes.wantsToSwitch"
												components={{ code: <code>{tool.mode}</code> }}
												values={{ mode: tool.mode }}
											/>
										)}
									</>
								) : (
									<>
										{tool.reason ? (
											<Trans
												i18nKey="chat:modes.didSwitchWithReason"
												components={{ code: <code>{tool.mode}</code> }}
												values={{ mode: tool.mode, reason: tool.reason }}
											/>
										) : (
											<Trans
												i18nKey="chat:modes.didSwitch"
												components={{ code: <code>{tool.mode}</code> }}
												values={{ mode: tool.mode }}
											/>
										)}
									</>
								)}
							</span>
						</div>
					</>
				)
			case "newTask":
				return (
					<>
						<div className="flex items-center gap-10 margin-bottom-10 word-break-word">
							{toolIcon("tasklist")}
							<span className="font-weight-bold">
								<Trans
									i18nKey="chat:subtasks.wantsToCreate"
									components={{ code: <code></code> }}
									values={{ mode: tool.mode }}
								/>
							</span>
						</div>
						<div className="new-task-container">
							<div className="new-task-header">
								<span className="codicon codicon-arrow-right"></span>
								{t("chat:subtasks.newTaskContent")}
							</div>
							<div className="finish-task-content">
								<MarkdownBlock markdown={tool.content} />
							</div>
						</div>
					</>
				)
			case "finishTask":
				return (
					<>
						<div className="flex items-center gap-10 margin-bottom-10 word-break-word">
							{toolIcon("check-all")}
							<span className="font-weight-bold">{t("chat:subtasks.wantsToFinish")}</span>
						</div>
						<div className="finish-task-container">
							<div className="subtasks-completion-header">
								<span className="codicon codicon-check"></span>
								{t("chat:subtasks.completionContent")}
							</div>
							<div className="subtasks-completion-content">
								<MarkdownBlock markdown={t("chat:subtasks.completionInstructions")} />
							</div>
						</div>
					</>
				)
			default:
				return null
		}
	}

	switch (message.type) {
		case "say":
			switch (message.say) {
				case "diff_error":
					return (
						<div>
							<div className="diff-error-container">
								<div
									className={`diff-error-header ${isDiffErrorExpanded ? "diff-error-header-expanded" : ""}`}
									onClick={() => setIsDiffErrorExpanded(!isDiffErrorExpanded)}>
									<div className="diff-error-header-content">
										<span className="codicon codicon-warning diff-error-warning-icon"></span>
										<span className="font-weight-bold">{t("chat:diffError.title")}</span>
									</div>
									<div className="diff-error-button-container">
										<VSCodeButton
											appearance="icon"
											className="diff-error-copy-button"
											onClick={(e) => {
												e.stopPropagation()

												// Call copyWithFeedback and handle the Promise
												copyWithFeedback(message.text || "").then((success) => {
													if (success) {
														// Show checkmark
														setShowCopySuccess(true)

														// Reset after a brief delay
														setTimeout(() => {
															setShowCopySuccess(false)
														}, 1000)
													}
												})
											}}>
											<span
												className={`codicon codicon-${showCopySuccess ? "check" : "copy"}`}></span>
										</VSCodeButton>
										<span
											className={`codicon codicon-chevron-${isDiffErrorExpanded ? "up" : "down"}`}></span>
									</div>
								</div>
								{isDiffErrorExpanded && (
									<div className="diff-error-content-padding">
										<CodeBlock source={message.text || ""} language="xml" />
									</div>
								)}
							</div>
						</div>
					)
				case "subtask_result":
					return (
						<div>
							<div className="subtask-result-container">
								<div className="subtask-result-header">
									<span className="codicon codicon-arrow-left"></span>
									{t("chat:subtasks.resultContent")}
								</div>
								<div className="subtask-result-content">
									<MarkdownBlock markdown={message.text} />
								</div>
							</div>
						</div>
					)
				case "reasoning":
					return (
						<ReasoningBlock
							content={message.text || ""}
							elapsed={isLast && isStreaming ? Date.now() - message.ts : undefined}
							isCollapsed={reasoningCollapsed}
							onToggleCollapse={() => setReasoningCollapsed(!reasoningCollapsed)}
						/>
					)
				case "api_req_started":
					return (
						<>
							<div
								className="header-style"
								style={{
									marginBottom:
										((cost === null || cost === undefined) && apiRequestFailedMessage) ||
										apiReqStreamingFailedMessage
											? 10
											: 0,
									justifyContent: "space-between",
									cursor: "pointer",
									userSelect: "none",
									WebkitUserSelect: "none",
									MozUserSelect: "none",
									msUserSelect: "none",
								}}
								onClick={handleToggleExpand}>
								<div className="flex-align-center-gap-10-grow">
									{icon}
									{title}
									{
										// kilocode_change start
										!cost && usageMissing && (
											<StandardTooltip content={t("kilocode:pricing.costUnknownDescription")}>
												<VSCodeBadge className="whitespace-nowrap">
													<span className="codicon codicon-warning pr-1"></span>
													{t("kilocode:pricing.costUnknown")}
												</VSCodeBadge>
											</StandardTooltip>
										)
										// kilocode_change end
									}
									<VSCodeBadge
										style={{ opacity: cost !== null && cost !== undefined && cost > 0 ? 1 : 0 }}>
										${Number(cost || 0)?.toFixed(4)}
									</VSCodeBadge>
								</div>
								{/* kilocode_change start: 添加API请求详情按钮 */}
								<div className="flex-align-center-gap-4-mr-8">
									<VSCodeButton
										appearance="icon"
										onClick={(e) => {
											e.stopPropagation()
											setShowApiRequestModal(true)
										}}
										title="查看API请求详情">
										<span className="codicon codicon-info"></span>
									</VSCodeButton>
								</div>
								{/* kilocode_change end */}
								<span className={`codicon codicon-chevron-${isExpanded ? "up" : "down"}`}></span>
							</div>
							{(((cost === null || cost === undefined) && apiRequestFailedMessage) ||
								apiReqStreamingFailedMessage) && (
								<>
									<p className="p-style error-text">
										{apiRequestFailedMessage || apiReqStreamingFailedMessage}
										{apiRequestFailedMessage?.toLowerCase().includes("powershell") && (
											<>
												<br />
												<br />
												{t("chat:powershell.issues")}{" "}
												<a
													href="https://github.com/cline/cline/wiki/TroubleShooting-%E2%80%90-%22PowerShell-is-not-recognized-as-an-internal-or-external-command%22"
													style={{ color: "inherit", textDecoration: "underline" }}>
													troubleshooting guide
												</a>
												.
											</>
										)}
									</p>
									{/* kilocode_change start: 添加显示详细错误信息的按钮 */}
									{apiRequestFailedMessage && (
										<div className="mt-6">
											<VSCodeButton
												appearance="secondary"
												onClick={() => setShowDetailedError(!showDetailedError)}>
												<span
													className={`codicon codicon-chevron-${showDetailedError ? "up" : "down"} mr-4`}></span>
												显示详细错误信息
											</VSCodeButton>
										</div>
									)}
									{/* 显示详细错误信息 */}
									{showDetailedError && apiRequestFailedMessage && (
										<div className="detailed-error-container mt-6">
											<div className="detailed-error-header">
												<span className="detailed-error-title">详细错误信息:</span>
												<VSCodeButton
													appearance="icon"
													onClick={() => copyWithFeedback(apiRequestFailedMessage)}
													title="复制错误信息">
													<span className="codicon codicon-copy"></span>
												</VSCodeButton>
											</div>
											<div className="detailed-error-message">{apiRequestFailedMessage}</div>
										</div>
									)}
								</>
							)}

							{isExpanded && (
								<div className="mt-6">
									<CodeAccordian
										code={safeJsonParse<any>(message.text)?.request}
										language="markdown"
										isExpanded={true}
										onToggleExpand={handleToggleExpand}
									/>
								</div>
							)}
							{/* kilocode_change start: API请求模态窗口 */}
							<ApiRequestModal
								isOpen={showApiRequestModal}
								onClose={() => setShowApiRequestModal(false)}
								messageText={message.text || ""}
								messageId={message.ts.toString()}
							/>
							{/* kilocode_change end */}
						</>
					)
				case "api_req_finished":
					return null // we should never see this message type
				case "text":
					return (
						<div>
							<Markdown markdown={message.text} partial={message.partial} />
						</div>
					)
				case "user_feedback":
					// kilocode_change start
					return (
						<KiloChatRowUserFeedback
							message={message}
							isStreaming={isStreaming}
							onChatReset={onChatReset}
						/>
					)
				// kilocode_change end
				case "user_feedback_diff":
					const tool = safeJsonParse<ClineSayTool>(message.text)
					return (
						<div className="user-feedback-diff-container">
							<CodeAccordian
								code={tool?.diff}
								language="diff"
								isFeedback={true}
								isExpanded={isExpanded}
								onToggleExpand={handleToggleExpand}
							/>
						</div>
					)
				case "error":
					return (
						<>
							{title && (
								<div className="header-style">
									{icon}
									{title}
								</div>
							)}
							<p className="p-style error-text">{message.text}</p>
						</>
					)
				case "completion_result":
					return (
						<>
							<div className="header-style">
								{icon}
								{title}
							</div>
							<div className="completion-result-text">
								<Markdown markdown={message.text} />
							</div>
						</>
					)
				case "shell_integration_warning":
					return <CommandExecutionError />
				case "checkpoint_saved":
					return (
						<CheckpointSaved
							ts={message.ts!}
							commitHash={message.text!}
							currentHash={currentCheckpoint}
							checkpoint={message.checkpoint}
						/>
					)
				case "condense_context":
					if (message.partial) {
						return <CondensingContextRow />
					}
					return message.contextCondense ? <ContextCondenseRow {...message.contextCondense} /> : null
				case "condense_context_error":
					return <CondenseContextErrorRow errorText={message.text} />
				case "codebase_search_result":
					let parsed: {
						content: {
							query: string
							results: Array<{
								filePath: string
								score: number
								startLine: number
								endLine: number
								codeChunk: string
							}>
						}
					} | null = null

					try {
						if (message.text) {
							parsed = JSON.parse(message.text)
						}
					} catch (error) {
						console.error("Failed to parse codebaseSearch content:", error)
					}

					if (parsed && !parsed?.content) {
						console.error("Invalid codebaseSearch content structure:", parsed.content)
						return <div>Error displaying search results.</div>
					}

					const { results = [] } = parsed?.content || {}

					return <CodebaseSearchResultsDisplay results={results} />
				// kilocode_change start: upstream pr https://github.com/RooCodeInc/Roo-Code/pull/5452
				case "browser_action_result":
					// This should not normally be rendered here as browser_action_result messages
					// should be grouped into browser sessions and rendered by BrowserSessionRow.
					// If we see this, it means the message grouping logic has a bug.
					return (
						<>
							{title && (
								<div className="header-style">
									{icon}
									{title}
								</div>
							)}
							<div className="pt-10">
								<div className="browser-action-error-box">
									⚠️ Browser action result not properly grouped - this is a bug in the message
									grouping logic
								</div>
								<Markdown markdown={message.text} partial={message.partial} />
							</div>
						</>
					)
				// kilocode_change end
				case "user_edit_todos":
					return <UpdateTodoListToolBlock userEdited onChange={() => {}} />
				default:
					return (
						<>
							{title && (
								<div className="header-style">
									{icon}
									{title}
								</div>
							)}
							<div className="pt-10">
								<Markdown markdown={message.text} partial={message.partial} />
							</div>
						</>
					)
			}
		case "ask":
			switch (message.ask) {
				case "mistake_limit_reached":
					return (
						<>
							<div className="header-style">
								{icon}
								{title}
							</div>
							<p className="p-style" style={{ color: "var(--vscode-errorForeground)" }}>
								{message.text}
							</p>
						</>
					)
				case "command":
					return (
						<CommandExecution
							executionId={message.ts.toString()}
							text={message.text}
							icon={icon}
							title={title}
						/>
					)
				case "use_mcp_server":
					// Parse the message text to get the MCP server request
					const messageJson = safeJsonParse<any>(message.text, {})

					// Extract the response field if it exists
					const { response, ...mcpServerRequest } = messageJson

					// Create the useMcpServer object with the response field
					const useMcpServer: ClineAskUseMcpServer = {
						...mcpServerRequest,
						response,
					}

					if (!useMcpServer) {
						return null
					}

					const server = mcpServers.find((server) => server.name === useMcpServer.serverName)

					return (
						<>
							<div className="header-style">
								{icon}
								{title}
							</div>
							<div className="w-full bg-vscode-editor-background border border-vscode-border rounded-xs p-2 mt-2">
								{useMcpServer.type === "access_mcp_resource" && (
									<McpResourceRow
										item={{
											// Use the matched resource/template details, with fallbacks
											...(findMatchingResourceOrTemplate(
												useMcpServer.uri || "",
												server?.resources,
												server?.resourceTemplates,
											) || {
												name: "",
												mimeType: "",
												description: "",
											}),
											// Always use the actual URI from the request
											uri: useMcpServer.uri || "",
										}}
									/>
								)}
								{useMcpServer.type === "use_mcp_tool" && (
									<McpExecution
										executionId={message.ts.toString()}
										text={useMcpServer.arguments !== "{}" ? useMcpServer.arguments : undefined}
										serverName={useMcpServer.serverName}
										toolName={useMcpServer.toolName}
										isArguments={true}
										server={server}
										useMcpServer={useMcpServer}
										alwaysAllowMcp={alwaysAllowMcp}
									/>
								)}
							</div>
						</>
					)
				case "completion_result":
					if (message.text) {
						return (
							<div>
								<div className="header-style">
									{icon}
									{title}
								</div>
								<div className="completion-result-text">
									<Markdown markdown={message.text} partial={message.partial} />
								</div>
							</div>
						)
					} else {
						return null // Don't render anything when we get a completion_result ask without text
					}
				case "followup":
					return (
						<>
							{title && (
								<div className="header-style">
									{icon}
									{title}
								</div>
							)}
							<div className="followup-text-padding">
								<Markdown
									markdown={message.partial === true ? message?.text : followUpData?.question}
								/>
							</div>
							<FollowUpSuggest
								suggestions={followUpData?.suggest}
								onSuggestionClick={onSuggestionClick}
								ts={message?.ts}
								onCancelAutoApproval={onFollowUpUnmount}
								isAnswered={isFollowUpAnswered}
							/>
						</>
					)

				// kilocode_change begin
				case "condense":
					return (
						<>
							<div className="header-style">
								<span className="codicon codicon-new-file condense-icon-style"></span>
								<span className="font-weight-bold color-normal">
									{t("kilocode:chat.condense.wantsToCondense")}
								</span>
							</div>
							<NewTaskPreview context={message.text || ""} />
						</>
					)

				case "payment_required_prompt": {
					return <LowCreditWarning message={message} />
				}
				case "report_bug":
					return (
						<>
							<div className="header-style">
								<span className="codicon codicon-new-file condense-icon-style"></span>
								<span className="font-weight-bold color-normal">
									KiloCode wants to create a Github issue:
								</span>
							</div>
							<ReportBugPreview data={message.text || ""} />
						</>
					)
				// kilocode_change end
				case "auto_approval_max_req_reached": {
					return <AutoApprovedRequestLimitWarning message={message} />
				}
				default:
					return null
			}
	}
}
