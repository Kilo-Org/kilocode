import React, { useState, useRef, useEffect, useMemo } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useTranslation } from "react-i18next"
import { vscode } from "../utils/vscode"
import { GitBranch, GitPullRequest, SendHorizontal, Square } from "lucide-react"
import { modelsConfigAtom } from "../state/atoms/models"
import DynamicTextArea from "react-textarea-autosize"
import { cn } from "../../../lib/utils"
import { StandardTooltip } from "../../../components/ui"
import { SelectDropdown, type DropdownOption } from "../../../components/ui/select-dropdown"
import { sessionInputAtomFamily, sessionImagesAtomFamily } from "../state/atoms/sessions"
import { sessionTodoStatsAtomFamily } from "../state/atoms/todos"
import { AgentTodoList } from "./AgentTodoList"
import { addToQueueAtom } from "../state/atoms/messageQueue"
import { useImagePaste } from "../hooks/useImagePaste"
import { ImageThumbnail } from "./ImageThumbnail"
import { AddImageButton } from "./AddImageButton"

interface ChatInputProps {
	sessionId: string
	sessionLabel?: string
	isActive?: boolean
	showCancel?: boolean
	showFinishToBranch?: boolean
	showCreatePR?: boolean
	worktreeBranchName?: string
	parentBranch?: string
	sessionStatus?: "creating" | "running" | "done" | "error" | "stopped"
	modelId?: string // Model ID used for this session (displayed read-only)
}

export const ChatInput: React.FC<ChatInputProps> = ({
	sessionId,
	sessionLabel,
	isActive = false,
	showCancel = false,
	showFinishToBranch = false,
	showCreatePR = false,
	worktreeBranchName,
	parentBranch,
	sessionStatus,
	modelId,
}) => {
	const { t } = useTranslation("agentManager")
	const [messageText, setMessageText] = useAtom(sessionInputAtomFamily(sessionId))
	const [selectedImages, setSelectedImages] = useAtom(sessionImagesAtomFamily(sessionId))
	const todoStats = useAtomValue(sessionTodoStatsAtomFamily(sessionId))
	const modelsConfig = useAtomValue(modelsConfigAtom)
	const [isFocused, setIsFocused] = useState(false)
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const addToQueue = useSetAtom(addToQueueAtom)

	// Build model options for the disabled dropdown (consistent with NewAgentForm)
	const modelOptions: DropdownOption[] = useMemo(() => {
		if (!modelsConfig) return []
		return modelsConfig.models.map((model) => ({
			value: model.id,
			label: model.displayName || model.id,
			description: model.contextWindow ? `${Math.floor(model.contextWindow / 1000)}K context` : undefined,
		}))
	}, [modelsConfig])

	// Auto-focus the textarea when the session changes (user selects a different session)
	useEffect(() => {
		textareaRef.current?.focus()
	}, [sessionId])

	const trimmedMessage = messageText.trim()
	const hasText = trimmedMessage.length > 0
	const hasImages = selectedImages.length > 0
	const isEmpty = !hasText && !hasImages
	const isSessionCompleted = sessionStatus === "done" || sessionStatus === "error" || sessionStatus === "stopped"

	// Send is disabled when empty (no text AND no images)
	// Note: Users CAN queue multiple messages while one is sending (for running sessions)
	// Note: Users CAN send messages to completed sessions (to resume them)
	const sendDisabled = isEmpty

	// Use shared hook for image paste and file selection handling
	const { handlePaste, handleFileSelect, openFileBrowser, removeImage, canAddMore, fileInputRef, acceptedMimeTypes } =
		useImagePaste({
			selectedImages,
			setSelectedImages,
		})

	const handleSend = () => {
		if (isEmpty) return

		// Prepare images array (only include if there are images)
		const images = hasImages ? selectedImages : undefined

		if (isSessionCompleted) {
			// Resume a completed session with a new message (sent directly, not queued)
			vscode.postMessage({
				type: "agentManager.resumeSession",
				sessionId,
				sessionLabel,
				content: trimmedMessage || "", // Can be empty if only images
				images,
			})
			setMessageText("")
			setSelectedImages([])
		} else {
			// For running sessions, queue the message instead of sending directly
			const queuedMsg = addToQueue({ sessionId, content: trimmedMessage || "", images })

			if (queuedMsg) {
				// Notify the extension that a message has been queued
				vscode.postMessage({
					type: "agentManager.messageQueued",
					sessionId,
					messageId: queuedMsg.id,
					sessionLabel,
					content: trimmedMessage || "",
					images,
				})

				setMessageText("")
				setSelectedImages([])
			}
		}
	}

	const handleCancel = () => {
		vscode.postMessage({
			type: "agentManager.cancelSession",
			sessionId,
		})
	}

	const handleFinishToBranch = () => {
		vscode.postMessage({
			type: "agentManager.finishWorktreeSession",
			sessionId,
		})
	}

	const handleCreatePR = () => {
		const branch = worktreeBranchName || "current-branch"
		const targetBranch = parentBranch || "main"

		const instructions = `The user wants to create a pull request.

Local branch: ${branch}
Target branch: origin/${targetBranch}

Follow these steps:

1. First, verify gh CLI is ready by running: gh auth status
   - If gh is not installed, ask the user to install it: https://cli.github.com/
   - If not authenticated, ask the user to run: gh auth login
   - Do not proceed until gh is ready.

2. Run git status to check for uncommitted changes

3. Run git diff to understand what changes exist (both staged and unstaged)

4. Based on the changes, prepare suggestions for the user:
   - Propose a CLEAN branch name following conventions (e.g., feat/description, fix/description, docs/description)
     Do NOT suggest the auto-generated local branch name "${branch}" - always propose a better name.
   - Propose a descriptive commit message (if there are uncommitted changes)
   - Propose a PR title (under 80 chars)
   - Propose a PR description (concise summary)

5. STOP and present your suggestions to the user. Ask them to confirm or edit:
   - Branch name for the PR (your clean suggestion, not the auto-generated one)
   - Commit message (if applicable)
   - PR title
   - PR description

   DO NOT commit, push, or create the PR until the user explicitly confirms.

6. Once the user confirms, execute in this order:
   a. If there are uncommitted changes, commit with the confirmed message
   b. Push to origin with the confirmed branch name:
      git push origin ${branch}:<confirmed-branch-name>
   c. Create the PR: gh pr create --base ${targetBranch} --head <confirmed-branch-name> --title "<confirmed-title>" --body "<confirmed-description>"

If any step fails, ask the user for help.`

		if (isSessionCompleted) {
			// Resume session with PR instructions
			vscode.postMessage({
				type: "agentManager.resumeSession",
				sessionId,
				sessionLabel,
				content: instructions,
			})
		} else {
			// Queue message for running session
			const queuedMsg = addToQueue({ sessionId, content: instructions })
			if (queuedMsg) {
				vscode.postMessage({
					type: "agentManager.messageQueued",
					sessionId,
					messageId: queuedMsg.id,
					sessionLabel,
					content: instructions,
				})
			}
		}
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault()
			handleSend()
		}
	}

	const hasTodos = todoStats.totalCount > 0

	return (
		<div className="am-chat-input-container">
			{/* Unified wrapper - handles border and focus state for textarea + toolbar */}
			<div
				className={cn(
					"relative flex-1 flex flex-col min-h-0 overflow-hidden rounded",
					"border bg-vscode-input-background",
					isFocused
						? "border-vscode-focusBorder outline outline-vscode-focusBorder"
						: "border-vscode-input-border",
				)}>
				{/* Todo list above input */}
				{hasTodos && <AgentTodoList stats={todoStats} isIntegrated />}
				<div className={cn("relative", "flex-1", "flex", "flex-col", "min-h-0", "overflow-visible")}>
					<DynamicTextArea
						ref={textareaRef}
						value={messageText}
						onChange={(e) => setMessageText(e.target.value)}
						onKeyDown={handleKeyDown}
						onPaste={handlePaste}
						onFocus={() => setIsFocused(true)}
						onBlur={() => setIsFocused(false)}
						aria-label={t("chatInput.ariaLabel")}
						placeholder={t("chatInput.placeholderTypeTask")}
						minRows={3}
						maxRows={15}
						className={cn(
							"w-full",
							"text-vscode-input-foreground",
							"font-vscode-font-family",
							"text-vscode-editor-font-size",
							"leading-vscode-editor-line-height",
							"cursor-text",
							"!pt-3 !pl-3 pr-3 !pb-2",
							"bg-vscode-input-background",
							"!border-none !outline-none",
							"focus:!border-none focus:!outline-none focus:ring-0",
							"focus-visible:!border-none focus-visible:!outline-none focus-visible:ring-0",
							"transition-background-color duration-150 ease-in-out",
							"will-change-background-color",
							"min-h-[70px]",
							"box-border",
							"resize-none",
							"overflow-x-hidden",
							"overflow-y-auto",
							"flex-none flex-grow",
							"scrollbar-none",
							"scrollbar-hide",
						)}
					/>

					{/* Bottom toolbar - inside the bordered container */}
					<div className="flex items-center justify-between px-3 pb-2 bg-vscode-input-background">
						{/* Left side: Image thumbnails and hint */}
						<div className="flex items-center gap-2 min-w-0 flex-1">
							{selectedImages.length > 0 && (
								<div className="flex items-center gap-1.5 flex-shrink-0">
									{selectedImages.map((image, index) => (
										<ImageThumbnail key={index} src={image} index={index} onRemove={removeImage} />
									))}
								</div>
							)}
							{!messageText && !hasImages && (
								<div className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-vscode-descriptionForeground opacity-70 select-none">
									{t("chatInput.hint")}
								</div>
							)}
						</div>

						{/* Right side: Actions */}
						<div className="flex items-center gap-1 flex-shrink-0">
							<AddImageButton
								onClick={openFileBrowser}
								onFileSelect={handleFileSelect}
								fileInputRef={fileInputRef}
								acceptedMimeTypes={acceptedMimeTypes}
								disabled={!canAddMore}
							/>
							{/* Model indicator (read-only) - disabled SelectDropdown for visual consistency */}
							{modelId && modelOptions.length > 0 && (
								<div className="am-model-selector mr-1">
									<SelectDropdown
										value={modelId}
										options={modelOptions}
										onChange={() => {}} // No-op since disabled
										disabled={true}
										triggerClassName="am-model-selector-trigger"
										contentClassName="am-model-selector-content"
										align="end"
									/>
								</div>
							)}
							{showFinishToBranch && (
								<StandardTooltip
									content={
										worktreeBranchName
											? t("chatInput.finishToBranchTitle", { branch: worktreeBranchName })
											: t("chatInput.finishToBranchTitleNoBranch")
									}>
									<button
										aria-label={
											worktreeBranchName
												? t("chatInput.finishToBranchTitle", { branch: worktreeBranchName })
												: t("chatInput.finishToBranchTitleNoBranch")
										}
										onClick={handleFinishToBranch}
										className={cn(
											"relative inline-flex items-center justify-center",
											"bg-transparent border-none p-1.5",
											"rounded-md min-w-[28px] min-h-[28px]",
											"opacity-60 hover:opacity-100 text-vscode-descriptionForeground hover:text-vscode-foreground",
											"transition-all duration-150",
											"hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
											"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
											"active:bg-[rgba(255,255,255,0.1)]",
											"cursor-pointer",
										)}>
										<GitBranch size={14} />
									</button>
								</StandardTooltip>
							)}
							{showCreatePR && (
								<StandardTooltip content={t("chatInput.createPRTitle")}>
									<button
										aria-label={t("chatInput.createPRTitle")}
										onClick={handleCreatePR}
										className={cn(
											"relative inline-flex items-center justify-center",
											"bg-transparent border-none p-1.5",
											"rounded-md min-w-[28px] min-h-[28px]",
											"opacity-60 hover:opacity-100 text-vscode-descriptionForeground hover:text-vscode-foreground",
											"transition-all duration-150",
											"hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
											"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
											"active:bg-[rgba(255,255,255,0.1)]",
											"cursor-pointer",
										)}>
										<GitPullRequest size={14} />
									</button>
								</StandardTooltip>
							)}
							{isActive && showCancel && (
								<StandardTooltip content={t("chatInput.cancelTitle")}>
									<button
										aria-label={t("chatInput.cancelTitle")}
										onClick={handleCancel}
										className={cn(
											"relative inline-flex items-center justify-center",
											"bg-transparent border-none p-1.5",
											"rounded-md min-w-[28px] min-h-[28px]",
											"opacity-60 hover:opacity-100 text-vscode-errorForeground",
											"transition-all duration-150",
											"hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
											"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
											"active:bg-[rgba(255,255,255,0.1)]",
											"cursor-pointer",
										)}>
										<Square size={14} fill="currentColor" />
									</button>
								</StandardTooltip>
							)}
							<StandardTooltip content={t("chatInput.sendTitle")}>
								<button
									aria-label={t("chatInput.sendTitle")}
									disabled={sendDisabled}
									onClick={handleSend}
									className={cn(
										"relative inline-flex items-center justify-center",
										"bg-transparent border-none p-1.5",
										"rounded-md min-w-[28px] min-h-[28px]",
										"opacity-60 hover:opacity-100 text-vscode-descriptionForeground hover:text-vscode-foreground",
										"transition-all duration-150",
										"hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
										"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
										"active:bg-[rgba(255,255,255,0.1)]",
										!sendDisabled && "cursor-pointer",
										sendDisabled &&
											"opacity-40 cursor-not-allowed grayscale-[30%] hover:bg-transparent hover:border-[rgba(255,255,255,0.08)] active:bg-transparent",
									)}>
									{/* rtl support */}
									<SendHorizontal className="w-4 h-4 rtl:-scale-x-100" />
								</button>
							</StandardTooltip>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
