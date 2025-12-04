import React from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useTranslation } from "react-i18next"
import {
	mergedSessionsAtom,
	selectedSessionIdAtom,
	isRefreshingRemoteSessionsAtom,
	startRefreshingRemoteSessionsAtom,
	pendingSessionAtom,
	type AgentSession,
} from "../state/atoms/sessions"
import { vscode } from "../utils/vscode"
import { Plus, Trash2, Loader2, RefreshCw, GitBranch, Folder } from "lucide-react"

export function SessionSidebar() {
	const { t } = useTranslation("agentManager")
	const sessions = useAtomValue(mergedSessionsAtom)
	const pendingSession = useAtomValue(pendingSessionAtom)
	const [selectedId, setSelectedId] = useAtom(selectedSessionIdAtom)
	const isRefreshing = useAtomValue(isRefreshingRemoteSessionsAtom)
	const startRefreshing = useSetAtom(startRefreshingRemoteSessionsAtom)

	const handleNewSession = () => {
		setSelectedId(null)
	}

	const handleSelectSession = (id: string) => {
		setSelectedId(id)
		vscode.postMessage({ type: "agentManager.selectSession", sessionId: id })
	}

	const handleRemoveSession = (id: string, e: React.MouseEvent) => {
		e.stopPropagation()
		vscode.postMessage({ type: "agentManager.removeSession", sessionId: id })
	}

	const handleRefresh = () => {
		if (isRefreshing) return // Prevent multiple clicks while loading
		startRefreshing()
		vscode.postMessage({ type: "agentManager.refreshRemoteSessions" })
	}

	const isNewAgentSelected = selectedId === null && !pendingSession

	return (
		<div className="sidebar">
			<div className="sidebar-header">
				<span>{t("sidebar.title")}</span>
			</div>

			<div
				className={`new-agent-item ${isNewAgentSelected ? "selected" : ""}`}
				onClick={handleNewSession}
				role="button"
				tabIndex={0}
				onKeyDown={(e) => e.key === "Enter" && handleNewSession()}>
				<Plus size={16} />
				<span>{t("sidebar.newAgent")}</span>
			</div>

			<div className="sidebar-section-header">
				<span>{t("sidebar.sessionsSection")}</span>
				<button
					className="icon-btn"
					onClick={handleRefresh}
					disabled={isRefreshing}
					title={t("sidebar.refresh")}>
					{isRefreshing ? <Loader2 size={14} className="spinning" /> : <RefreshCw size={14} />}
				</button>
			</div>

			<div className="session-list">
				{/* Show pending session at the top */}
				{pendingSession && (
					<PendingSessionItem
						pendingSession={pendingSession}
						isSelected={selectedId === null}
						onSelect={() => setSelectedId(null)}
					/>
				)}

				{sessions.length === 0 && !pendingSession ? (
					<div className="no-sessions">
						<p>{t("sidebar.emptyState")}</p>
					</div>
				) : (
					sessions.map((session) => (
						<SessionItem
							key={session.sessionId}
							session={session}
							isSelected={selectedId === session.sessionId}
							onSelect={() => handleSelectSession(session.sessionId)}
							onRemove={(e) => handleRemoveSession(session.sessionId, e)}
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
		<div className={`session-item pending ${isSelected ? "selected" : ""}`} onClick={onSelect}>
			<div className="status-icon creating" title={t("status.creating")}>
				<Loader2 size={14} className="spinning" />
			</div>
			<div className="session-content">
				<div className="session-label">{pendingSession.label}</div>
				<div className="session-meta">{t("status.creating")}</div>
			</div>
		</div>
	)
}

function SessionItem({
	session,
	isSelected,
	onSelect,
	onRemove,
}: {
	session: AgentSession
	isSelected: boolean
	onSelect: () => void
	onRemove: (e: React.MouseEvent) => void
}) {
	const { t } = useTranslation("agentManager")
	// Only show delete for sessions we have local control over (running with a pid)
	const hasLocalProcess = session.source === "local" && session.status === "running" && session.pid !== undefined

	const formatDuration = (start: number, end?: number) => {
		const duration = (end || Date.now()) - start
		const seconds = Math.floor(duration / 1000)
		const minutes = Math.floor(seconds / 60)
		if (minutes > 0) return `${minutes}m`
		return `${seconds}s`
	}

	// Only show spinner for running sessions - all other sessions are resumable/idle
	const isRunning = session.status === "running"
	const isWorktree = session.parallelMode?.enabled
	const branchName = session.parallelMode?.branch
	const isCompleted = session.status === "done"

	return (
		<div className={`session-item ${isSelected ? "selected" : ""}`} onClick={onSelect}>
			{isRunning && (
				<div className="status-icon running" title={t("status.running")}>
					<Loader2 size={14} className="spinning" />
				</div>
			)}
			<div className="session-content">
				<div className="session-label">{session.label}</div>
				<div className="session-meta">
					{formatDuration(session.startTime, session.endTime)}
					{isWorktree && (
						<span className="worktree-indicator" title={branchName || t("sidebar.worktree")}>
							<GitBranch size={10} />
							{branchName ? (
								<span className="branch-name">
									{branchName.length > 20 ? branchName.slice(0, 20) + "..." : branchName}
								</span>
							) : (
								<span>{t("sidebar.worktree")}</span>
							)}
						</span>
					)}
					{!isWorktree && (
						<span className="workspace-indicator" title={t("sidebar.local")}>
							<Folder size={10} />
						</span>
					)}
				</div>
				{isWorktree && isCompleted && <div className="ready-to-merge">{t("sidebar.readyToMerge")}</div>}
			</div>
			{hasLocalProcess && (
				<button className="icon-btn" onClick={onRemove} title={t("sidebar.removeSession")}>
					<Trash2 size={14} />
				</button>
			)}
		</div>
	)
}
