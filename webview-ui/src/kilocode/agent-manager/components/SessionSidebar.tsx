import React, { useMemo, useState, useRef, useEffect } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useTranslation } from "react-i18next"
import {
	mergedSessionsAtom,
	selectedSessionIdAtom,
	isRefreshingRemoteSessionsAtom,
	pendingSessionAtom,
	type AgentSession,
} from "../state/atoms/sessions"
import { sessionMachineUiStateAtom } from "../state/atoms/stateMachine"
import { vscode } from "../utils/vscode"
import { formatRelativeTime, createRelativeTimeLabels } from "../utils/timeUtils"
import { Plus, Loader2, RefreshCw, GitBranch, Folder, Share2, MoreVertical, FileCode } from "lucide-react"

export function SessionSidebar() {
	const { t } = useTranslation("agentManager")
	const sessions = useAtomValue(mergedSessionsAtom)
	const pendingSession = useAtomValue(pendingSessionAtom)
	const [selectedId, setSelectedId] = useAtom(selectedSessionIdAtom)
	const isRefreshing = useAtomValue(isRefreshingRemoteSessionsAtom)
	const setIsRefreshing = useSetAtom(isRefreshingRemoteSessionsAtom)
	const machineUiState = useAtomValue(sessionMachineUiStateAtom)
	const [showOptionsMenu, setShowOptionsMenu] = useState(false)
	const menuRef = useRef<HTMLDivElement>(null)
	const buttonRef = useRef<HTMLButtonElement>(null)

	// Close menu when clicking outside
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				menuRef.current &&
				buttonRef.current &&
				!menuRef.current.contains(event.target as Node) &&
				!buttonRef.current.contains(event.target as Node)
			) {
				setShowOptionsMenu(false)
			}
		}

		if (showOptionsMenu) {
			document.addEventListener("mousedown", handleClickOutside)
			return () => document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [showOptionsMenu])

	const handleNewSession = () => {
		setSelectedId(null)
	}

	const handleSelectSession = (id: string) => {
		setSelectedId(id)
		vscode.postMessage({ type: "agentManager.selectSession", sessionId: id })
	}

	const handleRefresh = () => {
		if (isRefreshing) return // Prevent multiple clicks while loading
		setIsRefreshing(true)
		vscode.postMessage({ type: "agentManager.refreshRemoteSessions" })
	}

	const handleConfigureSetupScript = () => {
		setShowOptionsMenu(false)
		vscode.postMessage({ type: "agentManager.configureSetupScript" })
	}

	const isNewAgentSelected = selectedId === null && !pendingSession

	return (
		<div className="am-sidebar">
			<div className="am-sidebar-header">
				<span>{t("sidebar.title")}</span>
				<div className="am-options-menu-container">
					<button
						ref={buttonRef}
						className="am-icon-btn"
						onClick={() => setShowOptionsMenu(!showOptionsMenu)}
						title={t("sidebar.options")}
						aria-expanded={showOptionsMenu}
						aria-haspopup="menu">
						<MoreVertical size={14} />
					</button>
					{showOptionsMenu && (
						<div ref={menuRef} className="am-options-dropdown" role="menu">
							<button className="am-options-item" onClick={handleConfigureSetupScript} role="menuitem">
								<FileCode size={14} />
								<span>{t("sidebar.configureSetupScript")}</span>
							</button>
						</div>
					)}
				</div>
			</div>

			<div
				className={`am-new-agent-item ${isNewAgentSelected ? "am-selected" : ""}`}
				onClick={handleNewSession}
				role="button"
				tabIndex={0}
				onKeyDown={(e) => e.key === "Enter" && handleNewSession()}>
				<Plus size={16} />
				<span>{t("sidebar.newAgent")}</span>
			</div>

			<div className="am-sidebar-section-header">
				<span>{t("sidebar.sessionsSection")}</span>
				<button
					className="am-icon-btn"
					onClick={handleRefresh}
					disabled={isRefreshing}
					title={t("sidebar.refresh")}>
					{isRefreshing ? <Loader2 size={14} className="am-spinning" /> : <RefreshCw size={14} />}
				</button>
			</div>

			<div className="am-session-list">
				{/* Show pending session at the top */}
				{pendingSession && (
					<PendingSessionItem
						pendingSession={pendingSession}
						isSelected={selectedId === null}
						onSelect={() => setSelectedId(null)}
					/>
				)}

				{sessions.length === 0 && !pendingSession ? (
					<div className="am-no-sessions">
						<p>{t("sidebar.emptyState")}</p>
					</div>
				) : (
					sessions.map((session) => (
						<SessionItem
							key={session.sessionId}
							session={session}
							isSelected={selectedId === session.sessionId}
							uiState={machineUiState[session.sessionId]}
							onSelect={() => handleSelectSession(session.sessionId)}
						/>
					))
				)}
			</div>
		</div>
	)
}

function PendingSessionItem({
	pendingSession,
	isSelected,
	onSelect,
}: {
	pendingSession: { label: string; startTime: number }
	isSelected: boolean
	onSelect: () => void
}) {
	const { t } = useTranslation("agentManager")

	return (
		<div className={`am-session-item pending ${isSelected ? "am-selected" : ""}`} onClick={onSelect}>
			<div className="am-status-icon creating" title={t("status.creating")}>
				<Loader2 size={14} className="am-spinning" />
			</div>
			<div className="am-session-content">
				<div className="am-session-label">{pendingSession.label}</div>
				<div className="am-session-meta">{t("status.creating")}</div>
			</div>
		</div>
	)
}

function SessionItem({
	session,
	isSelected,
	uiState,
	onSelect,
}: {
	session: AgentSession
	isSelected: boolean
	uiState: { showSpinner: boolean; isActive: boolean } | undefined
	onSelect: () => void
}) {
	const { t } = useTranslation("agentManager")
	const timeLabels = useMemo(() => createRelativeTimeLabels(t), [t])
	const [showShareConfirm, setShowShareConfirm] = useState(false)
	const [isHovered, setIsHovered] = useState(false)

	const showSpinner = uiState?.showSpinner ?? false
	const isActive = uiState?.isActive ?? false
	const isWorktree = session.parallelMode?.enabled
	const branchName = session.parallelMode?.branch
	const isCompleted = session.status === "done"

	const handleShareClick = (e: React.MouseEvent) => {
		e.stopPropagation()
		setShowShareConfirm(true)
	}

	const handleShareConfirm = (e: React.MouseEvent) => {
		e.stopPropagation()
		setShowShareConfirm(false)
		setIsHovered(false)
		vscode.postMessage({ type: "agentManager.sessionShare", sessionId: session.sessionId })
	}

	const handleShareCancel = (e: React.MouseEvent) => {
		e.stopPropagation()
		setShowShareConfirm(false)
		setIsHovered(false)
	}

	return (
		<div
			className={`am-session-item ${isSelected ? "am-selected" : ""}`}
			onClick={onSelect}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => !showShareConfirm && setIsHovered(false)}>
			{session.status === "creating" && (
				<div className="am-status-icon creating" title={t("status.creating")}>
					<Loader2 size={14} className="am-spinning" />
				</div>
			)}
			{showSpinner && (
				<div className="am-status-icon running" title={t("status.running")}>
					<Loader2 size={14} className="am-spinning" />
				</div>
			)}
			<div className="am-session-content">
				<div className="am-session-label">{session.label}</div>
				<div className="am-session-meta">
					{session.status === "creating" && isActive
						? t("status.creating")
						: formatRelativeTime(session.startTime, timeLabels)}
					{isWorktree && (
						<span className="am-worktree-indicator" title={branchName || t("sidebar.worktree")}>
							<GitBranch size={10} />
							{branchName ? (
								<span className="am-branch-name">
									{branchName.length > 20 ? branchName.slice(0, 20) + "..." : branchName}
								</span>
							) : (
								<span>{t("sidebar.worktree")}</span>
							)}
						</span>
					)}
					{!isWorktree && (
						<span className="am-workspace-indicator" title={t("sidebar.local")}>
							<Folder size={10} />
						</span>
					)}
				</div>
				{isWorktree && isCompleted && <div className="am-ready-to-merge">{t("sidebar.readyToMerge")}</div>}
			</div>
			{(isHovered || showShareConfirm) && (
				<button
					className="w-5 h-5 border-none bg-transparent rounded-[3px] cursor-pointer flex items-center justify-center -mt-0.5 hover:bg-vscode-toolbar-hoverBackground"
					onClick={handleShareClick}
					title={t("sidebar.shareSession")}
					aria-label={t("sidebar.shareSession")}>
					<Share2 size={14} />
				</button>
			)}
			{showShareConfirm && (
				<div
					className="absolute top-full left-2 right-2 mt-1 p-3 bg-vscode-dropdown-background border border-vscode-dropdown-border rounded z-[100] shadow-[0_4px_12px_rgba(0,0,0,0.3)]"
					onClick={(e) => e.stopPropagation()}>
					<div className="text-sm mb-2">{t("sidebar.shareConfirmMessage")}</div>
					<div className="flex gap-2">
						<button
							className="px-3 py-1 rounded-sm text-xs cursor-pointer border border-transparent transition-colors duration-150 bg-vscode-button-background text-vscode-button-foreground hover:bg-vscode-button-hoverBackground"
							onClick={handleShareConfirm}>
							{t("sidebar.shareConfirmYes")}
						</button>
						<button
							className="px-3 py-1 rounded-sm text-xs cursor-pointer border border-transparent transition-colors duration-150 bg-vscode-button-secondaryBackground text-vscode-button-secondaryForeground hover:bg-vscode-button-secondaryHoverBackground"
							onClick={handleShareCancel}>
							{t("sidebar.shareConfirmNo")}
						</button>
					</div>
				</div>
			)}
		</div>
	)
}
