import React from "react"
import { useAtom, useAtomValue } from "jotai"
import { useTranslation } from "react-i18next"
import { sessionsArrayAtom, selectedSessionIdAtom, type AgentSession } from "../state/atoms/sessions"
import { vscode } from "../utils/vscode"
import { Plus, Trash2, SquareTerminal, Loader2 } from "lucide-react"

export function SessionSidebar() {
	const { t } = useTranslation("agentManager")
	const sessions = useAtomValue(sessionsArrayAtom)
	const [selectedId, setSelectedId] = useAtom(selectedSessionIdAtom)

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

	const isNewAgentSelected = selectedId === null

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

			<div className="sidebar-section-header">{t("sidebar.sessionsSection")}</div>

			<div className="session-list">
				{sessions.length === 0 ? (
					<div className="no-sessions">
						<p>{t("sidebar.emptyState")}</p>
					</div>
				) : (
					sessions.map((session) => (
						<SessionItem
							key={session.id}
							session={session}
							isSelected={selectedId === session.id}
							onSelect={() => handleSelectSession(session.id)}
							onRemove={(e) => handleRemoveSession(session.id, e)}
						/>
					))
				)}
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

	const formatDuration = (start: number, end?: number) => {
		const duration = (end || Date.now()) - start
		const seconds = Math.floor(duration / 1000)
		const minutes = Math.floor(seconds / 60)
		if (minutes > 0) return `${minutes}m`
		return `${seconds}s`
	}

	return (
		<div className={`session-item ${isSelected ? "selected" : ""}`} onClick={onSelect}>
			<div className={`status-icon ${session.status}`} title={t(`status.${session.status}`)}>
				{session.status === "running" ? (
					<Loader2 size={14} className="spinning" />
				) : session.status === "done" ? (
					<span className="codicon codicon-pass" />
				) : (
					<SquareTerminal size={14} />
				)}
			</div>
			<div className="session-content">
				<div className="session-label">{session.label}</div>
				<div className="session-meta">{formatDuration(session.startTime, session.endTime)}</div>
			</div>
			<button className="icon-btn" onClick={onRemove} title={t("sidebar.removeSession")}>
				<Trash2 size={14} />
			</button>
		</div>
	)
}
