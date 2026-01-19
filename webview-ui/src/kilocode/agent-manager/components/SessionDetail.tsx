import React, { useState, useEffect, useMemo, useRef } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useTranslation } from "react-i18next"
import {
	selectedSessionAtom,
	startSessionFailedCounterAtom,
	pendingSessionAtom,
	preferredRunModeAtom,
	versionCountAtom,
	generateVersionLabels,
	VERSION_COUNT_OPTIONS,
	type RunMode,
	type VersionCount,
} from "../state/atoms/sessions"
import {
	modelsConfigAtom,
	modelsLoadingAtom,
	effectiveModelIdAtom,
	setSelectedModelIdAtom,
} from "../state/atoms/models"
import { effectiveModeSlugAtom } from "../state/atoms/modes"
import { CaretDownIcon } from "@radix-ui/react-icons"
import { SelectDropdown, type DropdownOption } from "../../../components/ui/select-dropdown"
import { sessionMachineUiStateAtom, selectedSessionMachineStateAtom } from "../state/atoms/stateMachine"
import { MessageList } from "./MessageList"
import { ChatInput } from "./ChatInput"
import { BranchPicker } from "./BranchPicker"
import { ImageThumbnail } from "./ImageThumbnail"
import { AddImageButton } from "./AddImageButton"
import { ModeSelector } from "./ModeSelector"
import { vscode } from "../utils/vscode"
import { formatRelativeTime, createRelativeTimeLabels } from "../utils/timeUtils"
import { useImagePaste } from "../hooks/useImagePaste"
import {
	Loader2,
	SendHorizontal,
	GitBranch,
	Folder,
	ChevronDown,
	AlertCircle,
	Zap,
	Layers,
	X,
	Terminal,
} from "lucide-react"
import DynamicTextArea from "react-textarea-autosize"
import { cn } from "../../../lib/utils"
import { StandardTooltip } from "../../../components/ui"
import { KiloLogo } from "./KiloLogo"

export function SessionDetail() {
	const { t } = useTranslation("agentManager")
	const selectedSession = useAtomValue(selectedSessionAtom)
	const pendingSession = useAtomValue(pendingSessionAtom)
	const machineUiState = useAtomValue(sessionMachineUiStateAtom)
	const selectedSessionState = useAtomValue(selectedSessionMachineStateAtom)
	const prevSessionStateRef = useRef<{ id: string; status: string } | undefined>(undefined)

	// Hooks must be called unconditionally before any early returns
	const timeLabels = useMemo(() => createRelativeTimeLabels(t), [t])

	// Auto-cancel session when it ends (as if user clicked the red cancel button)
	// Only send cancel once when transitioning from "running" to a terminal state
	// Track both sessionId and status to avoid spurious cancels on session switches
	useEffect(() => {
		if (!selectedSession) return

		const prevState = prevSessionStateRef.current
		const currentState = { id: selectedSession.sessionId, status: selectedSession.status }

		// Update the ref for next render
		prevSessionStateRef.current = currentState

		// Only send cancel if same session transitioned from running to terminal state
		if (prevState?.id === currentState.id && prevState.status === "running" && currentState.status !== "running") {
			vscode.postMessage({
				type: "agentManager.cancelSession",
				sessionId: selectedSession.sessionId,
			})
		}
	}, [selectedSession])

	// Show pending session view only when no other session is selected
	if (pendingSession && !selectedSession) {
		return <PendingSessionView pendingSession={pendingSession} />
	}

	if (!selectedSession) {
		return <NewAgentForm />
	}

	// Use state machine UI state as the single source of truth for activity/spinner
	const sessionUiState = machineUiState[selectedSession.sessionId]
	const isActive = sessionUiState?.isActive ?? false
	const showSpinner = sessionUiState?.showSpinner ?? false
	const isWorktree = selectedSession.parallelMode?.enabled
	const branchName = selectedSession.parallelMode?.branch
	const isProvisionalSession = selectedSession.sessionId.startsWith("provisional-")

	// Determine if "Finish to Branch" button should be shown
	// Simplified logic: show when session is a worktree session and running
	// Users should be able to finish at any point while the session is active
	const isSessionRunning = selectedSession.status === "running"
	const canFinishWorktree = !!isWorktree && isSessionRunning

	// Determine if "Create PR" button should be shown
	// Show for worktree sessions with a branch, whether running or completed (can resume)
	const canCreatePR = !!isWorktree && !!branchName
	const parentBranch = selectedSession.parallelMode?.parentBranch

	return (
		<div className="am-session-detail">
			<div className="am-detail-header">
				<div className="am-header-info">
					<div className="am-header-title" title={selectedSession.prompt}>
						{selectedSession.label}
					</div>
					<div className="am-header-meta">
						{showSpinner && (
							<div style={{ display: "flex", alignItems: "center", gap: 4 }}>
								<Loader2 size={12} className="am-spinning" />
								<span>
									{selectedSessionState === "creating" ? t("status.creating") : t("status.running")}
								</span>
							</div>
						)}
						<span>{formatRelativeTime(selectedSession.startTime, timeLabels)}</span>
						{isWorktree ? (
							<div
								className="am-worktree-badge"
								style={{ display: "flex", alignItems: "center", gap: 4 }}
								title={branchName || t("sessionDetail.runningInWorktree")}>
								<GitBranch size={12} />
								<span>{branchName || t("sidebar.worktree")}</span>
							</div>
						) : (
							<div
								className="am-local-badge"
								style={{ display: "flex", alignItems: "center", gap: 4 }}
								title={t("sessionDetail.runningLocally")}>
								<Folder size={12} />
								<span>{t("sessionDetail.runModeLocal")}</span>
							</div>
						)}
					</div>
				</div>
				<div className="am-header-actions">
					{!isProvisionalSession && (
						<button
							className="am-icon-btn"
							onClick={() => {
								vscode.postMessage({
									type: "agentManager.showTerminal",
									sessionId: selectedSession.sessionId,
								})
							}}
							aria-label={t("sessionDetail.openTerminal")}
							title={t("sessionDetail.openTerminal")}>
							<Terminal size={14} />
						</button>
					)}
				</div>
			</div>

			{selectedSession.status === "error" && selectedSession.error && (
				<div className="am-session-error-banner" role="alert">
					<AlertCircle size={16} />
					<span>{selectedSession.error}</span>
				</div>
			)}

			{isActive && (
				<div className="am-full-auto-banner">
					<Zap size={14} />
					<span>{t("sessionDetail.autoModeWarning")}</span>
				</div>
			)}

			<MessageList sessionId={selectedSession.sessionId} />

			<ChatInput
				sessionId={selectedSession.sessionId}
				sessionLabel={selectedSession.label}
				isActive={isActive}
				showCancel={isActive}
				showFinishToBranch={canFinishWorktree}
				showCreatePR={canCreatePR}
				worktreeBranchName={branchName}
				parentBranch={parentBranch}
				sessionStatus={selectedSession.status}
				modelId={selectedSession.model}
			/>
		</div>
	)
}

/**
 * View shown while a session is being created (waiting for CLI's session_created event)
 */
function PendingSessionView({
	pendingSession,
}: {
	pendingSession: { label: string; prompt: string; startTime: number }
}) {
	const { t } = useTranslation("agentManager")

	const handleCancel = () => {
		vscode.postMessage({ type: "agentManager.cancelPendingSession" })
	}

	return (
		<div className="am-session-detail">
			<div className="am-detail-header">
				<div className="am-header-info">
					<div className="am-header-title" title={pendingSession.prompt}>
						{pendingSession.label}
					</div>
					<div className="am-header-meta">
						<div style={{ display: "flex", alignItems: "center", gap: 4 }}>
							<Loader2 size={12} className="am-spinning" />
							<span>{t("status.creating")}</span>
						</div>
					</div>
				</div>
				<div className="am-header-actions">
					<button
						className="am-icon-btn"
						onClick={handleCancel}
						aria-label={t("sessionDetail.cancelCreating")}
						title={t("sessionDetail.cancelCreating")}>
						<X size={14} />
					</button>
				</div>
			</div>

			<div className="am-center-form">
				<Loader2 size={48} className="am-spinning" style={{ opacity: 0.5 }} />
				<h2 style={{ marginTop: 16 }}>{t("sessionDetail.creatingSession")}</h2>
				<p>{t("sessionDetail.waitingForCli")}</p>
				<button className="am-cancel-btn" onClick={handleCancel} style={{ marginTop: 16 }}>
					{t("sessionDetail.cancelButton")}
				</button>
			</div>
		</div>
	)
}

function NewAgentForm() {
	const { t } = useTranslation("agentManager")
	const [promptText, setPromptText] = useState("")
	const [selectedImages, setSelectedImages] = useState<string[]>([])
	const [runMode, setRunMode] = useAtom(preferredRunModeAtom)
	const [versionCount, setVersionCount] = useAtom(versionCountAtom)
	const setSelectedModelId = useSetAtom(setSelectedModelIdAtom)
	const modelsConfig = useAtomValue(modelsConfigAtom)
	const modelsLoading = useAtomValue(modelsLoadingAtom)
	const effectiveModelId = useAtomValue(effectiveModelIdAtom)
	const effectiveModeSlug = useAtomValue(effectiveModeSlugAtom)
	const [isStarting, setIsStarting] = useState(false)
	const [isFocused, setIsFocused] = useState(false)
	const [isDropdownOpen, setIsDropdownOpen] = useState(false)
	const [isVersionDropdownOpen, setIsVersionDropdownOpen] = useState(false)
	const [selectedBranch, setSelectedBranch] = useState<string | null>(null)
	const [isBranchPickerOpen, setIsBranchPickerOpen] = useState(false)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const versionDropdownRef = useRef<HTMLDivElement>(null)
	const startSessionFailedCounter = useAtomValue(startSessionFailedCounterAtom)

	// Multi-version mode forces worktree mode
	const isMultiVersion = versionCount > 1
	const effectiveRunMode = isMultiVersion ? "worktree" : runMode

	// Reset loading state when session start fails (e.g., no workspace folder)
	useEffect(() => {
		if (startSessionFailedCounter > 0) {
			setIsStarting(false)
		}
	}, [startSessionFailedCounter])

	// Request branches on mount and when switching to worktree mode
	useEffect(() => {
		vscode.postMessage({ type: "agentManager.listBranches" })
	}, [])

	// Also request when switching to worktree mode
	useEffect(() => {
		if (effectiveRunMode === "worktree") {
			vscode.postMessage({ type: "agentManager.listBranches" })
		}
	}, [effectiveRunMode])

	// Close dropdowns when clicking outside
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setIsDropdownOpen(false)
			}
			if (versionDropdownRef.current && !versionDropdownRef.current.contains(event.target as Node)) {
				setIsVersionDropdownOpen(false)
			}
		}

		if (isDropdownOpen || isVersionDropdownOpen) {
			document.addEventListener("mousedown", handleClickOutside)
		}

		return () => {
			document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [isDropdownOpen, isVersionDropdownOpen])

	const trimmedPrompt = promptText.trim()
	const hasText = trimmedPrompt.length > 0
	const hasImages = selectedImages.length > 0
	const isEmpty = !hasText && !hasImages

	// Use shared hook for image paste handling
	const { handlePaste, handleFileSelect, openFileBrowser, removeImage, canAddMore, fileInputRef, acceptedMimeTypes } =
		useImagePaste({
			selectedImages,
			setSelectedImages,
			disabled: isStarting,
		})

	const handleStart = () => {
		if (isEmpty || isStarting) return

		setIsStarting(true)

		// Generate labels for multi-version mode
		const labels = isMultiVersion ? generateVersionLabels(trimmedPrompt.slice(0, 50), versionCount) : undefined

		// Prepare images array (only include if there are images)
		const images = hasImages ? selectedImages : undefined

		vscode.postMessage({
			type: "agentManager.startSession",
			prompt: trimmedPrompt || "", // Can be empty if only images
			parallelMode: effectiveRunMode === "worktree",
			versions: versionCount,
			labels,
			existingBranch: selectedBranch || undefined,
			model: effectiveModelId || undefined,
			mode: effectiveModeSlug || undefined,
			images,
		})
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault()
			handleStart()
		}
	}

	const handleSelectMode = (mode: RunMode) => {
		setRunMode(mode)
		setIsDropdownOpen(false)
	}

	const handleSelectVersionCount = (count: VersionCount) => {
		setVersionCount(count)
		setIsVersionDropdownOpen(false)
	}

	// Convert models to SelectDropdown options
	const modelOptions: DropdownOption[] = useMemo(() => {
		if (!modelsConfig) return []
		return modelsConfig.models.map((model) => ({
			value: model.id,
			label: model.displayName || model.id,
			description: model.contextWindow ? `${Math.floor(model.contextWindow / 1000)}K context` : undefined,
		}))
	}, [modelsConfig])

	// Check if models are available (loaded and have items)
	const hasModels = modelsConfig && modelsConfig.models.length > 0

	return (
		<div className="am-center-form">
			<div
				className="text-[var(--vscode-editor-foreground)]"
				style={{ width: 48, height: 48, margin: "0 auto 16px auto" }}>
				<KiloLogo />
			</div>
			<div style={{ width: "100%", maxWidth: "100%", minWidth: "280px" }}>
				<div
					className={cn(
						"relative",
						"flex",
						"flex-col-reverse",
						"min-h-0",
						"overflow-visible", // Allow dropdown to overflow
						"rounded",
					)}>
					<DynamicTextArea
						// Key changes when images are added/removed to trigger resize recalculation
						key={hasImages ? "with-images" : "no-images"}
						autoFocus
						value={promptText}
						onChange={(e) => setPromptText(e.target.value)}
						onKeyDown={handleKeyDown}
						onPaste={handlePaste}
						onFocus={() => setIsFocused(true)}
						onBlur={() => setIsFocused(false)}
						aria-label={t("sessionDetail.startNewAgent")}
						disabled={isStarting}
						placeholder={t("sessionDetail.placeholderTask")}
						minRows={5}
						maxRows={12}
						style={{
							paddingTop: "12px",
							// Add extra padding when images are present to make room for the image row
							paddingBottom: hasImages ? "76px" : "40px",
							paddingLeft: "16px",
							paddingRight: "36px",
						}}
						className={cn(
							"w-full",
							"text-vscode-input-foreground",
							"font-vscode-font-family",
							"text-vscode-editor-font-size",
							"leading-vscode-editor-line-height",
							"cursor-text",
							// Padding handled by style prop now
							isFocused
								? "border border-vscode-focusBorder outline outline-vscode-focusBorder"
								: "border border-vscode-input-border",
							"bg-vscode-input-background",
							"transition-background-color duration-150 ease-in-out",
							"will-change-background-color",
							"box-border",
							"rounded",
							"resize-none",
							"overflow-x-hidden",
							"overflow-y-auto",
							"flex-none flex-grow",
							"z-[2]",
							"scrollbar-none",
							"scrollbar-hide",
						)}
					/>

					<div
						className="absolute bottom-[1px] left-2 right-2 h-10 bg-gradient-to-t from-[var(--vscode-input-background)] via-[var(--vscode-input-background)] to-transparent pointer-events-none z-[2]"
						aria-hidden="true"
					/>

					{/* Image thumbnails row - positioned above the action buttons */}
					{selectedImages.length > 0 && (
						<div className="absolute bottom-10 left-3 right-2 z-30 flex items-center gap-1.5 pb-1">
							{selectedImages.map((image, index) => (
								<ImageThumbnail key={index} src={image} index={index} onRemove={removeImage} />
							))}
						</div>
					)}

					{/* Bottom bar with actions */}
					<div className="absolute bottom-2 left-3 right-2 z-30 flex items-center justify-end">
						{/* Actions on the right */}
						<div className="flex items-center gap-2">
							<AddImageButton
								onClick={openFileBrowser}
								onFileSelect={handleFileSelect}
								fileInputRef={fileInputRef}
								acceptedMimeTypes={acceptedMimeTypes}
								disabled={!canAddMore}
							/>
							<ModeSelector disabled={isStarting} />
							<div ref={dropdownRef} className="am-run-mode-dropdown-inline relative">
								<StandardTooltip
									content={
										isMultiVersion
											? t("sessionDetail.versionsHelperText", { count: versionCount })
											: effectiveRunMode === "local"
												? t("sessionDetail.runModeLocal")
												: t("sessionDetail.runModeWorktree")
									}>
									<button
										className={cn("am-run-mode-trigger-inline", isMultiVersion && "am-locked")}
										onClick={() => !isMultiVersion && setIsDropdownOpen(!isDropdownOpen)}
										disabled={isStarting || isMultiVersion}
										type="button">
										{effectiveRunMode === "local" ? <Folder size={14} /> : <GitBranch size={14} />}
										{!isMultiVersion && (
											<ChevronDown
												size={10}
												className={cn("am-chevron", isDropdownOpen && "am-open")}
											/>
										)}
									</button>
								</StandardTooltip>
								{isDropdownOpen && !isMultiVersion && (
									<div className="am-run-mode-menu-inline">
										<button
											className={cn(
												"am-run-mode-option-inline",
												runMode === "local" && "am-selected",
											)}
											onClick={() => handleSelectMode("local")}
											type="button">
											<Folder size={12} />
											<span>{t("sessionDetail.runModeLocal")}</span>
											{runMode === "local" && <span className="am-checkmark">✓</span>}
										</button>
										<button
											className={cn(
												"am-run-mode-option-inline",
												runMode === "worktree" && "am-selected",
											)}
											onClick={() => handleSelectMode("worktree")}
											type="button">
											<GitBranch size={12} />
											<span className="am-run-mode-label">
												{t("sessionDetail.runModeWorktree")}
											</span>
											{runMode === "worktree" && <span className="am-checkmark">✓</span>}
										</button>
									</div>
								)}
							</div>

							<div ref={versionDropdownRef} className="am-run-mode-dropdown-inline relative">
								<StandardTooltip content={t("sessionDetail.versionsTooltip")}>
									<button
										className="am-run-mode-trigger-inline"
										onClick={() => setIsVersionDropdownOpen(!isVersionDropdownOpen)}
										disabled={isStarting}
										type="button"
										title={t("sessionDetail.versions")}>
										<Layers size={14} />
										<span className="am-version-count">{versionCount}</span>
										<ChevronDown
											size={10}
											className={cn("am-chevron", isVersionDropdownOpen && "am-open")}
										/>
									</button>
								</StandardTooltip>
								{isVersionDropdownOpen && (
									<div className="am-run-mode-menu-inline">
										{VERSION_COUNT_OPTIONS.map((count) => (
											<button
												key={count}
												className={cn(
													"am-run-mode-option-inline",
													versionCount === count && "am-selected",
												)}
												onClick={() => handleSelectVersionCount(count)}
												type="button">
												<span>{t("sessionDetail.versionCount", { count })}</span>
												{versionCount === count && <span className="am-checkmark">✓</span>}
											</button>
										))}
									</div>
								)}
							</div>

							{effectiveRunMode === "worktree" && !isMultiVersion && (
								<StandardTooltip content={t("sessionDetail.branchPickerTooltip")}>
									<button
										className="am-run-mode-trigger-inline"
										onClick={() => setIsBranchPickerOpen(true)}
										disabled={isStarting}
										type="button"
										title={t("sessionDetail.selectBranch")}>
										<GitBranch size={14} />
										<span className="truncate max-w-[80px] text-sm">
											{selectedBranch || t("sessionDetail.selectBranch")}
										</span>
										<ChevronDown size={10} className="am-chevron" />
									</button>
								</StandardTooltip>
							)}

							<button
								className={cn(
									"relative inline-flex items-center justify-center",
									"bg-transparent border-none p-1.5",
									"rounded-md min-w-[28px] min-h-[28px]",
									"opacity-60 hover:opacity-100 text-vscode-descriptionForeground hover:text-vscode-foreground",
									"transition-all duration-150",
									"hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
									"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
									"active:bg-[rgba(255,255,255,0.1)]",
									!isEmpty && !isStarting && "cursor-pointer",
									(isEmpty || isStarting) &&
										"opacity-40 cursor-not-allowed grayscale-[30%] hover:bg-transparent hover:border-[rgba(255,255,255,0.08)] active:bg-transparent",
								)}
								onClick={handleStart}
								disabled={isEmpty || isStarting}
								aria-label={
									isStarting ? t("sessionDetail.starting") : t("sessionDetail.startAriaLabel")
								}
								title={
									isMultiVersion
										? t("sessionDetail.launchVersions", { count: versionCount })
										: t("sessionDetail.startAgent")
								}>
								{isStarting ? (
									<Loader2 size={16} className="am-spinning" />
								) : (
									<SendHorizontal size={16} />
								)}
							</button>
						</div>
					</div>
				</div>

				{/* Model selector below textarea - like in the main sidebar */}
				<div className="mt-2 flex items-center justify-start">
					{modelsLoading ? (
						<div className="am-model-selector-trigger opacity-70 flex items-center gap-1.5">
							<Loader2 size={14} className="am-spinning" />
							<span className="text-xs">{t("sessionDetail.loadingModels")}</span>
						</div>
					) : hasModels ? (
						<div className="am-model-selector">
							<SelectDropdown
								value={effectiveModelId || ""}
								options={modelOptions}
								onChange={(value) => setSelectedModelId(value)}
								disabled={isStarting}
								placeholder={t("sessionDetail.selectModel")}
								title={t("sessionDetail.modelTooltip")}
								triggerClassName="am-model-selector-trigger"
								contentClassName="am-model-selector-content"
								align="start"
								triggerIcon={CaretDownIcon}
							/>
						</div>
					) : null}
				</div>
			</div>

			{isBranchPickerOpen && (
				<BranchPicker
					selectedBranch={selectedBranch}
					onSelect={setSelectedBranch}
					onClose={() => setIsBranchPickerOpen(false)}
				/>
			)}
		</div>
	)
}
