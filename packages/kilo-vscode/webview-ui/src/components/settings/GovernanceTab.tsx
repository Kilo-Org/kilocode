import { Component, createSignal, createEffect, For, Show, onCleanup } from "solid-js"
import { useVSCode } from "../../context/vscode"

// ─── Types ───────────────────────────────────────────────

interface AuthorityTier {
	level: number
	name: "observer" | "operator" | "admin" | "superadmin"
	permissions: string[]
}

interface TierAssignment {
	user: string
	tier: AuthorityTier["name"]
	assignedAt: number
	assignedBy: string
}

interface ApprovalRecord {
	id: string
	actionId: string
	actionDescription: string
	actor: string
	riskScore: number
	riskLevel: "low" | "medium" | "high" | "critical"
	status: "pending" | "approved" | "rejected"
	approvedBy?: string
	reason?: string
	timestamp: number
	resolvedAt?: number
}

interface DangerousAction {
	id: string
	name: string
	description: string
	minimumTier: AuthorityTier["name"]
	requiresApproval: boolean
	blocked: boolean
}

interface AuditEntry {
	id: string
	timestamp: number
	actor: string
	action: string
	riskLevel: "low" | "medium" | "high" | "critical"
	result: "approved" | "denied" | "auto" | "blocked"
	details: string
}

interface ReleaseVerdict {
	id: string
	scope: string
	criticalDefects: number
	highDefects: number
	riskSummary: string
	rollbackPlan: string
	decision: "pass" | "conditional_pass" | "fail"
	timestamp: number
}

interface RiskThresholds {
	low: { min: number; max: number }
	medium: { min: number; max: number }
	high: { min: number; max: number }
	critical: { min: number; max: number }
}

interface GovernanceState {
	tiers: AuthorityTier[]
	tierAssignments: TierAssignment[]
	riskThresholds: RiskThresholds
	pendingApprovals: ApprovalRecord[]
	resolvedApprovals: ApprovalRecord[]
	dangerousActions: DangerousAction[]
	auditLog: AuditEntry[]
	releaseVerdicts: ReleaseVerdict[]
	checklist?: Array<{ label: string; passed: boolean }>
	releaseReadiness?: "pass" | "conditional_pass" | "fail"
	rollbackReady?: boolean
}

// ─── Styles ──────────────────────────────────────────────

const inputStyle: Record<string, string> = {
	width: "100%",
	padding: "4px 8px",
	border: "1px solid var(--vscode-input-border)",
	background: "var(--vscode-input-background)",
	color: "var(--vscode-input-foreground)",
	"border-radius": "2px",
	"font-size": "13px",
	"box-sizing": "border-box",
}

const buttonStyle: Record<string, string> = {
	padding: "4px 12px",
	border: "1px solid var(--vscode-button-border, transparent)",
	background: "var(--vscode-button-background)",
	color: "var(--vscode-button-foreground)",
	"border-radius": "2px",
	"font-size": "12px",
	cursor: "pointer",
}

const secondaryButtonStyle: Record<string, string> = {
	...buttonStyle,
	background: "var(--vscode-button-secondaryBackground)",
	color: "var(--vscode-button-secondaryForeground)",
}

const dangerButtonStyle: Record<string, string> = {
	...buttonStyle,
	background: "var(--vscode-inputValidation-errorBackground, #5a1d1d)",
	color: "var(--vscode-errorForeground, #f48771)",
}

const cardStyle: Record<string, string> = {
	border: "1px solid var(--vscode-panel-border)",
	"border-radius": "4px",
	background: "var(--vscode-editor-background)",
	"margin-bottom": "12px",
	overflow: "hidden",
}

const sectionHeaderStyle: Record<string, string> = {
	display: "flex",
	"align-items": "center",
	"justify-content": "space-between",
	padding: "10px 12px",
	cursor: "pointer",
	"user-select": "none",
	"font-weight": "600",
	"font-size": "13px",
	background: "var(--vscode-sideBarSectionHeader-background)",
	color: "var(--vscode-sideBarSectionHeader-foreground)",
	"border-bottom": "1px solid var(--vscode-panel-border)",
}

const sectionBodyStyle: Record<string, string> = {
	padding: "12px",
}

const rowStyle: Record<string, string> = {
	display: "flex",
	"align-items": "center",
	"justify-content": "space-between",
	padding: "6px 0",
	"border-bottom": "1px solid var(--vscode-panel-border)",
	"font-size": "12px",
}

const labelStyle: Record<string, string> = {
	"font-size": "12px",
	"font-weight": "500",
	"margin-bottom": "4px",
	color: "var(--vscode-foreground)",
}

const subtitleStyle: Record<string, string> = {
	"font-size": "11px",
	color: "var(--vscode-descriptionForeground)",
	"margin-bottom": "8px",
}

const formGroupStyle: Record<string, string> = {
	"margin-bottom": "8px",
}

// ─── Helpers ─────────────────────────────────────────────

function riskBadge(level: string): { background: string; color: string; label: string } {
	switch (level) {
		case "critical":
			return { background: "#5a1d1d", color: "#f48771", label: "CRITICAL" }
		case "high":
			return { background: "#5a3c1d", color: "#f4a871", label: "HIGH" }
		case "medium":
			return { background: "#5a5a1d", color: "#f4f471", label: "MEDIUM" }
		case "low":
			return { background: "#1d5a2a", color: "#71f487", label: "LOW" }
		default:
			return { background: "var(--vscode-badge-background)", color: "var(--vscode-badge-foreground)", label: level.toUpperCase() }
	}
}

function resultBadge(result: string): { icon: string; color: string } {
	switch (result) {
		case "approved":
			return { icon: "\u2713", color: "var(--vscode-testing-iconPassed)" }
		case "denied":
			return { icon: "\u2717", color: "var(--vscode-testing-iconFailed)" }
		case "blocked":
			return { icon: "\u26D4", color: "var(--vscode-testing-iconFailed)" }
		case "auto":
			return { icon: "\u26A1", color: "var(--vscode-charts-yellow)" }
		default:
			return { icon: "?", color: "var(--vscode-foreground)" }
	}
}

function statusIcon(status: string): { icon: string; color: string } {
	switch (status) {
		case "approved":
			return { icon: "\u2713", color: "var(--vscode-testing-iconPassed)" }
		case "rejected":
			return { icon: "\u2717", color: "var(--vscode-testing-iconFailed)" }
		case "pending":
			return { icon: "\u23F3", color: "var(--vscode-charts-yellow)" }
		default:
			return { icon: "?", color: "var(--vscode-foreground)" }
	}
}

function formatTimestamp(ts: number): string {
	const d = new Date(ts)
	return d.toLocaleString()
}

function tierDescription(name: string): string {
	switch (name) {
		case "observer":
			return "Read-only access. Can view audit logs and system status."
		case "operator":
			return "Can execute safe actions and request approvals for risky operations."
		case "admin":
			return "Can approve actions, manage dangerous actions, and create release verdicts."
		case "superadmin":
			return "Full control. Can manage tiers, override blocks, and export audit data."
		default:
			return ""
	}
}

const TIER_NAMES: AuthorityTier["name"][] = ["observer", "operator", "admin", "superadmin"]

const DEFAULT_STATE: GovernanceState = {
	tiers: [],
	tierAssignments: [],
	riskThresholds: { low: { min: 0, max: 25 }, medium: { min: 26, max: 50 }, high: { min: 51, max: 75 }, critical: { min: 76, max: 100 } },
	pendingApprovals: [],
	resolvedApprovals: [],
	dangerousActions: [],
	auditLog: [],
	releaseVerdicts: [],
}

// ─── Component ───────────────────────────────────────────

const GovernanceTab: Component = () => {
	const { postMessage, onMessage } = useVSCode()

	// ── State ──────────────────────────────────────────
	const [state, setState] = createSignal<GovernanceState>(DEFAULT_STATE)
	const [expandedSections, setExpandedSections] = createSignal<Record<string, boolean>>({
		tiers: true,
		risk: false,
		approvals: true,
		dangerous: false,
		audit: false,
		release: false,
	})

	// Tier assignment form
	const [assignUser, setAssignUser] = createSignal("")
	const [assignTier, setAssignTier] = createSignal<AuthorityTier["name"]>("observer")
	const [currentUser, setCurrentUser] = createSignal("current-user")

	// Approval form
	const [approvalReason, setApprovalReason] = createSignal("")
	const [approverName, setApproverName] = createSignal("")

	// Add dangerous action form
	const [newActionName, setNewActionName] = createSignal("")
	const [newActionDesc, setNewActionDesc] = createSignal("")
	const [newActionTier, setNewActionTier] = createSignal<AuthorityTier["name"]>("admin")
	const [newActionApproval, setNewActionApproval] = createSignal(true)

	// Audit filters
	const [auditActor, setAuditActor] = createSignal("")
	const [auditRiskLevel, setAuditRiskLevel] = createSignal("")
	const [auditResult, setAuditResult] = createSignal("")
	const [auditSearch, setAuditSearch] = createSignal("")
	const [auditStartDate, setAuditStartDate] = createSignal("")
	const [auditEndDate, setAuditEndDate] = createSignal("")

	// Release verdict form
	const [verdictScope, setVerdictScope] = createSignal("")
	const [verdictCritical, setVerdictCritical] = createSignal(0)
	const [verdictHigh, setVerdictHigh] = createSignal(0)
	const [verdictRiskSummary, setVerdictRiskSummary] = createSignal("")
	const [verdictRollbackPlan, setVerdictRollbackPlan] = createSignal("")
	const [verdictDecision, setVerdictDecision] = createSignal<"pass" | "conditional_pass" | "fail">("pass")

	// ── Message handling ───────────────────────────────

	const unsub = onMessage((msg) => {
		if (msg.type === "governanceState") {
			// KiloProvider sends { type: "governanceState", state: {...} }
			const s = (msg as unknown as { state: GovernanceState }).state
			if (s) setState(s)
		}
		if (msg.type === "governanceError") {
			console.error("[Governance]", (msg as unknown as { error: string }).error)
		}
		if (msg.type === "governanceAuditExport") {
			const data = (msg as unknown as { data: unknown }).data
			console.log("[Governance] Audit export:", data)
		}
	})
	onCleanup(unsub)

	// Request initial state — use requestGovernanceState to get full snapshot
	createEffect(() => {
		postMessage({ type: "requestGovernanceState" } as never)
	})

	// ── Section toggle ─────────────────────────────────

	const toggleSection = (key: string) => {
		setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }))
	}

	// ── Actions ────────────────────────────────────────

	const handleSetTier = () => {
		const user = assignUser().trim()
		if (!user) return
		postMessage({
			type: "governanceSetTier",
			user,
			tier: assignTier(),
		} as never)
		setAssignUser("")
	}

	const handleApprove = (id: string) => {
		const reason = approvalReason().trim()
		const approver = approverName().trim()
		if (!reason || !approver) return
		postMessage({
			type: "governanceApproveAction",
			approvalId: id,
			approvedBy: approver,
			reason,
		} as never)
		setApprovalReason("")
		setApproverName("")
	}

	const handleReject = (id: string) => {
		const reason = approvalReason().trim()
		const approver = approverName().trim()
		if (!reason || !approver) return
		postMessage({
			type: "governanceRejectAction",
			approvalId: id,
			rejectedBy: approver,
			reason,
		} as never)
		setApprovalReason("")
		setApproverName("")
	}

	const handleAddDangerousAction = () => {
		const name = newActionName().trim()
		const description = newActionDesc().trim()
		if (!name || !description) return
		postMessage({
			type: "governanceAddDangerousAction",
			name,
			description,
			minimumTier: newActionTier(),
			requiresApproval: newActionApproval(),
		} as never)
		setNewActionName("")
		setNewActionDesc("")
		setNewActionTier("admin")
		setNewActionApproval(true)
	}

	const handleToggleBlock = (actionId: string, blocked: boolean) => {
		postMessage({
			type: "governanceToggleBlock",
			actionId,
			blocked,
		} as never)
	}

	const handleExportAudit = () => {
		postMessage({ type: "governanceExportAudit" } as never)
	}

	const handleCreateVerdict = () => {
		const scope = verdictScope().trim()
		if (!scope) return
		postMessage({
			type: "governanceCreateVerdict",
			scope,
			criticalDefects: verdictCritical(),
			highDefects: verdictHigh(),
			riskSummary: verdictRiskSummary().trim(),
			rollbackPlan: verdictRollbackPlan().trim(),
			decision: verdictDecision(),
		} as never)
		setVerdictScope("")
		setVerdictCritical(0)
		setVerdictHigh(0)
		setVerdictRiskSummary("")
		setVerdictRollbackPlan("")
		setVerdictDecision("pass")
	}

	// ── Computed ────────────────────────────────────────

	const filteredAuditLog = () => {
		let entries = state().auditLog ?? []
		const actor = auditActor().trim().toLowerCase()
		if (actor) {
			entries = entries.filter((e) => e.actor.toLowerCase().includes(actor))
		}
		const risk = auditRiskLevel()
		if (risk) {
			entries = entries.filter((e) => e.riskLevel === risk)
		}
		const result = auditResult()
		if (result) {
			entries = entries.filter((e) => e.result === result)
		}
		const search = auditSearch().trim().toLowerCase()
		if (search) {
			entries = entries.filter(
				(e) =>
					e.action.toLowerCase().includes(search) ||
					e.details.toLowerCase().includes(search) ||
					e.actor.toLowerCase().includes(search),
			)
		}
		const start = auditStartDate()
		if (start) {
			const ts = new Date(start).getTime()
			entries = entries.filter((e) => e.timestamp >= ts)
		}
		const end = auditEndDate()
		if (end) {
			const ts = new Date(end).getTime() + 86400000
			entries = entries.filter((e) => e.timestamp <= ts)
		}
		return entries.slice(0, 100)
	}

	const currentUserTier = () => {
		const user = currentUser()
		const assignment = (state().tierAssignments ?? []).find((a) => a.user === user)
		return assignment?.tier ?? "observer"
	}

	const latestVerdict = () => {
		const verdicts = state().releaseVerdicts ?? []
		return verdicts.length > 0 ? verdicts[verdicts.length - 1] : undefined
	}

	// ── Render helpers ─────────────────────────────────

	const SectionHeader: Component<{ title: string; sectionKey: string; badge?: string }> = (props) => (
		<div
			style={sectionHeaderStyle}
			onClick={() => toggleSection(props.sectionKey)}
		>
			<span style={{ display: "flex", "align-items": "center", gap: "6px" }}>
				<span style={{ "font-size": "10px", "min-width": "12px" }}>
					{expandedSections()[props.sectionKey] ? "\u25BC" : "\u25B6"}
				</span>
				{props.title}
				<Show when={props.badge}>
					<span
						style={{
							padding: "1px 6px",
							"border-radius": "8px",
							"font-size": "10px",
							"font-weight": "normal",
							background: "var(--vscode-badge-background)",
							color: "var(--vscode-badge-foreground)",
						}}
					>
						{props.badge}
					</span>
				</Show>
			</span>
		</div>
	)

	const RiskBadge: Component<{ level: string }> = (props) => {
		const badge = () => riskBadge(props.level)
		return (
			<span
				style={{
					display: "inline-block",
					padding: "1px 6px",
					"border-radius": "3px",
					"font-size": "10px",
					"font-weight": "600",
					"letter-spacing": "0.5px",
					background: badge().background,
					color: badge().color,
				}}
			>
				{badge().label}
			</span>
		)
	}

	// ── Render ──────────────────────────────────────────

	return (
		<div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
			{/* ── Authority Tiers ─────────────────────────── */}
			<div style={cardStyle}>
				<SectionHeader title="Authority Tiers" sectionKey="tiers" />
				<Show when={expandedSections().tiers}>
					<div style={sectionBodyStyle}>
						{/* Current user tier badge */}
						<div
							style={{
								display: "flex",
								"align-items": "center",
								gap: "8px",
								"margin-bottom": "12px",
								padding: "8px 12px",
								"border-radius": "4px",
								background: "var(--vscode-textBlockQuote-background)",
								border: "1px solid var(--vscode-panel-border)",
							}}
						>
							<span style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>
								Your tier:
							</span>
							<span
								style={{
									padding: "2px 10px",
									"border-radius": "12px",
									"font-size": "11px",
									"font-weight": "600",
									"text-transform": "uppercase",
									background: "var(--vscode-badge-background)",
									color: "var(--vscode-badge-foreground)",
								}}
							>
								{currentUserTier()}
							</span>
						</div>

						{/* Tier cards */}
						<For each={state().tiers}>
							{(tier) => (
								<div
									style={{
										padding: "8px 12px",
										"margin-bottom": "8px",
										"border-radius": "4px",
										border: "1px solid var(--vscode-panel-border)",
										background: currentUserTier() === tier.name
											? "var(--vscode-list-activeSelectionBackground)"
											: "transparent",
									}}
								>
									<div
										style={{
											display: "flex",
											"align-items": "center",
											"justify-content": "space-between",
											"margin-bottom": "4px",
										}}
									>
										<span
											style={{
												"font-size": "13px",
												"font-weight": "600",
												"text-transform": "capitalize",
												color: currentUserTier() === tier.name
													? "var(--vscode-list-activeSelectionForeground)"
													: "var(--vscode-foreground)",
											}}
										>
											{tier.name}
										</span>
										<span
											style={{
												"font-size": "10px",
												color: "var(--vscode-descriptionForeground)",
											}}
										>
											Level {tier.level}
										</span>
									</div>
									<div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-bottom": "4px" }}>
										{tierDescription(tier.name)}
									</div>
									<div style={{ display: "flex", "flex-wrap": "wrap", gap: "4px" }}>
										<For each={tier.permissions}>
											{(perm) => (
												<span
													style={{
														padding: "1px 6px",
														"border-radius": "3px",
														"font-size": "10px",
														background: "var(--vscode-textCodeBlock-background)",
														color: "var(--vscode-textPreformat-foreground)",
														border: "1px solid var(--vscode-panel-border)",
													}}
												>
													{perm}
												</span>
											)}
										</For>
									</div>
								</div>
							)}
						</For>

						{/* Tier assignment form */}
						<div
							style={{
								"margin-top": "12px",
								padding: "10px 12px",
								"border-radius": "4px",
								border: "1px solid var(--vscode-panel-border)",
								background: "var(--vscode-textBlockQuote-background)",
							}}
						>
							<div style={labelStyle}>Assign Tier</div>
							<div style={{ display: "flex", gap: "6px", "align-items": "flex-end" }}>
								<div style={{ flex: "1" }}>
									<div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-bottom": "2px" }}>User</div>
									<input
										type="text"
										value={assignUser()}
										onInput={(e) => setAssignUser(e.currentTarget.value)}
										placeholder="username"
										style={inputStyle}
									/>
								</div>
								<div style={{ width: "130px" }}>
									<div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-bottom": "2px" }}>Tier</div>
									<select
										value={assignTier()}
										onChange={(e) => setAssignTier(e.currentTarget.value as AuthorityTier["name"])}
										style={{ ...inputStyle, height: "26px" }}
									>
										<For each={TIER_NAMES}>
											{(t) => <option value={t}>{t}</option>}
										</For>
									</select>
								</div>
								<button style={buttonStyle} onClick={handleSetTier}>
									Assign
								</button>
							</div>
						</div>

						{/* Current assignments */}
						<Show when={(state().tierAssignments ?? []).length > 0}>
							<div style={{ "margin-top": "8px" }}>
								<div style={labelStyle}>Current Assignments</div>
								<For each={state().tierAssignments}>
									{(a) => (
										<div style={rowStyle}>
											<span style={{ "font-weight": "500" }}>{a.user}</span>
											<span style={{ display: "flex", gap: "8px", "align-items": "center" }}>
												<span
													style={{
														padding: "1px 6px",
														"border-radius": "3px",
														"font-size": "10px",
														"text-transform": "uppercase",
														background: "var(--vscode-badge-background)",
														color: "var(--vscode-badge-foreground)",
													}}
												>
													{a.tier}
												</span>
												<span style={{ "font-size": "10px", color: "var(--vscode-descriptionForeground)" }}>
													{formatTimestamp(a.assignedAt)}
												</span>
											</span>
										</div>
									)}
								</For>
							</div>
						</Show>
					</div>
				</Show>
			</div>

			{/* ── Risk Scoring & Thresholds ───────────────── */}
			<div style={cardStyle}>
				<SectionHeader title="Risk Scoring & Approval Gates" sectionKey="risk" badge={`${(state().pendingApprovals ?? []).length} pending`} />
				<Show when={expandedSections().risk}>
					<div style={sectionBodyStyle}>
						{/* Thresholds display */}
						<div style={labelStyle}>Risk Thresholds</div>
						<div
							style={{
								display: "grid",
								"grid-template-columns": "1fr 1fr 1fr 1fr",
								gap: "8px",
								"margin-bottom": "16px",
							}}
						>
							{(["low", "medium", "high", "critical"] as const).map((level) => {
								const badge = riskBadge(level)
								const thresholds = state().riskThresholds ?? DEFAULT_STATE.riskThresholds
								const range = thresholds[level]
								return (
									<div
										style={{
											padding: "8px",
											"border-radius": "4px",
											"text-align": "center",
											background: badge.background,
											color: badge.color,
											"font-size": "11px",
										}}
									>
										<div style={{ "font-weight": "600", "margin-bottom": "2px" }}>{badge.label}</div>
										<div>{range.min} - {range.max}</div>
									</div>
								)
							})}
						</div>

						{/* Pending approvals */}
						<div style={labelStyle}>
							Pending Approvals ({(state().pendingApprovals ?? []).length})
						</div>
						<Show
							when={(state().pendingApprovals ?? []).length > 0}
							fallback={
								<div style={{ ...subtitleStyle, padding: "8px 0" }}>
									No pending approvals.
								</div>
							}
						>
							{/* Approver info form */}
							<div
								style={{
									display: "flex",
									gap: "6px",
									"margin-bottom": "8px",
									"align-items": "flex-end",
								}}
							>
								<div style={{ flex: "1" }}>
									<div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-bottom": "2px" }}>Approver Name</div>
									<input
										type="text"
										value={approverName()}
										onInput={(e) => setApproverName(e.currentTarget.value)}
										placeholder="Your name"
										style={inputStyle}
									/>
								</div>
								<div style={{ flex: "2" }}>
									<div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-bottom": "2px" }}>Reason</div>
									<input
										type="text"
										value={approvalReason()}
										onInput={(e) => setApprovalReason(e.currentTarget.value)}
										placeholder="Approval/rejection reason..."
										style={inputStyle}
									/>
								</div>
							</div>

							<For each={state().pendingApprovals}>
								{(approval) => (
									<div
										style={{
											padding: "8px 12px",
											"margin-bottom": "6px",
											"border-radius": "4px",
											border: "1px solid var(--vscode-panel-border)",
											background: "var(--vscode-textBlockQuote-background)",
										}}
									>
										<div
											style={{
												display: "flex",
												"align-items": "center",
												"justify-content": "space-between",
												"margin-bottom": "4px",
											}}
										>
											<span style={{ "font-size": "12px", "font-weight": "500" }}>
												{approval.actionDescription}
											</span>
											<RiskBadge level={approval.riskLevel} />
										</div>
										<div
											style={{
												display: "flex",
												"align-items": "center",
												"justify-content": "space-between",
												"font-size": "11px",
												color: "var(--vscode-descriptionForeground)",
												"margin-bottom": "6px",
											}}
										>
											<span>
												Requested by: <strong>{approval.actor}</strong> | Score: {approval.riskScore}
											</span>
											<span>{formatTimestamp(approval.timestamp)}</span>
										</div>
										<div style={{ display: "flex", gap: "6px", "justify-content": "flex-end" }}>
											<button
												style={buttonStyle}
												onClick={() => handleApprove(approval.id)}
												disabled={!approverName().trim() || !approvalReason().trim()}
											>
												Approve
											</button>
											<button
												style={dangerButtonStyle}
												onClick={() => handleReject(approval.id)}
												disabled={!approverName().trim() || !approvalReason().trim()}
											>
												Reject
											</button>
										</div>
									</div>
								)}
							</For>
						</Show>

						{/* Resolved approvals (last 10) */}
						<Show when={(state().resolvedApprovals ?? []).length > 0}>
							<div style={{ ...labelStyle, "margin-top": "12px" }}>
								Recent Resolved ({(state().resolvedApprovals ?? []).length})
							</div>
							<For each={(state().resolvedApprovals ?? []).slice(-10).reverse()}>
								{(record) => {
									const si = statusIcon(record.status)
									return (
										<div style={{ ...rowStyle, gap: "8px" }}>
											<span style={{ color: si.color, "font-size": "14px", "min-width": "16px" }}>
												{si.icon}
											</span>
											<span style={{ flex: "1", "font-size": "12px" }}>
												{record.actionDescription}
											</span>
											<RiskBadge level={record.riskLevel} />
											<span style={{ "font-size": "10px", color: "var(--vscode-descriptionForeground)" }}>
												{record.approvedBy ? `by ${record.approvedBy}` : ""}
											</span>
										</div>
									)
								}}
							</For>
						</Show>
					</div>
				</Show>
			</div>

			{/* ── Dangerous Action Registry ───────────────── */}
			<div style={cardStyle}>
				<SectionHeader
					title="Dangerous Action Registry"
					sectionKey="dangerous"
					badge={`${(state().dangerousActions ?? []).length} actions`}
				/>
				<Show when={expandedSections().dangerous}>
					<div style={sectionBodyStyle}>
						{/* Actions list */}
						<div
							style={{
								"max-height": "300px",
								"overflow-y": "auto",
								"margin-bottom": "12px",
							}}
						>
							<For each={state().dangerousActions ?? []}>
								{(action) => (
									<div
										style={{
											display: "flex",
											"align-items": "center",
											gap: "8px",
											padding: "6px 8px",
											"margin-bottom": "4px",
											"border-radius": "4px",
											border: "1px solid var(--vscode-panel-border)",
											background: action.blocked
												? "var(--vscode-inputValidation-errorBackground, #5a1d1d22)"
												: "transparent",
											opacity: action.blocked ? "0.7" : "1",
										}}
									>
										<div style={{ flex: "1", "min-width": "0" }}>
											<div
												style={{
													"font-size": "12px",
													"font-weight": "500",
													display: "flex",
													"align-items": "center",
													gap: "6px",
												}}
											>
												{action.name}
												<Show when={action.blocked}>
													<span
														style={{
															"font-size": "10px",
															padding: "0 4px",
															"border-radius": "3px",
															background: "#5a1d1d",
															color: "#f48771",
														}}
													>
														BLOCKED
													</span>
												</Show>
											</div>
											<div
												style={{
													"font-size": "11px",
													color: "var(--vscode-descriptionForeground)",
													"white-space": "nowrap",
													overflow: "hidden",
													"text-overflow": "ellipsis",
												}}
											>
												{action.description}
											</div>
										</div>
										<div
											style={{
												display: "flex",
												"align-items": "center",
												gap: "8px",
												"flex-shrink": "0",
											}}
										>
											<span
												style={{
													"font-size": "10px",
													padding: "1px 4px",
													"border-radius": "3px",
													"text-transform": "uppercase",
													background: "var(--vscode-textCodeBlock-background)",
													color: "var(--vscode-textPreformat-foreground)",
													border: "1px solid var(--vscode-panel-border)",
												}}
											>
												{action.minimumTier}
											</span>
											<Show when={action.requiresApproval}>
												<span
													style={{
														"font-size": "10px",
														padding: "1px 4px",
														"border-radius": "3px",
														background: "var(--vscode-charts-yellow)",
														color: "#000",
													}}
												>
													APPROVAL
												</span>
											</Show>
											{/* Block toggle */}
											<label
												style={{
													display: "flex",
													"align-items": "center",
													gap: "4px",
													cursor: "pointer",
													"font-size": "10px",
													color: "var(--vscode-descriptionForeground)",
												}}
											>
												<input
													type="checkbox"
													checked={action.blocked}
													onChange={(e) => handleToggleBlock(action.id, e.currentTarget.checked)}
													style={{ "accent-color": "var(--vscode-focusBorder)" }}
												/>
												Block
											</label>
										</div>
									</div>
								)}
							</For>
						</div>

						{/* Add new dangerous action */}
						<div
							style={{
								padding: "10px 12px",
								"border-radius": "4px",
								border: "1px solid var(--vscode-panel-border)",
								background: "var(--vscode-textBlockQuote-background)",
							}}
						>
							<div style={labelStyle}>Add Dangerous Action</div>
							<div style={formGroupStyle}>
								<div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-bottom": "2px" }}>Name</div>
								<input
									type="text"
									value={newActionName()}
									onInput={(e) => setNewActionName(e.currentTarget.value)}
									placeholder="Action name"
									style={inputStyle}
								/>
							</div>
							<div style={formGroupStyle}>
								<div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-bottom": "2px" }}>Description</div>
								<input
									type="text"
									value={newActionDesc()}
									onInput={(e) => setNewActionDesc(e.currentTarget.value)}
									placeholder="What does this action do?"
									style={inputStyle}
								/>
							</div>
							<div style={{ display: "flex", gap: "8px", "align-items": "flex-end" }}>
								<div style={{ flex: "1" }}>
									<div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-bottom": "2px" }}>Minimum Tier</div>
									<select
										value={newActionTier()}
										onChange={(e) => setNewActionTier(e.currentTarget.value as AuthorityTier["name"])}
										style={{ ...inputStyle, height: "26px" }}
									>
										<For each={TIER_NAMES}>
											{(t) => <option value={t}>{t}</option>}
										</For>
									</select>
								</div>
								<label
									style={{
										display: "flex",
										"align-items": "center",
										gap: "4px",
										"font-size": "11px",
										cursor: "pointer",
										"white-space": "nowrap",
										"padding-bottom": "4px",
									}}
								>
									<input
										type="checkbox"
										checked={newActionApproval()}
										onChange={(e) => setNewActionApproval(e.currentTarget.checked)}
										style={{ "accent-color": "var(--vscode-focusBorder)" }}
									/>
									Requires Approval
								</label>
								<button style={buttonStyle} onClick={handleAddDangerousAction}>
									Add
								</button>
							</div>
						</div>
					</div>
				</Show>
			</div>

			{/* ── Audit History ────────────────────────────── */}
			<div style={cardStyle}>
				<SectionHeader
					title="Audit History"
					sectionKey="audit"
					badge={`${(state().auditLog ?? []).length} entries`}
				/>
				<Show when={expandedSections().audit}>
					<div style={sectionBodyStyle}>
						{/* Filters */}
						<div
							style={{
								display: "grid",
								"grid-template-columns": "1fr 1fr 1fr",
								gap: "6px",
								"margin-bottom": "8px",
							}}
						>
							<div>
								<div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-bottom": "2px" }}>Actor</div>
								<input
									type="text"
									value={auditActor()}
									onInput={(e) => setAuditActor(e.currentTarget.value)}
									placeholder="Filter by actor..."
									style={inputStyle}
								/>
							</div>
							<div>
								<div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-bottom": "2px" }}>Risk Level</div>
								<select
									value={auditRiskLevel()}
									onChange={(e) => setAuditRiskLevel(e.currentTarget.value)}
									style={{ ...inputStyle, height: "26px" }}
								>
									<option value="">All</option>
									<option value="low">Low</option>
									<option value="medium">Medium</option>
									<option value="high">High</option>
									<option value="critical">Critical</option>
								</select>
							</div>
							<div>
								<div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-bottom": "2px" }}>Result</div>
								<select
									value={auditResult()}
									onChange={(e) => setAuditResult(e.currentTarget.value)}
									style={{ ...inputStyle, height: "26px" }}
								>
									<option value="">All</option>
									<option value="approved">Approved</option>
									<option value="denied">Denied</option>
									<option value="auto">Auto</option>
									<option value="blocked">Blocked</option>
								</select>
							</div>
						</div>
						<div
							style={{
								display: "grid",
								"grid-template-columns": "1fr 1fr 1fr",
								gap: "6px",
								"margin-bottom": "8px",
							}}
						>
							<div>
								<div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-bottom": "2px" }}>Start Date</div>
								<input
									type="date"
									value={auditStartDate()}
									onInput={(e) => setAuditStartDate(e.currentTarget.value)}
									style={inputStyle}
								/>
							</div>
							<div>
								<div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-bottom": "2px" }}>End Date</div>
								<input
									type="date"
									value={auditEndDate()}
									onInput={(e) => setAuditEndDate(e.currentTarget.value)}
									style={inputStyle}
								/>
							</div>
							<div>
								<div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-bottom": "2px" }}>Search</div>
								<input
									type="text"
									value={auditSearch()}
									onInput={(e) => setAuditSearch(e.currentTarget.value)}
									placeholder="Search actions, details..."
									style={inputStyle}
								/>
							</div>
						</div>

						{/* Export button */}
						<div style={{ display: "flex", "justify-content": "flex-end", "margin-bottom": "8px" }}>
							<button style={secondaryButtonStyle} onClick={handleExportAudit}>
								Export Audit Log (JSON)
							</button>
						</div>

						{/* Audit entries table */}
						<div style={{ "max-height": "400px", "overflow-y": "auto" }}>
							<Show
								when={filteredAuditLog().length > 0}
								fallback={
									<div style={{ ...subtitleStyle, padding: "12px 0", "text-align": "center" }}>
										No audit entries match the current filters.
									</div>
								}
							>
								{/* Table header */}
								<div
									style={{
										display: "grid",
										"grid-template-columns": "140px 80px 1fr 70px 60px",
										gap: "8px",
										padding: "4px 8px",
										"font-size": "10px",
										"font-weight": "600",
										"text-transform": "uppercase",
										color: "var(--vscode-descriptionForeground)",
										"border-bottom": "2px solid var(--vscode-panel-border)",
										position: "sticky",
										top: "0",
										background: "var(--vscode-editor-background)",
									}}
								>
									<span>Timestamp</span>
									<span>Actor</span>
									<span>Action</span>
									<span>Risk</span>
									<span>Result</span>
								</div>

								<For each={filteredAuditLog()}>
									{(entry) => {
										const rb = resultBadge(entry.result)
										return (
											<div
												style={{
													display: "grid",
													"grid-template-columns": "140px 80px 1fr 70px 60px",
													gap: "8px",
													padding: "4px 8px",
													"font-size": "11px",
													"border-bottom": "1px solid var(--vscode-panel-border)",
													"align-items": "center",
												}}
												title={entry.details}
											>
												<span style={{ color: "var(--vscode-descriptionForeground)", "font-size": "10px" }}>
													{formatTimestamp(entry.timestamp)}
												</span>
												<span
													style={{
														overflow: "hidden",
														"text-overflow": "ellipsis",
														"white-space": "nowrap",
													}}
												>
													{entry.actor}
												</span>
												<span
													style={{
														overflow: "hidden",
														"text-overflow": "ellipsis",
														"white-space": "nowrap",
													}}
												>
													{entry.action}
												</span>
												<RiskBadge level={entry.riskLevel} />
												<span style={{ color: rb.color, "font-weight": "600", "font-size": "12px" }}>
													{rb.icon} {entry.result}
												</span>
											</div>
										)
									}}
								</For>
							</Show>
						</div>

						<Show when={filteredAuditLog().length > 0}>
							<div
								style={{
									"font-size": "10px",
									color: "var(--vscode-descriptionForeground)",
									"text-align": "center",
									"margin-top": "4px",
								}}
							>
								Showing {filteredAuditLog().length} of {(state().auditLog ?? []).length} entries (max 100). Hover a row to see details.
							</div>
						</Show>
					</div>
				</Show>
			</div>

			{/* ── Release Control ──────────────────────────── */}
			<div style={cardStyle}>
				<SectionHeader title="Release Control" sectionKey="release" />
				<Show when={expandedSections().release}>
					<div style={sectionBodyStyle}>
						{/* Release checklist */}
						<div style={labelStyle}>Release Checklist</div>
						<div style={{ "margin-bottom": "12px" }}>
							<For each={state().checklist ?? []}>
								{(item) => (
									<div
										style={{
											display: "flex",
											"align-items": "center",
											gap: "8px",
											padding: "4px 0",
											"font-size": "12px",
											"border-bottom": "1px solid var(--vscode-panel-border)",
										}}
									>
										<span
											style={{
												color: item.passed
													? "var(--vscode-testing-iconPassed)"
													: "var(--vscode-testing-iconFailed)",
												"font-size": "14px",
												"min-width": "16px",
											}}
										>
											{item.passed ? "\u2713" : "\u2717"}
										</span>
										<span
											style={{
												color: item.passed
													? "var(--vscode-foreground)"
													: "var(--vscode-errorForeground)",
											}}
										>
											{item.label}
										</span>
									</div>
								)}
							</For>
							<Show when={!(state().checklist ?? []).length}>
								<div style={{ ...subtitleStyle, padding: "8px 0" }}>
									No checklist data available. Create a release verdict to generate the checklist.
								</div>
							</Show>
						</div>

						{/* Release verdict display */}
						<Show when={latestVerdict()}>
							{(verdict) => {
								const decisionColor = () => {
									switch (verdict().decision) {
										case "pass":
											return "var(--vscode-testing-iconPassed)"
										case "conditional_pass":
											return "var(--vscode-charts-yellow)"
										case "fail":
											return "var(--vscode-testing-iconFailed)"
									}
								}
								const decisionLabel = () => {
									switch (verdict().decision) {
										case "pass":
											return "PASS"
										case "conditional_pass":
											return "CONDITIONAL PASS"
										case "fail":
											return "FAIL"
									}
								}
								return (
									<div
										style={{
											padding: "12px",
											"margin-bottom": "12px",
											"border-radius": "4px",
											border: `2px solid ${decisionColor()}`,
											background: "var(--vscode-textBlockQuote-background)",
										}}
									>
										<div
											style={{
												display: "flex",
												"align-items": "center",
												"justify-content": "space-between",
												"margin-bottom": "8px",
											}}
										>
											<span
												style={{
													"font-size": "16px",
													"font-weight": "700",
													color: decisionColor(),
												}}
											>
												{decisionLabel()}
											</span>
											<span
												style={{
													"font-size": "10px",
													color: "var(--vscode-descriptionForeground)",
												}}
											>
												{formatTimestamp(verdict().timestamp)}
											</span>
										</div>
										<div style={{ "font-size": "12px", "margin-bottom": "4px" }}>
											<strong>Scope:</strong> {verdict().scope}
										</div>
										<div style={{ "font-size": "12px", "margin-bottom": "4px" }}>
											<strong>Critical Defects:</strong>{" "}
											<span
												style={{
													color:
														verdict().criticalDefects > 0
															? "var(--vscode-testing-iconFailed)"
															: "var(--vscode-testing-iconPassed)",
												}}
											>
												{verdict().criticalDefects}
											</span>
											{" | "}
											<strong>High Defects:</strong>{" "}
											<span
												style={{
													color:
														verdict().highDefects > 0
															? "var(--vscode-charts-yellow)"
															: "var(--vscode-testing-iconPassed)",
												}}
											>
												{verdict().highDefects}
											</span>
										</div>
										<Show when={verdict().riskSummary}>
											<div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-bottom": "4px" }}>
												<strong>Risk:</strong> {verdict().riskSummary}
											</div>
										</Show>
										<Show when={verdict().rollbackPlan}>
											<div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
												<strong>Rollback:</strong> {verdict().rollbackPlan}
											</div>
										</Show>
									</div>
								)
							}}
						</Show>

						{/* Overall readiness */}
						<Show when={state().releaseReadiness}>
							{(readiness) => {
								const readinessColor = () => {
									switch (readiness()) {
										case "pass":
											return "var(--vscode-testing-iconPassed)"
										case "conditional_pass":
											return "var(--vscode-charts-yellow)"
										case "fail":
											return "var(--vscode-testing-iconFailed)"
									}
								}
								const readinessLabel = () => {
									switch (readiness()) {
										case "pass":
											return "PASS"
										case "conditional_pass":
											return "CONDITIONAL PASS"
										case "fail":
											return "FAIL"
									}
								}
								return (
									<div
										style={{
											display: "flex",
											"align-items": "center",
											gap: "8px",
											"margin-bottom": "12px",
											padding: "6px 12px",
											"border-radius": "4px",
											background: "var(--vscode-textBlockQuote-background)",
											border: "1px solid var(--vscode-panel-border)",
										}}
									>
										<span style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>
											Overall Readiness:
										</span>
										<span
											style={{
												"font-size": "13px",
												"font-weight": "700",
												color: readinessColor(),
											}}
										>
											{readinessLabel()}
										</span>
									</div>
								)
							}}
						</Show>

						{/* Rollback readiness */}
						<div
							style={{
								display: "flex",
								"align-items": "center",
								gap: "8px",
								"margin-bottom": "12px",
								padding: "6px 12px",
								"border-radius": "4px",
								background: "var(--vscode-textBlockQuote-background)",
								border: "1px solid var(--vscode-panel-border)",
							}}
						>
							<span style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>
								Rollback Ready:
							</span>
							<span
								style={{
									"font-size": "14px",
									color: state().rollbackReady
										? "var(--vscode-testing-iconPassed)"
										: "var(--vscode-testing-iconFailed)",
								}}
							>
								{state().rollbackReady ? "\u2713 Yes" : "\u2717 No"}
							</span>
						</div>

						{/* Create release verdict form */}
						<div
							style={{
								padding: "10px 12px",
								"border-radius": "4px",
								border: "1px solid var(--vscode-panel-border)",
								background: "var(--vscode-textBlockQuote-background)",
							}}
						>
							<div style={labelStyle}>Create Release Verdict</div>
							<div style={formGroupStyle}>
								<div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-bottom": "2px" }}>Scope</div>
								<input
									type="text"
									value={verdictScope()}
									onInput={(e) => setVerdictScope(e.currentTarget.value)}
									placeholder="e.g., v2.1.0 release"
									style={inputStyle}
								/>
							</div>
							<div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "8px", ...formGroupStyle }}>
								<div>
									<div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-bottom": "2px" }}>Critical Defects</div>
									<input
										type="number"
										min="0"
										value={verdictCritical()}
										onInput={(e) => setVerdictCritical(parseInt(e.currentTarget.value) || 0)}
										style={inputStyle}
									/>
								</div>
								<div>
									<div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-bottom": "2px" }}>High Defects</div>
									<input
										type="number"
										min="0"
										value={verdictHigh()}
										onInput={(e) => setVerdictHigh(parseInt(e.currentTarget.value) || 0)}
										style={inputStyle}
									/>
								</div>
							</div>
							<div style={formGroupStyle}>
								<div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-bottom": "2px" }}>Risk Summary</div>
								<textarea
									value={verdictRiskSummary()}
									onInput={(e) => setVerdictRiskSummary(e.currentTarget.value)}
									placeholder="Summary of risks for this release..."
									rows={2}
									style={{ ...inputStyle, resize: "vertical" }}
								/>
							</div>
							<div style={formGroupStyle}>
								<div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-bottom": "2px" }}>Rollback Plan</div>
								<textarea
									value={verdictRollbackPlan()}
									onInput={(e) => setVerdictRollbackPlan(e.currentTarget.value)}
									placeholder="Steps to rollback if issues arise..."
									rows={2}
									style={{ ...inputStyle, resize: "vertical" }}
								/>
							</div>
							<div
								style={{
									display: "flex",
									gap: "8px",
									"align-items": "flex-end",
								}}
							>
								<div style={{ flex: "1" }}>
									<div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-bottom": "2px" }}>Decision</div>
									<select
										value={verdictDecision()}
										onChange={(e) => setVerdictDecision(e.currentTarget.value as ReleaseVerdict["decision"])}
										style={{ ...inputStyle, height: "26px" }}
									>
										<option value="pass">PASS</option>
										<option value="conditional_pass">CONDITIONAL PASS</option>
										<option value="fail">FAIL</option>
									</select>
								</div>
								<button style={buttonStyle} onClick={handleCreateVerdict}>
									Create Verdict
								</button>
							</div>
						</div>

						{/* Previous verdicts */}
						<Show when={(state().releaseVerdicts ?? []).length > 1}>
							<div style={{ ...labelStyle, "margin-top": "12px" }}>
								Previous Verdicts
							</div>
							<For each={(state().releaseVerdicts ?? []).slice(0, -1).reverse()}>
								{(v) => {
									const color = () => {
										switch (v.decision) {
											case "pass":
												return "var(--vscode-testing-iconPassed)"
											case "conditional_pass":
												return "var(--vscode-charts-yellow)"
											case "fail":
												return "var(--vscode-testing-iconFailed)"
										}
									}
									const label = () => {
										switch (v.decision) {
											case "pass":
												return "PASS"
											case "conditional_pass":
												return "CONDITIONAL"
											case "fail":
												return "FAIL"
										}
									}
									return (
										<div style={{ ...rowStyle, gap: "8px" }}>
											<span style={{ color: color(), "font-weight": "600", "font-size": "11px", "min-width": "80px" }}>
												{label()}
											</span>
											<span style={{ flex: "1", "font-size": "12px" }}>
												{v.scope}
											</span>
											<span style={{ "font-size": "10px", color: "var(--vscode-descriptionForeground)" }}>
												{formatTimestamp(v.timestamp)}
											</span>
										</div>
									)
								}}
							</For>
						</Show>
					</div>
				</Show>
			</div>
		</div>
	)
}

export default GovernanceTab
