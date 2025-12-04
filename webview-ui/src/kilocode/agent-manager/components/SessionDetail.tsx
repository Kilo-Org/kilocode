import React, { useState, useEffect } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { useTranslation } from "react-i18next"
import {
	selectedSessionAtom,
	selectedSessionIdAtom,
	startSessionFailedCounterAtom,
	pendingSessionAtom,
} from "../state/atoms/sessions"
import { MessageList } from "./MessageList"
import { ChatInput } from "./ChatInput"
import { vscode } from "../utils/vscode"
import { Clock, Plus, Square, Loader2, Zap, SendHorizontal, RefreshCw } from "lucide-react"
import DynamicTextArea from "react-textarea-autosize"
import { cn } from "../../../lib/utils"

export function SessionDetail() {
	const { t } = useTranslation("agentManager")
	const selectedSession = useAtomValue(selectedSessionAtom)
	const pendingSession = useAtomValue(pendingSessionAtom)
	const setSelectedId = useSetAtom(selectedSessionIdAtom)

	// Show pending session view only when no other session is selected
	if (pendingSession && !selectedSession) {
		return <PendingSessionView pendingSession={pendingSession} />
	}

	if (!selectedSession) {
		return <NewAgentForm />
	}

	const handleStop = () => {
		vscode.postMessage({ type: "agentManager.stopSession", sessionId: selectedSession.sessionId })
	}

	const handleNewAgent = () => {
		setSelectedId(null)
	}

	const handleRefresh = () => {
		vscode.postMessage({ type: "agentManager.refreshSessionMessages", sessionId: selectedSession.sessionId })
	}

	const formatDuration = (start: number, end?: number) => {
		const duration = (end || Date.now()) - start
		const seconds = Math.floor(duration / 1000)
		const minutes = Math.floor(seconds / 60)
		if (minutes > 0) return `${minutes}m ${seconds % 60}s`
		return `${seconds}s`
	}

	const isRunning = selectedSession.status === "running"

	return (
		<div className="session-detail">
			<div className="detail-header">
				<div className="header-info">
					<div className="header-title" title={selectedSession.prompt}>
						{selectedSession.label}
					</div>
					<div className="header-meta">
						{isRunning && (
							<div style={{ display: "flex", alignItems: "center", gap: 4 }}>
								<Loader2 size={12} className="spinning" />
								<span>{t("status.running")}</span>
							</div>
						)}
						<div style={{ display: "flex", alignItems: "center", gap: 4 }}>
							<Clock size={12} />
							<span>{formatDuration(selectedSession.startTime, selectedSession.endTime)}</span>
						</div>
					</div>
				</div>

				<div className="header-actions">
					{isRunning && (
						<button
							className="btn btn-danger"
							onClick={handleStop}
							aria-label={t("sessionDetail.stopButtonTitle")}
							title={t("sessionDetail.stopButtonTitle")}>
							<Square size={12} fill="currentColor" /> {t("sessionDetail.stopButton")}
						</button>
					)}
					{!isRunning && (
						<button
							className="icon-btn"
							onClick={handleRefresh}
							aria-label={t("sessionDetail.refreshButtonTitle")}
							title={t("sessionDetail.refreshButtonTitle")}>
							<RefreshCw size={14} />
						</button>
					)}
					<button
						className="btn btn-secondary"
						onClick={handleNewAgent}
						aria-label={t("sessionDetail.newButtonTitle")}
						title={t("sessionDetail.newButtonTitle")}>
						<Plus size={14} /> {t("sessionDetail.newButton")}
					</button>
				</div>
			</div>

			{isRunning && (
				<div className="full-auto-banner">
					<Zap size={14} />
					<span>{t("sessionDetail.autoModeWarning")}</span>
				</div>
			)}

			<MessageList sessionId={selectedSession.sessionId} />

			<ChatInput sessionId={selectedSession.sessionId} disabled={!isRunning} />
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

	return (
		<div className="session-detail">
			<div className="detail-header">
				<div className="header-info">
					<div className="header-title" title={pendingSession.prompt}>
						{pendingSession.label}
					</div>
					<div className="header-meta">
						<div style={{ display: "flex", alignItems: "center", gap: 4 }}>
							<Loader2 size={12} className="spinning" />
							<span>{t("status.creating")}</span>
						</div>
					</div>
				</div>
			</div>

			<div className="center-form">
				<Loader2 size={48} className="spinning" style={{ opacity: 0.5 }} />
				<h2 style={{ marginTop: 16 }}>{t("sessionDetail.creatingSession")}</h2>
				<p>{t("sessionDetail.waitingForCli")}</p>
			</div>
		</div>
	)
}

function NewAgentForm() {
	const { t } = useTranslation("agentManager")
	const [promptText, setPromptText] = useState("")
	const [isStarting, setIsStarting] = useState(false)
	const [isFocused, setIsFocused] = useState(false)
	const startSessionFailedCounter = useAtomValue(startSessionFailedCounterAtom)

	// Reset loading state when session start fails (e.g., no workspace folder)
	useEffect(() => {
		if (startSessionFailedCounter > 0) {
			setIsStarting(false)
		}
	}, [startSessionFailedCounter])

	const trimmedPrompt = promptText.trim()
	const isEmpty = trimmedPrompt.length === 0

	const handleStart = () => {
		if (isEmpty || isStarting) return

		setIsStarting(true)
		vscode.postMessage({ type: "agentManager.startSession", prompt: trimmedPrompt })
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault()
			handleStart()
		}
	}

	return (
		<div className="center-form">
			<h2 id="new-agent-heading">{t("sessionDetail.startNewAgent")}</h2>
			<p id="new-agent-description">{t("sessionDetail.describeTask")}</p>
			<div style={{ width: "100%", maxWidth: "500px" }}>
				<div className="new-agent-input-wrapper">
					<div className="new-agent-input-inner">
						<div className="new-agent-gradient" aria-hidden="true" />
						<DynamicTextArea
							className={cn("new-agent-textarea", isFocused && "focused")}
							placeholder={t("sessionDetail.placeholderTask")}
							value={promptText}
							onChange={(e) => setPromptText(e.target.value)}
							onKeyDown={handleKeyDown}
							onFocus={() => setIsFocused(true)}
							onBlur={() => setIsFocused(false)}
							aria-labelledby="new-agent-heading"
							aria-describedby="new-agent-description"
							disabled={isStarting}
							minRows={3}
							maxRows={15}
						/>

						<div className="new-agent-button-container">
							<button
								className="new-agent-send-btn"
								onClick={handleStart}
								disabled={isEmpty || isStarting}
								aria-label={
									isStarting ? t("sessionDetail.starting") : t("sessionDetail.startAriaLabel")
								}>
								{isStarting ? <Loader2 size={16} className="spinning" /> : <SendHorizontal size={16} />}
							</button>
						</div>
					</div>
				</div>
				<p
					className="keyboard-hint"
					style={{ textAlign: "center", marginTop: 8, opacity: 0.6, fontSize: "12px" }}>
					{t("sessionDetail.keyboardHint")}
				</p>
			</div>
		</div>
	)
}
