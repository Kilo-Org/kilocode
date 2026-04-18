import { Component, createSignal, createEffect, For, Show, onCleanup } from "solid-js"
import { useVSCode } from "../../context/vscode"
import type { ExtensionMessage } from "../../types/messages"

// ─── Types ───────────────────────────────────────────────

type RiskLevel = "low" | "medium" | "high"
type NetworkPolicy = "deny" | "allowlist" | "open"
type WritePolicy = "read_only" | "buffered" | "approved"
type TaskStatus = "queued" | "running" | "completed" | "failed" | "blocked"

interface TaskLimits {
	timeoutSec: number
	memoryMb: number
	cpu: number
}

interface ZeroClawTask {
	taskId: string
	description: string
	projectPath: string
	riskLevel: RiskLevel
	workspaceScope: string[]
	networkPolicy: NetworkPolicy
	writePolicy: WritePolicy
	limits: TaskLimits
	status: TaskStatus
	exitCode?: number
	logs: string[]
	changedFiles: string[]
	artifacts: string[]
	requiresApproval: boolean
	approvedBy?: string
	createdAt: number
	completedAt?: number
	retryCount: number
}

interface ApprovalRecord {
	taskId: string
	approver: string
	action: "approved" | "rejected"
	timestamp: number
	reason?: string
}

// ─── Styles ──────────────────────────────────────────────

const inputStyle = {
	width: "100%",
	padding: "4px 8px",
	border: "1px solid var(--vscode-input-border)",
	background: "var(--vscode-input-background)",
	color: "var(--vscode-input-foreground)",
	"border-radius": "2px",
	"font-size": "13px",
	"box-sizing": "border-box" as const,
}

const selectStyle = {
	...inputStyle,
	cursor: "pointer",
}

const labelStyle = {
	display: "block",
	"font-size": "12px",
	"font-weight": "600",
	"margin-bottom": "4px",
	color: "var(--vscode-foreground)",
}

const fieldGroupStyle = {
	"margin-bottom": "10px",
}

const sectionStyle = {
	"margin-bottom": "16px",
	border: "1px solid var(--vscode-panel-border)",
	"border-radius": "4px",
	overflow: "hidden",
}

const sectionHeaderStyle = (clickable: boolean) => ({
	display: "flex",
	"align-items": "center",
	"justify-content": "space-between",
	padding: "8px 12px",
	cursor: clickable ? "pointer" : "default",
	"user-select": "none" as const,
	"font-weight": "600",
	"font-size": "13px",
	background: "var(--vscode-sideBarSectionHeader-background)",
	color: "var(--vscode-sideBarSectionHeader-foreground)",
})

const sectionBodyStyle = {
	padding: "12px",
}

const btnBase = {
	padding: "4px 12px",
	border: "1px solid var(--vscode-button-border, transparent)",
	"border-radius": "2px",
	"font-size": "12px",
	cursor: "pointer",
}

const btnPrimary = {
	...btnBase,
	background: "var(--vscode-button-background)",
	color: "var(--vscode-button-foreground)",
}

const btnSecondary = {
	...btnBase,
	background: "var(--vscode-button-secondaryBackground)",
	color: "var(--vscode-button-secondaryForeground)",
}

const btnDanger = {
	...btnBase,
	background: "var(--vscode-inputValidation-errorBackground, #5a1d1d)",
	color: "var(--vscode-errorForeground, #f48771)",
}

const btnSuccess = {
	...btnBase,
	background: "var(--vscode-testing-iconPassed, #388a34)",
	color: "#fff",
}

// ─── Helpers ─────────────────────────────────────────────

const STATUS_COLORS: Record<TaskStatus, string> = {
	queued: "var(--vscode-charts-blue, #3794ff)",
	running: "var(--vscode-charts-yellow, #cca700)",
	completed: "var(--vscode-testing-iconPassed, #388a34)",
	failed: "var(--vscode-testing-iconFailed, #f14c4c)",
	blocked: "var(--vscode-charts-orange, #d18616)",
}

const RISK_COLORS: Record<RiskLevel, string> = {
	low: "var(--vscode-testing-iconPassed, #388a34)",
	medium: "var(--vscode-charts-yellow, #cca700)",
	high: "var(--vscode-testing-iconFailed, #f14c4c)",
}

function badgeStyle(color: string): Record<string, string> {
	return {
		display: "inline-block",
		padding: "1px 8px",
		"border-radius": "10px",
		"font-size": "11px",
		"font-weight": "600",
		background: color,
		color: "#fff",
		"text-transform": "uppercase",
		"letter-spacing": "0.5px",
	}
}

function formatElapsed(startMs: number, endMs?: number): string {
	const elapsed = Math.floor(((endMs ?? Date.now()) - startMs) / 1000)
	if (elapsed < 60) return `${elapsed}s`
	const mins = Math.floor(elapsed / 60)
	const secs = elapsed % 60
	return `${mins}m ${secs}s`
}

function formatTimestamp(ms: number): string {
	const d = new Date(ms)
	return d.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	})
}

function riskPathLabel(risk: RiskLevel): string {
	switch (risk) {
		case "low":
			return "Auto-run"
		case "medium":
			return "Buffered Diff Review"
		case "high":
			return "Approval Gate"
	}
}

// ─── Sub-Components ──────────────────────────────────────

const TaskSubmissionForm: Component<{ onSubmit: (task: TaskFormData) => void }> = (props) => {
	const [description, setDescription] = createSignal("")
	const [projectPath, setProjectPath] = createSignal("")
	const [riskLevel, setRiskLevel] = createSignal<RiskLevel>("low")
	const [workspaceScope, setWorkspaceScope] = createSignal("")
	const [networkPolicy, setNetworkPolicy] = createSignal<NetworkPolicy>("deny")
	const [writePolicy, setWritePolicy] = createSignal<WritePolicy>("read_only")
	const [timeoutSec, setTimeoutSec] = createSignal(300)
	const [memoryMb, setMemoryMb] = createSignal(512)
	const [cpuCores, setCpuCores] = createSignal(1)
	const [validationErrors, setValidationErrors] = createSignal<Set<string>>(new Set())

	const validate = (): boolean => {
		const errors = new Set<string>()
		if (!description().trim()) errors.add("description")
		if (!projectPath().trim()) errors.add("projectPath")
		if (timeoutSec() <= 0) errors.add("timeoutSec")
		if (memoryMb() <= 0) errors.add("memoryMb")
		if (cpuCores() <= 0) errors.add("cpuCores")
		setValidationErrors(errors)
		return errors.size === 0
	}

	const handleSubmit = () => {
		if (!validate()) return
		props.onSubmit({
			description: description().trim(),
			projectPath: projectPath().trim(),
			riskLevel: riskLevel(),
			workspaceScope: workspaceScope(),
			networkPolicy: networkPolicy(),
			writePolicy: writePolicy(),
			limits: {
				timeoutSec: timeoutSec(),
				memoryMb: memoryMb(),
				cpu: cpuCores(),
			},
		})
		// Reset form
		setDescription("")
		setValidationErrors(new Set<string>())
	}

	const fieldBorder = (field: string) =>
		validationErrors().has(field)
			? "1px solid var(--vscode-inputValidation-errorBorder, #be1100)"
			: "1px solid var(--vscode-input-border)"

	return (
		<div>
			<div style={fieldGroupStyle}>
				<label style={labelStyle}>
					Task Description <span style={{ color: "var(--vscode-errorForeground)" }}>*</span>
				</label>
				<textarea
					value={description()}
					onInput={(e) => setDescription(e.currentTarget.value)}
					placeholder="Describe the task to execute..."
					rows={3}
					style={{
						...inputStyle,
						resize: "vertical",
						"font-family": "inherit",
						border: fieldBorder("description"),
					}}
				/>
				<Show when={validationErrors().has("description")}>
					<div style={{ color: "var(--vscode-errorForeground)", "font-size": "11px", "margin-top": "2px" }}>
						Task description is required
					</div>
				</Show>
			</div>

			<div style={fieldGroupStyle}>
				<label style={labelStyle}>
					Project Path <span style={{ color: "var(--vscode-errorForeground)" }}>*</span>
				</label>
				<input
					type="text"
					value={projectPath()}
					onInput={(e) => setProjectPath(e.currentTarget.value)}
					placeholder="/path/to/project"
					style={{ ...inputStyle, border: fieldBorder("projectPath") }}
				/>
				<Show when={validationErrors().has("projectPath")}>
					<div style={{ color: "var(--vscode-errorForeground)", "font-size": "11px", "margin-top": "2px" }}>
						Project path is required
					</div>
				</Show>
			</div>

			<div style={{ display: "grid", "grid-template-columns": "1fr 1fr 1fr", gap: "10px", "margin-bottom": "10px" }}>
				<div>
					<label style={labelStyle}>Risk Level</label>
					<select
						value={riskLevel()}
						onChange={(e) => setRiskLevel(e.currentTarget.value as RiskLevel)}
						style={selectStyle}
					>
						<option value="low">Low</option>
						<option value="medium">Medium</option>
						<option value="high">High</option>
					</select>
				</div>
				<div>
					<label style={labelStyle}>Network Policy</label>
					<select
						value={networkPolicy()}
						onChange={(e) => setNetworkPolicy(e.currentTarget.value as NetworkPolicy)}
						style={selectStyle}
					>
						<option value="deny">Deny</option>
						<option value="allowlist">Allowlist</option>
						<option value="open">Open</option>
					</select>
				</div>
				<div>
					<label style={labelStyle}>Write Policy</label>
					<select
						value={writePolicy()}
						onChange={(e) => setWritePolicy(e.currentTarget.value as WritePolicy)}
						style={selectStyle}
					>
						<option value="read_only">Read Only</option>
						<option value="buffered">Buffered</option>
						<option value="approved">Approved</option>
					</select>
				</div>
			</div>

			<div style={fieldGroupStyle}>
				<label style={labelStyle}>Workspace Scope</label>
				<input
					type="text"
					value={workspaceScope()}
					onInput={(e) => setWorkspaceScope(e.currentTarget.value)}
					placeholder="Comma-separated paths or globs, e.g. src/**, tests/**"
					style={inputStyle}
				/>
				<div style={{ color: "var(--vscode-descriptionForeground)", "font-size": "11px", "margin-top": "2px" }}>
					Leave empty to use the full workspace
				</div>
			</div>

			<div style={{ display: "grid", "grid-template-columns": "1fr 1fr 1fr", gap: "10px", "margin-bottom": "10px" }}>
				<div>
					<label style={labelStyle}>Timeout (sec)</label>
					<input
						type="number"
						value={timeoutSec()}
						onInput={(e) => setTimeoutSec(parseInt(e.currentTarget.value) || 0)}
						min={1}
						style={{ ...inputStyle, border: fieldBorder("timeoutSec") }}
					/>
				</div>
				<div>
					<label style={labelStyle}>Memory (MB)</label>
					<input
						type="number"
						value={memoryMb()}
						onInput={(e) => setMemoryMb(parseInt(e.currentTarget.value) || 0)}
						min={1}
						style={{ ...inputStyle, border: fieldBorder("memoryMb") }}
					/>
				</div>
				<div>
					<label style={labelStyle}>CPU Cores</label>
					<input
						type="number"
						value={cpuCores()}
						onInput={(e) => setCpuCores(parseFloat(e.currentTarget.value) || 0)}
						min={0.25}
						step={0.25}
						style={{ ...inputStyle, border: fieldBorder("cpuCores") }}
					/>
				</div>
			</div>

			{/* Risk path preview */}
			<div
				style={{
					display: "flex",
					"align-items": "center",
					gap: "8px",
					padding: "6px 10px",
					"margin-bottom": "10px",
					"border-radius": "4px",
					background: "var(--vscode-textBlockQuote-background)",
					"font-size": "12px",
				}}
			>
				<span style={{ "font-weight": "600" }}>Execution path:</span>
				<span style={badgeStyle(RISK_COLORS[riskLevel()])}>{riskLevel()}</span>
				<span style={{ color: "var(--vscode-descriptionForeground)" }}>{riskPathLabel(riskLevel())}</span>
			</div>

			<button style={btnPrimary} onClick={handleSubmit}>
				Submit Task
			</button>
		</div>
	)
}

interface TaskFormData {
	description: string
	projectPath: string
	riskLevel: RiskLevel
	workspaceScope: string
	networkPolicy: NetworkPolicy
	writePolicy: WritePolicy
	limits: TaskLimits
}

const TaskCard: Component<{
	task: ZeroClawTask
	expanded: boolean
	onToggle: () => void
	onCancel: (id: string) => void
	onRetry: (id: string) => void
	onApprove: (id: string, approver: string) => void
	onReject: (id: string) => void
}> = (props) => {
	const [approver, setApprover] = createSignal("")

	return (
		<div
			style={{
				border: "1px solid var(--vscode-panel-border)",
				"border-radius": "4px",
				"margin-bottom": "8px",
				overflow: "hidden",
			}}
		>
			{/* Header row */}
			<div
				style={{
					display: "flex",
					"align-items": "center",
					gap: "8px",
					padding: "8px 12px",
					cursor: "pointer",
					"user-select": "none",
					background: "var(--vscode-sideBarSectionHeader-background)",
				}}
				onClick={props.onToggle}
			>
				<span
					style={{
						"font-family": "monospace",
						"font-size": "11px",
						color: "var(--vscode-descriptionForeground)",
						"min-width": "90px",
					}}
				>
					{props.task.taskId}
				</span>
				<span style={badgeStyle(STATUS_COLORS[props.task.status])}>{props.task.status}</span>
				<span style={badgeStyle(RISK_COLORS[props.task.riskLevel])}>{props.task.riskLevel}</span>
				<span
					style={{
						flex: "1",
						"font-size": "12px",
						overflow: "hidden",
						"text-overflow": "ellipsis",
						"white-space": "nowrap",
					}}
				>
					{props.task.description}
				</span>
				<span style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "white-space": "nowrap" }}>
					{formatElapsed(props.task.createdAt, props.task.completedAt)}
				</span>
				<span
					style={{
						"font-size": "14px",
						transition: "transform 0.15s",
						transform: props.expanded ? "rotate(90deg)" : "rotate(0deg)",
					}}
				>
					{"\u25B6"}
				</span>
			</div>

			{/* Expanded details */}
			<Show when={props.expanded}>
				<div style={{ padding: "10px 12px", "border-top": "1px solid var(--vscode-panel-border)" }}>
					{/* Risk path indicator */}
					<div
						style={{
							display: "flex",
							"align-items": "center",
							gap: "6px",
							"margin-bottom": "10px",
							"font-size": "12px",
						}}
					>
						<span style={{ "font-weight": "600" }}>Execution path:</span>
						<span
							style={{
								display: "inline-flex",
								"align-items": "center",
								gap: "4px",
							}}
						>
							<span
								style={{
									width: "8px",
									height: "8px",
									"border-radius": "50%",
									background: RISK_COLORS[props.task.riskLevel],
									display: "inline-block",
								}}
							/>
							{riskPathLabel(props.task.riskLevel)}
						</span>
						<Show when={props.task.approvedBy}>
							<span style={{ color: "var(--vscode-descriptionForeground)" }}>
								(approved by {props.task.approvedBy})
							</span>
						</Show>
					</div>

					{/* Task metadata */}
					<div
						style={{
							display: "grid",
							"grid-template-columns": "1fr 1fr",
							gap: "4px 16px",
							"font-size": "12px",
							"margin-bottom": "10px",
							color: "var(--vscode-descriptionForeground)",
						}}
					>
						<div>
							<strong>Project:</strong> {props.task.projectPath}
						</div>
						<div>
							<strong>Network:</strong> {props.task.networkPolicy}
						</div>
						<div>
							<strong>Write:</strong> {props.task.writePolicy}
						</div>
						<div>
							<strong>Scope:</strong> {props.task.workspaceScope.join(", ") || "(workspace)"}
						</div>
						<div>
							<strong>Timeout:</strong> {props.task.limits.timeoutSec}s
						</div>
						<div>
							<strong>Memory:</strong> {props.task.limits.memoryMb}MB / CPU: {props.task.limits.cpu}
						</div>
					</div>

					{/* Logs */}
					<Show when={props.task.logs.length > 0}>
						<div style={{ "margin-bottom": "8px" }}>
							<div style={{ "font-size": "12px", "font-weight": "600", "margin-bottom": "4px" }}>Logs</div>
							<div
								style={{
									"max-height": "200px",
									"overflow-y": "auto",
									padding: "6px 8px",
									background: "var(--vscode-terminal-background, var(--vscode-editor-background))",
									border: "1px solid var(--vscode-panel-border)",
									"border-radius": "2px",
									"font-family": "var(--vscode-editor-font-family, monospace)",
									"font-size": "11px",
									"line-height": "1.5",
									"white-space": "pre-wrap",
									"word-break": "break-all",
								}}
							>
								<For each={props.task.logs}>{(line) => <div>{line}</div>}</For>
							</div>
						</div>
					</Show>

					{/* Changed files */}
					<Show when={props.task.changedFiles.length > 0}>
						<div style={{ "margin-bottom": "8px" }}>
							<div style={{ "font-size": "12px", "font-weight": "600", "margin-bottom": "4px" }}>
								Changed Files ({props.task.changedFiles.length})
							</div>
							<div
								style={{
									padding: "4px 8px",
									background: "var(--vscode-textBlockQuote-background)",
									"border-radius": "2px",
									"font-size": "12px",
									"font-family": "var(--vscode-editor-font-family, monospace)",
								}}
							>
								<For each={props.task.changedFiles}>
									{(file) => (
										<div style={{ padding: "1px 0" }}>
											{file}
										</div>
									)}
								</For>
							</div>
						</div>
					</Show>

					{/* Artifacts */}
					<Show when={props.task.artifacts.length > 0}>
						<div style={{ "margin-bottom": "8px" }}>
							<div style={{ "font-size": "12px", "font-weight": "600", "margin-bottom": "4px" }}>
								Artifacts ({props.task.artifacts.length})
							</div>
							<div
								style={{
									padding: "4px 8px",
									background: "var(--vscode-textBlockQuote-background)",
									"border-radius": "2px",
									"font-size": "12px",
								}}
							>
								<For each={props.task.artifacts}>
									{(artifact) => (
										<div style={{ padding: "1px 0" }}>
											{artifact}
										</div>
									)}
								</For>
							</div>
						</div>
					</Show>

					{/* Medium-risk diff review UI */}
					<Show when={props.task.riskLevel === "medium" && props.task.status === "blocked" && props.task.requiresApproval}>
						<div
							style={{
								padding: "8px",
								border: "1px solid var(--vscode-charts-yellow, #cca700)",
								"border-radius": "4px",
								"margin-bottom": "8px",
								background: "var(--vscode-textBlockQuote-background)",
							}}
						>
							<div style={{ "font-size": "12px", "font-weight": "600", "margin-bottom": "6px", color: "var(--vscode-charts-yellow, #cca700)" }}>
								Buffered Changes -- Diff Review Required
							</div>
							<div style={{ "font-size": "12px", "margin-bottom": "8px", color: "var(--vscode-descriptionForeground)" }}>
								This medium-risk task has completed execution with buffered writes. Review the changes before applying.
							</div>
							<div style={{ display: "flex", gap: "8px" }}>
								<button
									style={btnSuccess}
									onClick={() => props.onApprove(props.task.taskId, "diff-reviewer")}
								>
									Approve Changes
								</button>
								<button style={btnDanger} onClick={() => props.onReject(props.task.taskId)}>
									Reject Changes
								</button>
							</div>
						</div>
					</Show>

					{/* High-risk approval gate UI */}
					<Show when={props.task.riskLevel === "high" && props.task.status === "blocked" && props.task.requiresApproval}>
						<div
							style={{
								padding: "8px",
								border: "1px solid var(--vscode-testing-iconFailed, #f14c4c)",
								"border-radius": "4px",
								"margin-bottom": "8px",
								background: "var(--vscode-textBlockQuote-background)",
							}}
						>
							<div style={{ "font-size": "12px", "font-weight": "600", "margin-bottom": "6px", color: "var(--vscode-testing-iconFailed, #f14c4c)" }}>
								High-Risk Task -- Approval Required
							</div>
							<div style={{ "font-size": "12px", "margin-bottom": "8px", color: "var(--vscode-descriptionForeground)" }}>
								This task has been flagged as high-risk and requires explicit approval before execution.
							</div>
							<div style={{ "margin-bottom": "8px" }}>
								<label style={{ ...labelStyle, "font-size": "11px" }}>Approver</label>
								<input
									type="text"
									value={approver()}
									onInput={(e) => setApprover(e.currentTarget.value)}
									placeholder="Enter approver name or email"
									style={inputStyle}
								/>
							</div>
							<div style={{ display: "flex", gap: "8px" }}>
								<button
									style={{
										...btnSuccess,
										opacity: approver().trim() ? "1" : "0.5",
										cursor: approver().trim() ? "pointer" : "not-allowed",
									}}
									disabled={!approver().trim()}
									onClick={() => {
										if (approver().trim()) {
											props.onApprove(props.task.taskId, approver().trim())
											setApprover("")
										}
									}}
								>
									Approve Execution
								</button>
								<button style={btnDanger} onClick={() => props.onReject(props.task.taskId)}>
									Reject
								</button>
							</div>
						</div>
					</Show>

					{/* Action buttons */}
					<div style={{ display: "flex", gap: "8px", "margin-top": "8px" }}>
						<Show when={props.task.status === "running" || props.task.status === "queued"}>
							<button style={btnDanger} onClick={() => props.onCancel(props.task.taskId)}>
								Cancel
							</button>
						</Show>
						<Show when={props.task.status === "failed"}>
							<button style={btnSecondary} onClick={() => props.onRetry(props.task.taskId)}>
								Retry
							</button>
						</Show>
					</div>
				</div>
			</Show>
		</div>
	)
}

const ApprovalHistoryPanel: Component<{ history: ApprovalRecord[] }> = (props) => (
	<Show when={props.history.length > 0}>
		<div style={{ "margin-top": "12px" }}>
			<div style={{ "font-size": "12px", "font-weight": "600", "margin-bottom": "6px" }}>Approval History</div>
			<div
				style={{
					"max-height": "160px",
					"overflow-y": "auto",
					border: "1px solid var(--vscode-panel-border)",
					"border-radius": "2px",
				}}
			>
				<For each={props.history}>
					{(record) => (
						<div
							style={{
								display: "flex",
								"align-items": "center",
								gap: "8px",
								padding: "4px 8px",
								"font-size": "12px",
								"border-bottom": "1px solid var(--vscode-panel-border)",
							}}
						>
							<span style={{ "font-family": "monospace", "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
								{record.taskId}
							</span>
							<span
								style={badgeStyle(
									record.action === "approved"
										? "var(--vscode-testing-iconPassed, #388a34)"
										: "var(--vscode-testing-iconFailed, #f14c4c)"
								)}
							>
								{record.action}
							</span>
							<span style={{ color: "var(--vscode-descriptionForeground)" }}>by {record.approver}</span>
							<span style={{ flex: "1" }} />
							<span style={{ color: "var(--vscode-descriptionForeground)", "font-size": "11px" }}>
								{formatTimestamp(record.timestamp)}
							</span>
						</div>
					)}
				</For>
			</div>
		</div>
	</Show>
)

const TimelineEntry: Component<{
	task: ZeroClawTask
	expanded: boolean
	onToggle: () => void
}> = (props) => (
	<div
		style={{
			"border-bottom": "1px solid var(--vscode-panel-border)",
		}}
	>
		<div
			style={{
				display: "flex",
				"align-items": "center",
				gap: "8px",
				padding: "6px 8px",
				cursor: "pointer",
				"user-select": "none",
				"font-size": "12px",
			}}
			onClick={props.onToggle}
		>
			<span style={{ color: "var(--vscode-descriptionForeground)", "font-size": "11px", "min-width": "140px" }}>
				{formatTimestamp(props.task.createdAt)}
			</span>
			<span style={badgeStyle(STATUS_COLORS[props.task.status])}>{props.task.status}</span>
			<span style={badgeStyle(RISK_COLORS[props.task.riskLevel])}>{props.task.riskLevel}</span>
			<span
				style={{
					flex: "1",
					overflow: "hidden",
					"text-overflow": "ellipsis",
					"white-space": "nowrap",
				}}
			>
				{props.task.description}
			</span>
			<span style={{ color: "var(--vscode-descriptionForeground)", "font-size": "11px", "white-space": "nowrap" }}>
				{formatElapsed(props.task.createdAt, props.task.completedAt)}
			</span>
			<span
				style={{
					"font-size": "12px",
					transition: "transform 0.15s",
					transform: props.expanded ? "rotate(90deg)" : "rotate(0deg)",
				}}
			>
				{"\u25B6"}
			</span>
		</div>
		<Show when={props.expanded}>
			<div
				style={{
					padding: "6px 8px 8px 8px",
					background: "var(--vscode-textBlockQuote-background)",
					"font-size": "12px",
				}}
			>
				<div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "2px 16px", color: "var(--vscode-descriptionForeground)" }}>
					<div><strong>Task ID:</strong> {props.task.taskId}</div>
					<div><strong>Project:</strong> {props.task.projectPath}</div>
					<div><strong>Network:</strong> {props.task.networkPolicy}</div>
					<div><strong>Write:</strong> {props.task.writePolicy}</div>
					<div><strong>Scope:</strong> {props.task.workspaceScope.join(", ") || "(workspace)"}</div>
					<div>
						<strong>Limits:</strong> {props.task.limits.timeoutSec}s / {props.task.limits.memoryMb}MB / {props.task.limits.cpu} CPU
					</div>
					<Show when={props.task.approvedBy}>
						<div><strong>Approved by:</strong> {props.task.approvedBy}</div>
					</Show>
					<Show when={props.task.exitCode !== undefined}>
						<div><strong>Exit code:</strong> {props.task.exitCode}</div>
					</Show>
				</div>
				<Show when={props.task.changedFiles.length > 0}>
					<div style={{ "margin-top": "4px" }}>
						<strong>Changed files:</strong> {props.task.changedFiles.join(", ")}
					</div>
				</Show>
				<Show when={props.task.logs.length > 0}>
					<div
						style={{
							"margin-top": "6px",
							"max-height": "120px",
							"overflow-y": "auto",
							padding: "4px 6px",
							background: "var(--vscode-terminal-background, var(--vscode-editor-background))",
							"border-radius": "2px",
							"font-family": "var(--vscode-editor-font-family, monospace)",
							"font-size": "11px",
							"line-height": "1.4",
							"white-space": "pre-wrap",
							"word-break": "break-all",
						}}
					>
						<For each={props.task.logs}>{(line) => <div>{line}</div>}</For>
					</div>
				</Show>
			</div>
		</Show>
	</div>
)

// ─── Main Component ──────────────────────────────────────

const ZeroClawTab: Component = () => {
	const vscode = useVSCode()

	// State
	const [tasks, setTasks] = createSignal<ZeroClawTask[]>([])
	const [approvalHistory, setApprovalHistory] = createSignal<ApprovalRecord[]>([])
	const [expandedTasks, setExpandedTasks] = createSignal<Set<string>>(new Set())
	const [expandedTimeline, setExpandedTimeline] = createSignal<Set<string>>(new Set())

	// Section collapse
	const [submitOpen, setSubmitOpen] = createSignal(true)
	const [executionsOpen, setExecutionsOpen] = createSignal(true)
	const [timelineOpen, setTimelineOpen] = createSignal(false)

	// Derived
	const activeTasks = () => tasks().filter((t) => t.status === "queued" || t.status === "running" || t.status === "blocked")
	const timelineTasks = () => tasks().slice(0, 50)

	// Elapsed time ticker -- update running task displays every second
	const [tick, setTick] = createSignal(0)
	const tickInterval = setInterval(() => setTick((t) => t + 1), 1000)
	onCleanup(() => clearInterval(tickInterval))

	// Force reactivity on tick for running tasks
	createEffect(() => {
		// Touch tick so this effect re-runs every second
		tick()
		// No-op: the reactive read of tick() causes TaskCard components
		// that reference formatElapsed with Date.now() to re-render.
	})

	// Message handling
	const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
		const msg = message as ExtensionMessage & {
			type: string
			tasks?: ZeroClawTask[]
			task?: ZeroClawTask
			taskId?: string
			success?: boolean
			newTask?: ZeroClawTask
		}

		switch (msg.type) {
			case "zeroClawTasksLoaded": {
				if (msg.tasks) setTasks(msg.tasks)
				break
			}
			case "zeroClawTaskUpdated": {
				if (msg.task) {
					setTasks((prev) => {
						const idx = prev.findIndex((t) => t.taskId === msg.task!.taskId)
						if (idx >= 0) {
							const next = [...prev]
							next[idx] = msg.task!
							return next
						}
						return [msg.task!, ...prev]
					})
				}
				break
			}
			case "zeroClawTaskSubmitted": {
				if (msg.task) {
					setTasks((prev) => [msg.task!, ...prev])
				}
				break
			}
			case "zeroClawTaskRetried": {
				if (msg.newTask) {
					setTasks((prev) => [msg.newTask!, ...prev])
				}
				break
			}
			case "zeroClawHistoryLoaded": {
				if (msg.tasks) setTasks(msg.tasks)
				break
			}
			case "zeroClawError": {
				const errMsg = (msg as unknown as { error: string }).error
				console.error("[ZeroClaw]", errMsg)
				break
			}
		}
	})

	onCleanup(() => unsubscribe())

	// Request initial data
	vscode.postMessage({ type: "zeroClawGetHistory" } as any)

	// Actions
	const handleSubmit = (formData: TaskFormData) => {
		vscode.postMessage({
			type: "zeroClawSubmitTask",
			...formData,
		} as any)
	}

	const handleCancel = (taskId: string) => {
		vscode.postMessage({ type: "zeroClawCancelTask", taskId } as any)
	}

	const handleRetry = (taskId: string) => {
		vscode.postMessage({ type: "zeroClawRetryTask", taskId } as any)
	}

	const handleApprove = (taskId: string, approverName: string) => {
		vscode.postMessage({
			type: "zeroClawApproveTask",
			taskId,
			approver: approverName,
		} as any)
		setApprovalHistory((prev) => [
			{
				taskId,
				approver: approverName,
				action: "approved",
				timestamp: Date.now(),
			},
			...prev,
		])
	}

	const handleReject = (taskId: string) => {
		vscode.postMessage({ type: "zeroClawRejectTask", taskId } as any)
		setApprovalHistory((prev) => [
			{
				taskId,
				approver: "local-user",
				action: "rejected",
				timestamp: Date.now(),
			},
			...prev,
		])
	}

	const toggleTaskExpanded = (taskId: string) => {
		setExpandedTasks((prev) => {
			const next = new Set(prev)
			if (next.has(taskId)) next.delete(taskId)
			else next.add(taskId)
			return next
		})
	}

	const toggleTimelineExpanded = (taskId: string) => {
		setExpandedTimeline((prev) => {
			const next = new Set(prev)
			if (next.has(taskId)) next.delete(taskId)
			else next.add(taskId)
			return next
		})
	}

	return (
		<div style={{ padding: "0 4px" }}>
			{/* ─── Task Submission ─────────────────────────── */}
			<div style={sectionStyle}>
				<div style={sectionHeaderStyle(true)} onClick={() => setSubmitOpen((v) => !v)}>
					<span>Submit Task</span>
					<span style={{ "font-size": "14px", transform: submitOpen() ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>
						{"\u25B6"}
					</span>
				</div>
				<Show when={submitOpen()}>
					<div style={sectionBodyStyle}>
						<TaskSubmissionForm onSubmit={handleSubmit} />
					</div>
				</Show>
			</div>

			{/* ─── Active Executions ──────────────────────── */}
			<div style={sectionStyle}>
				<div style={sectionHeaderStyle(true)} onClick={() => setExecutionsOpen((v) => !v)}>
					<span>
						Active Executions
						<Show when={activeTasks().length > 0}>
							<span
								style={{
									"margin-left": "8px",
									padding: "0 6px",
									"border-radius": "8px",
									"font-size": "11px",
									"font-weight": "400",
									background: "var(--vscode-badge-background)",
									color: "var(--vscode-badge-foreground)",
								}}
							>
								{activeTasks().length}
							</span>
						</Show>
					</span>
					<span style={{ "font-size": "14px", transform: executionsOpen() ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>
						{"\u25B6"}
					</span>
				</div>
				<Show when={executionsOpen()}>
					<div style={sectionBodyStyle}>
						<Show
							when={tasks().length > 0}
							fallback={
								<div
									style={{
										padding: "16px",
										"text-align": "center",
										color: "var(--vscode-descriptionForeground)",
										"font-size": "13px",
									}}
								>
									No tasks submitted yet. Use the form above to submit a task.
								</div>
							}
						>
							{/* Status summary bar */}
							<div
								style={{
									display: "flex",
									gap: "12px",
									"margin-bottom": "10px",
									"font-size": "12px",
									color: "var(--vscode-descriptionForeground)",
								}}
							>
								<span>
									<span style={{ color: STATUS_COLORS.running, "font-weight": "600" }}>
										{tasks().filter((t) => t.status === "running").length}
									</span>{" "}
									running
								</span>
								<span>
									<span style={{ color: STATUS_COLORS.queued, "font-weight": "600" }}>
										{tasks().filter((t) => t.status === "queued").length}
									</span>{" "}
									queued
								</span>
								<span>
									<span style={{ color: STATUS_COLORS.blocked, "font-weight": "600" }}>
										{tasks().filter((t) => t.status === "blocked").length}
									</span>{" "}
									blocked
								</span>
								<span>
									<span style={{ color: STATUS_COLORS.completed, "font-weight": "600" }}>
										{tasks().filter((t) => t.status === "completed").length}
									</span>{" "}
									completed
								</span>
								<span>
									<span style={{ color: STATUS_COLORS.failed, "font-weight": "600" }}>
										{tasks().filter((t) => t.status === "failed").length}
									</span>{" "}
									failed
								</span>
							</div>

							{/* Risk path legend */}
							<div
								style={{
									display: "flex",
									gap: "16px",
									"margin-bottom": "10px",
									padding: "6px 10px",
									background: "var(--vscode-textBlockQuote-background)",
									"border-radius": "4px",
									"font-size": "11px",
									color: "var(--vscode-descriptionForeground)",
								}}
							>
								<span style={{ display: "flex", "align-items": "center", gap: "4px" }}>
									<span style={{ width: "8px", height: "8px", "border-radius": "50%", background: RISK_COLORS.low, display: "inline-block" }} />
									Low: Auto-run
								</span>
								<span style={{ display: "flex", "align-items": "center", gap: "4px" }}>
									<span style={{ width: "8px", height: "8px", "border-radius": "50%", background: RISK_COLORS.medium, display: "inline-block" }} />
									Medium: Buffered diff
								</span>
								<span style={{ display: "flex", "align-items": "center", gap: "4px" }}>
									<span style={{ width: "8px", height: "8px", "border-radius": "50%", background: RISK_COLORS.high, display: "inline-block" }} />
									High: Approval gate
								</span>
							</div>

							{/* Task cards */}
							<For each={tasks()}>
								{(task) => (
									<TaskCard
										task={task}
										expanded={expandedTasks().has(task.taskId)}
										onToggle={() => toggleTaskExpanded(task.taskId)}
										onCancel={handleCancel}
										onRetry={handleRetry}
										onApprove={handleApprove}
										onReject={handleReject}
									/>
								)}
							</For>

							{/* Approval history */}
							<ApprovalHistoryPanel history={approvalHistory()} />
						</Show>
					</div>
				</Show>
			</div>

			{/* ─── Execution Timeline ─────────────────────── */}
			<div style={sectionStyle}>
				<div style={sectionHeaderStyle(true)} onClick={() => setTimelineOpen((v) => !v)}>
					<span>
						Execution Timeline
						<Show when={timelineTasks().length > 0}>
							<span
								style={{
									"margin-left": "8px",
									padding: "0 6px",
									"border-radius": "8px",
									"font-size": "11px",
									"font-weight": "400",
									background: "var(--vscode-badge-background)",
									color: "var(--vscode-badge-foreground)",
								}}
							>
								{timelineTasks().length}
							</span>
						</Show>
					</span>
					<span style={{ "font-size": "14px", transform: timelineOpen() ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>
						{"\u25B6"}
					</span>
				</div>
				<Show when={timelineOpen()}>
					<div style={{ "max-height": "400px", "overflow-y": "auto" }}>
						<Show
							when={timelineTasks().length > 0}
							fallback={
								<div
									style={{
										padding: "16px",
										"text-align": "center",
										color: "var(--vscode-descriptionForeground)",
										"font-size": "13px",
									}}
								>
									No execution history available.
								</div>
							}
						>
							<For each={timelineTasks()}>
								{(task) => (
									<TimelineEntry
										task={task}
										expanded={expandedTimeline().has(task.taskId)}
										onToggle={() => toggleTimelineExpanded(task.taskId)}
									/>
								)}
							</For>
						</Show>
					</div>
				</Show>
			</div>
		</div>
	)
}

export default ZeroClawTab
