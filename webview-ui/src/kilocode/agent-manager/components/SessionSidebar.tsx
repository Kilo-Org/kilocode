import React from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useTranslation } from "react-i18next"
import {
	mergedSessionsAtom,
	selectedSessionIdAtom,
	isRefreshingRemoteSessionsAtom,
	pendingSessionAtom,
	type AgentSession,
} from "../state/atoms/sessions"
import { vscode } from "../utils/vscode"
import { Plus, Loader2, RefreshCw } from "lucide-react"

export function SessionSidebar() {
	const { t } = useTranslation("agentManager")
	const sessions = useAtomValue(mergedSessionsAtom)
	const pendingSession = useAtomValue(pendingSessionAtom)
	const [selectedId, setSelectedId] = useAtom(selectedSessionIdAtom)
	const isRefreshing = useAtomValue(isRefreshingRemoteSessionsAtom)
	const setIsRefreshing = useSetAtom(isRefreshingRemoteSessionsAtom)

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
}: {
	session: AgentSession
	isSelected: boolean
	onSelect: () => void
}) {
	const { t } = useTranslation("agentManager")

	const formatDuration = (start: number, end?: number) => {
		const duration = (end || Date.now()) - start
		const seconds = Math.floor(duration / 1000)
		const minutes = Math.floor(seconds / 60)
		if (minutes > 0) return `${minutes}m`
		return `${seconds}s`
	}

	// Only show spinner for running sessions - all other sessions are resumable/idle
	const isRunning = session.status === "running"

	return (
		<div className={`session-item ${isSelected ? "selected" : ""}`} onClick={onSelect}>
			{isRunning && (
				<div className="status-icon running" title={t("status.running")}>
					<Loader2 size={14} className="spinning" />
				</div>
			)}
			<div className="session-content">
				<div className="session-label">{session.label}</div>
				<div className="session-meta">{formatDuration(session.startTime, session.endTime)}</div>
			</div>
		</div>
	)
}
