import React, { useState, useEffect, useMemo, useRef } from "react"
import { useAtom, useAtomValue } from "jotai"
import { useTranslation } from "react-i18next"
import {
	selectedSessionAtom,
	startSessionFailedCounterAtom,
	pendingSessionAtom,
	preferredRunModeAtom,
	type RunMode,
} from "../state/atoms/sessions"
import { sessionMachineUiStateAtom, selectedSessionMachineStateAtom } from "../state/atoms/stateMachine"
import { MessageList } from "./MessageList"
import { ChatInput } from "./ChatInput"
import { vscode } from "../utils/vscode"
import { formatRelativeTime, createRelativeTimeLabels } from "../utils/timeUtils"
import { Loader2, SendHorizontal, RefreshCw, GitBranch, Folder, ChevronDown, AlertCircle, Zap, X } from "lucide-react"
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

	// Hooks must be called unconditionally before any early returns
	const timeLabels = useMemo(() => createRelativeTimeLabels(t), [t])

	// Show pending session view only when no other session is selected
	if (pendingSession && !selectedSession) {
		return <PendingSessionView pendingSession={pendingSession} />
	}

	if (!selectedSession) {
		return <NewAgentForm />
	}

	const handleRefresh = () => {
		vscode.postMessage({ type: "agentManager.refreshSessionMessages", sessionId: selectedSession.sessionId })
	}

	// Use state machine UI state as the single source of truth for activity/spinner
	const sessionUiState = machineUiState[selectedSession.sessionId]
	const isActive = sessionUiState?.isActive ?? false
	const showSpinner = sessionUiState?.showSpinner ?? false
	const isWorktree = selectedSession.parallelMode?.enabled
	const branchName = selectedSession.parallelMode?.branch

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
					{!isActive && (
						<button
							className="am-icon-btn"
							onClick={handleRefresh}
							aria-label={t("sessionDetail.refreshButtonTitle")}
							title={t("sessionDetail.refreshButtonTitle")}>
							<RefreshCw size={14} />
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

			<ChatInput sessionId={selectedSession.sessionId} sessionLabel={selectedSession.label} isActive={isActive} />
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
	const [runMode, setRunMode] = useAtom(preferredRunModeAtom)
	const [isStarting, setIsStarting] = useState(false)
	const [isFocused, setIsFocused] = useState(false)
	const [isDropdownOpen, setIsDropdownOpen] = useState(false)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const startSessionFailedCounter = useAtomValue(startSessionFailedCounterAtom)

	// Reset loading state when session start fails (e.g., no workspace folder)
	useEffect(() => {
		if (startSessionFailedCounter > 0) {
			setIsStarting(false)
		}
	}, [startSessionFailedCounter])

	// Close dropdown when clicking outside
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setIsDropdownOpen(false)
			}
		}

		if (isDropdownOpen) {
			document.addEventListener("mousedown", handleClickOutside)
		}

		return () => {
			document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [isDropdownOpen])

	const trimmedPrompt = promptText.trim()
	const isEmpty = trimmedPrompt.length === 0

	const handleStart = () => {
		if (isEmpty || isStarting) return

		setIsStarting(true)
		vscode.postMessage({
			type: "agentManager.startSession",
			prompt: trimmedPrompt,
			parallelMode: runMode === "worktree",
		})
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault()
			handleStart()
		}
	}

	const handleSelectMode = (mode: RunMode) => {
		if (mode === "worktree") {
			// Worktree mode is not yet available for users
			return
		}
		setRunMode(mode)
		setIsDropdownOpen(false)
	}

	return (
		<div className="am-center-form">
			<div
				className="text-[var(--vscode-editor-foreground)]"
				style={{ width: 48, height: 48, margin: "0 auto 16px auto" }}>
				<KiloLogo />
			</div>
			<div style={{ width: "100%", maxWidth: "100%" }}>
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
						autoFocus
						value={promptText}
						onChange={(e) => setPromptText(e.target.value)}
						onKeyDown={handleKeyDown}
						onFocus={() => setIsFocused(true)}
						onBlur={() => setIsFocused(false)}
						aria-label={t("sessionDetail.startNewAgent")}
						disabled={isStarting}
						placeholder={t("sessionDetail.placeholderTask")}
						minRows={5}
						maxRows={12}
						style={{
							paddingTop: "12px",
							paddingBottom: "40px",
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

					{/* Transparent overlay */}
					<div
						className="absolute bottom-[1px] left-2 right-2 h-10 bg-gradient-to-t from-[var(--vscode-input-background)] via-[var(--vscode-input-background)] to-transparent pointer-events-none z-[2]"
						aria-hidden="true"
					/>

					{/* Controls Container */}
					<div className="absolute bottom-2 right-2 z-30 flex items-center gap-2">
						<div ref={dropdownRef} className="am-run-mode-dropdown-inline relative">
							<StandardTooltip content={t("sessionDetail.runMode")}>
								<button
									className="am-run-mode-trigger-inline"
									onClick={() => setIsDropdownOpen(!isDropdownOpen)}
									disabled={isStarting}
									type="button">
									{runMode === "local" ? <Folder size={14} /> : <GitBranch size={14} />}
									<ChevronDown size={10} className={cn("am-chevron", isDropdownOpen && "am-open")} />
								</button>
							</StandardTooltip>
							{isDropdownOpen && (
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
									<StandardTooltip content={t("sessionDetail.comingSoon")}>
										<button
											className={cn("am-run-mode-option-inline", "am-disabled")}
											onClick={() => handleSelectMode("worktree")}
											type="button"
											disabled>
											<GitBranch size={12} />
											<span className="am-run-mode-label">
												{t("sessionDetail.runModeWorktree")}
											</span>
										</button>
									</StandardTooltip>
								</div>
							)}
						</div>

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
							aria-label={isStarting ? t("sessionDetail.starting") : t("sessionDetail.startAriaLabel")}>
							{isStarting ? <Loader2 size={16} className="am-spinning" /> : <SendHorizontal size={16} />}
						</button>
					</div>

					{/* Hint Text inside input */}
					{!promptText && (
						<div
							className="absolute left-3 right-[90px] z-30 flex items-center h-8 overflow-hidden text-ellipsis whitespace-nowrap"
							style={{
								bottom: "0.25rem",
								color: "var(--vscode-descriptionForeground)",
								opacity: 0.7,
								fontSize: "11px",
								userSelect: "none",
								pointerEvents: "none",
							}}>
							{t("sessionDetail.keyboardHint")}
						</div>
					)}
				</div>
			</div>
		</div>
	)
}
