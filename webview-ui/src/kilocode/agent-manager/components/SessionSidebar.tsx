import React, { useMemo } from "react"
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
import { Plus, Loader2, RefreshCw, GitBranch, Folder } from "lucide-react"

export function SessionSidebar() {
	const { t } = useTranslation("agentManager")
	const sessions = useAtomValue(mergedSessionsAtom)
	const pendingSession = useAtomValue(pendingSessionAtom)
	const [selectedId, setSelectedId] = useAtom(selectedSessionIdAtom)
	const isRefreshing = useAtomValue(isRefreshingRemoteSessionsAtom)
	const setIsRefreshing = useSetAtom(isRefreshingRemoteSessionsAtom)
	const machineUiState = useAtomValue(sessionMachineUiStateAtom)

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

	const isNewAgentSelected = selectedId === null && !pendingSession

	return (
		<div className="am-sidebar">
			<div className="am-sidebar-header">
				<span>{t("sidebar.title")}</span>
			</div>

			<div
				className={`am-new-agent-item ${isNewAgentSelected ? "selected" : ""}`}
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
		<div className={`am-session-item pending ${isSelected ? "selected" : ""}`} onClick={onSelect}>
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

	const showSpinner = uiState?.showSpinner ?? false
	const isActive = uiState?.isActive ?? false
	const isWorktree = session.parallelMode?.enabled
	const branchName = session.parallelMode?.branch
	const isCompleted = session.status === "done"

	return (
		<div className={`am-session-item ${isSelected ? "selected" : ""}`} onClick={onSelect}>
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
		</div>
	)
}
