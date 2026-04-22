import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import * as crypto from "crypto"
import { KiloLogger } from "../KiloLogger"

// ─── Interfaces ──────────────────────────────────────────

export interface AuthorityTier {
	level: number
	name: "observer" | "operator" | "admin" | "superadmin"
	permissions: string[]
}

export interface ApprovalRecord {
	id: string
	actionId: string
	actionDescription: string
	actor: string
	riskScore: number
	riskLevel: "low" | "medium" | "high" | "critical"
	status: "pending" | "approved" | "rejected"
	escalated: boolean
	approvedBy?: string
	reason?: string
	timestamp: number
	resolvedAt?: number
}

export interface DangerousAction {
	id: string
	name: string
	description: string
	severity: "warning" | "critical"
	minimumTier: "observer" | "operator" | "admin" | "superadmin"
	requiresApproval: boolean
	blocked: boolean
}

export interface AuditEntry {
	id: string
	timestamp: number
	actor: string
	action: string
	riskLevel: "low" | "medium" | "high" | "critical"
	result: "approved" | "denied" | "auto" | "blocked"
	details: string
}

export interface ReleaseVerdict {
	id: string
	scope: string
	criticalDefects: number
	highDefects: number
	riskSummary: string
	rollbackPlan: string
	decision: "pass" | "conditional_pass" | "fail"
	timestamp: number
}

export interface EscalationConfig {
	timeoutMs: number
	escalationTier: string
}

export interface RiskThresholds {
	low: { min: number; max: number }
	medium: { min: number; max: number }
	high: { min: number; max: number }
	critical: { min: number; max: number }
}

export interface RiskBehavior {
	level: "low" | "medium" | "high"
	action: "auto-execute" | "execute-with-logging" | "block-until-approved"
	description: string
}

export interface TierAssignment {
	user: string
	tier: AuthorityTier["name"]
	assignedAt: number
	assignedBy: string
}

// ─── Adversarial Audit Interfaces ───────────────────────

export interface AuditFinding {
	severity: "critical" | "high" | "medium" | "low"
	category: string
	description: string
	subsystem: string
	recommendation: string
}

export interface SubsystemAuditResult {
	name: string
	score: number
	findings: AuditFinding[]
	evidencePresent: boolean
}

export interface AdversarialAuditResult {
	auditId: string
	timestamp: number
	subsystems: SubsystemAuditResult[]
	overallScore: number
	criticalFindings: string[]
	recommendations: string[]
	verdict: "pass" | "conditional_pass" | "fail"
}

// ─── Evidence Bundle Interfaces ─────────────────────────

export interface EvidenceItem {
	type: "screenshot" | "log" | "trace" | "config" | "test_result"
	description: string
	path?: string
	data?: string
	capturedAt: number
}

export interface EvidenceBundle {
	bundleId: string
	block: string
	createdAt: number
	items: EvidenceItem[]
	status: "collecting" | "complete" | "verified"
}

// ─── Subsystem Registration ─────────────────────────────

export interface RegisteredSubsystem {
	name: string
	status: "active" | "degraded" | "inactive"
	registeredAt: number
}

export interface GovernanceState {
	tiers: AuthorityTier[]
	tierAssignments: TierAssignment[]
	riskThresholds: RiskThresholds
	riskBehaviors: RiskBehavior[]
	pendingApprovals: ApprovalRecord[]
	resolvedApprovals: ApprovalRecord[]
	dangerousActions: DangerousAction[]
	auditLog: AuditEntry[]
	releaseVerdicts: ReleaseVerdict[]
}

// ─── Defaults ────────────────────────────────────────────

const DEFAULT_TIERS: AuthorityTier[] = [
	{
		level: 0,
		name: "observer",
		permissions: ["view_audit", "view_status"],
	},
	{
		level: 1,
		name: "operator",
		permissions: ["view_audit", "view_status", "execute_safe_actions", "request_approval"],
	},
	{
		level: 2,
		name: "admin",
		permissions: [
			"view_audit",
			"view_status",
			"execute_safe_actions",
			"request_approval",
			"approve_actions",
			"manage_dangerous_actions",
			"create_release_verdict",
		],
	},
	{
		level: 3,
		name: "superadmin",
		permissions: [
			"view_audit",
			"view_status",
			"execute_safe_actions",
			"request_approval",
			"approve_actions",
			"manage_dangerous_actions",
			"create_release_verdict",
			"manage_tiers",
			"override_blocks",
			"export_audit",
		],
	},
]

const DEFAULT_RISK_THRESHOLDS: RiskThresholds = {
	low: { min: 0, max: 25 },
	medium: { min: 26, max: 50 },
	high: { min: 51, max: 75 },
	critical: { min: 76, max: 100 },
}

const DEFAULT_DANGEROUS_ACTIONS: DangerousAction[] = [
	{
		id: "git-force-push",
		name: "Git Force Push",
		description: "Force push to a remote branch, potentially overwriting others' work",
		severity: "critical",
		minimumTier: "admin",
		requiresApproval: true,
		blocked: false,
	},
	{
		id: "production-deploy",
		name: "Production Deploy",
		description: "Deploy changes to the production environment",
		severity: "critical",
		minimumTier: "admin",
		requiresApproval: true,
		blocked: false,
	},
	{
		id: "database-migration",
		name: "Database Migration",
		description: "Execute database schema migration scripts",
		severity: "critical",
		minimumTier: "admin",
		requiresApproval: true,
		blocked: false,
	},
	{
		id: "delete-branch",
		name: "Delete Branch",
		description: "Delete a remote branch from the repository",
		severity: "warning",
		minimumTier: "operator",
		requiresApproval: false,
		blocked: false,
	},
	{
		id: "reset-hard",
		name: "Git Reset Hard",
		description: "Hard reset the working directory, discarding all uncommitted changes",
		severity: "critical",
		minimumTier: "admin",
		requiresApproval: true,
		blocked: false,
	},
	{
		id: "env-modify",
		name: "Modify Environment Variables",
		description: "Modify production environment variables or secrets",
		severity: "critical",
		minimumTier: "admin",
		requiresApproval: true,
		blocked: false,
	},
	{
		id: "dependency-major-upgrade",
		name: "Major Dependency Upgrade",
		description: "Upgrade a dependency to a new major version",
		severity: "warning",
		minimumTier: "operator",
		requiresApproval: true,
		blocked: false,
	},
	{
		id: "security-config-change",
		name: "Security Configuration Change",
		description: "Modify authentication, authorization, or encryption settings",
		severity: "critical",
		minimumTier: "superadmin",
		requiresApproval: true,
		blocked: false,
	},
	// ── Infrastructure & Platform Actions ────────────────
	{
		id: "vps_deploy",
		name: "VPS Deploy",
		description: "Deploy services or containers to a VPS instance",
		severity: "critical",
		minimumTier: "admin",
		requiresApproval: true,
		blocked: false,
	},
	{
		id: "vps_rollback",
		name: "VPS Rollback",
		description: "Rollback a VPS deployment to a previous state",
		severity: "critical",
		minimumTier: "admin",
		requiresApproval: true,
		blocked: false,
	},
	{
		id: "ssh_root_access",
		name: "SSH Root Access",
		description: "Obtain root-level SSH access to a remote host",
		severity: "critical",
		minimumTier: "superadmin",
		requiresApproval: true,
		blocked: false,
	},
	{
		id: "training_launch",
		name: "Training Launch",
		description: "Launch a model training or fine-tuning job",
		severity: "warning",
		minimumTier: "operator",
		requiresApproval: false,
		blocked: false,
	},
	{
		id: "memory_wipe",
		name: "Memory Wipe",
		description: "Erase stored agent memory or knowledge-base data",
		severity: "critical",
		minimumTier: "superadmin",
		requiresApproval: true,
		blocked: false,
	},
	{
		id: "routing_config_change",
		name: "Routing Config Change",
		description: "Modify model routing configuration or traffic rules",
		severity: "warning",
		minimumTier: "admin",
		requiresApproval: true,
		blocked: false,
	},
	{
		id: "governance_modify",
		name: "Governance Modify",
		description: "Change governance rules, tiers, or approval policies",
		severity: "critical",
		minimumTier: "superadmin",
		requiresApproval: true,
		blocked: false,
	},
	{
		id: "zeroclaw_high_risk",
		name: "ZeroClaw High Risk",
		description: "Execute a ZeroClaw action classified as high-risk",
		severity: "critical",
		minimumTier: "admin",
		requiresApproval: true,
		blocked: false,
	},
]

const DEFAULT_RISK_BEHAVIORS: RiskBehavior[] = [
	{
		level: "low",
		action: "auto-execute",
		description: "Low-risk actions are executed automatically without human intervention",
	},
	{
		level: "medium",
		action: "execute-with-logging",
		description: "Medium-risk actions are executed but logged for audit review",
	},
	{
		level: "high",
		action: "block-until-approved",
		description: "High-risk actions are blocked until explicitly approved by an authorized tier",
	},
]

const DEFAULT_STATE: GovernanceState = {
	tiers: DEFAULT_TIERS,
	tierAssignments: [],
	riskThresholds: DEFAULT_RISK_THRESHOLDS,
	riskBehaviors: DEFAULT_RISK_BEHAVIORS,
	pendingApprovals: [],
	resolvedApprovals: [],
	dangerousActions: DEFAULT_DANGEROUS_ACTIONS,
	auditLog: [],
	releaseVerdicts: [],
}

// ─── Helpers ─────────────────────────────────────────────

function generateId(): string {
	const ts = Date.now().toString(36)
	const rnd = Math.random().toString(36).substring(2, 10)
	return `${ts}-${rnd}`
}

function tierLevel(name: AuthorityTier["name"]): number {
	switch (name) {
		case "observer":
			return 0
		case "operator":
			return 1
		case "admin":
			return 2
		case "superadmin":
			return 3
		default:
			KiloLogger.for("GovernanceService").warn(`Unknown tier name: "${name}", defaulting to observer level (0)`)
			return 0
	}
}

// ─── Service ─────────────────────────────────────────────

export class GovernanceService implements vscode.Disposable {
	private readonly log = KiloLogger.for("GovernanceService")
	private state: GovernanceState
	private storagePath: string
	private saveTimer: ReturnType<typeof setTimeout> | undefined
	private escalationTimer: ReturnType<typeof setInterval> | undefined
	private readonly onStateChangedEmitter = new vscode.EventEmitter<GovernanceState>()
	public readonly onStateChanged = this.onStateChangedEmitter.event
	private registeredSubsystems: Map<string, RegisteredSubsystem> = new Map()
	private evidenceBundles: Map<string, EvidenceBundle> = new Map()

	public escalationConfig: EscalationConfig = {
		timeoutMs: 3600000,
		escalationTier: "SuperAdmin",
	}

	constructor(workspaceRoot: string) {
		const kiloDir = path.join(workspaceRoot, ".kilo")
		this.storagePath = path.join(kiloDir, "governance.json")
		this.state = this.load(kiloDir)
		this.seedDefaults()
		this.log.info("GovernanceService initialized", { storagePath: this.storagePath })
	}

	// ── Persistence ────────────────────────────────────

	private load(kiloDir: string): GovernanceState {
		try {
			if (fs.existsSync(this.storagePath)) {
				const raw = fs.readFileSync(this.storagePath, "utf-8")
				const parsed = JSON.parse(raw) as Partial<GovernanceState>
				return {
					tiers: parsed.tiers ?? DEFAULT_TIERS,
					tierAssignments: parsed.tierAssignments ?? [],
					riskThresholds: parsed.riskThresholds ?? DEFAULT_RISK_THRESHOLDS,
					riskBehaviors: parsed.riskBehaviors ?? DEFAULT_RISK_BEHAVIORS,
					pendingApprovals: parsed.pendingApprovals ?? [],
					resolvedApprovals: parsed.resolvedApprovals ?? [],
					dangerousActions: parsed.dangerousActions ?? DEFAULT_DANGEROUS_ACTIONS,
					auditLog: parsed.auditLog ?? [],
					releaseVerdicts: parsed.releaseVerdicts ?? [],
				}
			}
		} catch (err) {
			this.log.warn("Failed to load state, using defaults", err)
		}
		// Ensure .kilo directory exists for first-time save
		if (!fs.existsSync(kiloDir)) {
			fs.mkdirSync(kiloDir, { recursive: true })
		}
		return JSON.parse(JSON.stringify(DEFAULT_STATE))
	}

	/**
	 * Seed sensible defaults into state when it is empty or missing
	 * expected entries. This runs on every construction so that both
	 * fresh installs AND existing saved states gain any newly-added
	 * default tiers, dangerous actions, and risk behaviors without
	 * duplicating entries that already exist.
	 */
	private seedDefaults(): void {
		let changed = false

		// ── Tiers: ensure all four canonical tiers are present ──
		for (const defaultTier of DEFAULT_TIERS) {
			if (!this.state.tiers.some((t) => t.name === defaultTier.name)) {
				this.state.tiers.push({ ...defaultTier })
				changed = true
			}
		}

		// ── Risk behaviors: backfill any missing levels ──
		if (!this.state.riskBehaviors || this.state.riskBehaviors.length === 0) {
			this.state.riskBehaviors = JSON.parse(JSON.stringify(DEFAULT_RISK_BEHAVIORS))
			changed = true
		} else {
			for (const defaultBehavior of DEFAULT_RISK_BEHAVIORS) {
				if (!this.state.riskBehaviors.some((b) => b.level === defaultBehavior.level)) {
					this.state.riskBehaviors.push({ ...defaultBehavior })
					changed = true
				}
			}
		}

		// ── Dangerous actions: add any missing defaults by id ──
		for (const defaultAction of DEFAULT_DANGEROUS_ACTIONS) {
			if (!this.state.dangerousActions.some((a) => a.id === defaultAction.id)) {
				this.state.dangerousActions.push({ ...defaultAction })
				this.log.debug("Seeded default dangerous action", { id: defaultAction.id, name: defaultAction.name })
				changed = true
			}
		}

		if (changed) {
			this.log.info("Defaults seeded into governance state")
			this.scheduleSave()
		}
	}

	private scheduleSave(): void {
		if (this.saveTimer) {
			clearTimeout(this.saveTimer)
		}
		this.saveTimer = setTimeout(() => {
			this.persistNow()
		}, 300)
	}

	private persistNow(): void {
		try {
			const dir = path.dirname(this.storagePath)
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true })
			}
			fs.writeFileSync(this.storagePath, JSON.stringify(this.state, null, 2), "utf-8")
		} catch (err) {
			this.log.error("Failed to persist state", err)
		}
	}

	private emitChange(): void {
		this.scheduleSave()
		this.onStateChangedEmitter.fire(this.getSnapshot())
	}

	// ── Snapshot ────────────────────────────────────────

	getSnapshot(): GovernanceState {
		this.log.debug("Snapshot requested")
		return JSON.parse(JSON.stringify(this.state))
	}

	// ── Authority Tiers ────────────────────────────────

	getTiers(): AuthorityTier[] {
		return this.state.tiers.slice()
	}

	getTierAssignments(): TierAssignment[] {
		return this.state.tierAssignments.slice()
	}

	getUserTier(user: string): AuthorityTier {
		const assignment = this.state.tierAssignments.find((a) => a.user === user)
		const tierName = assignment?.tier ?? "observer"
		return this.state.tiers.find((t) => t.name === tierName) ?? this.state.tiers[0]
	}

	setUserTier(user: string, tierName: AuthorityTier["name"], assignedBy: string): void {
		this.log.info("Authority tier changed", { userId: user, newTier: tierName, assignedBy })
		const existing = this.state.tierAssignments.findIndex((a) => a.user === user)
		const assignment: TierAssignment = {
			user,
			tier: tierName,
			assignedAt: Date.now(),
			assignedBy,
		}
		if (existing >= 0) {
			this.state.tierAssignments[existing] = assignment
		} else {
			this.state.tierAssignments.push(assignment)
		}

		this.addAuditEntry({
			actor: assignedBy,
			action: `Set tier for "${user}" to "${tierName}"`,
			riskLevel: "medium",
			result: "auto",
			details: `User "${user}" assigned tier "${tierName}" by "${assignedBy}"`,
		})

		this.emitChange()
	}

	userHasPermission(user: string, permission: string): boolean {
		const tier = this.getUserTier(user)
		return tier.permissions.includes(permission)
	}

	// ── Risk Scoring ───────────────────────────────────

	getRiskThresholds(): RiskThresholds {
		return { ...this.state.riskThresholds }
	}

	getRiskBehaviors(): RiskBehavior[] {
		return this.state.riskBehaviors.slice()
	}

	setRiskThresholds(thresholds: RiskThresholds): void {
		this.state.riskThresholds = { ...thresholds }
		this.emitChange()
	}

	/**
	 * Calculate a risk score.
	 * Formula: score = base + impact + contextModifiers
	 * - base: inherent risk of the action type (0-40)
	 * - impact: estimated blast radius (0-30)
	 * - contextModifiers: environmental factors (0-30)
	 *
	 * All values are clamped to [0, 100].
	 */
	calculateRiskScore(base: number, impact: number, contextModifiers: number): number {
		const raw = base + impact + contextModifiers
		return Math.max(0, Math.min(100, Math.round(raw)))
	}

	classifyRisk(score: number): "low" | "medium" | "high" | "critical" {
		const t = this.state.riskThresholds
		if (score >= t.critical.min) return "critical"
		if (score >= t.high.min) return "high"
		if (score >= t.medium.min) return "medium"
		return "low"
	}

	// ── Approval Gates ─────────────────────────────────

	getPendingApprovals(): ApprovalRecord[] {
		return this.state.pendingApprovals.slice()
	}

	getResolvedApprovals(): ApprovalRecord[] {
		return this.state.resolvedApprovals.slice()
	}

	/**
	 * Request approval for an action. Returns the created ApprovalRecord.
	 * If the action's risk is low, it auto-approves.
	 */
	requestApproval(actionId: string, actionDescription: string, actor: string, riskScore: number): ApprovalRecord {
		const riskLevel = this.classifyRisk(riskScore)

		const record: ApprovalRecord = {
			id: generateId(),
			actionId,
			actionDescription,
			actor,
			riskScore,
			riskLevel,
			status: "pending",
			escalated: false,
			timestamp: Date.now(),
		}

		// Auto-approve low-risk actions
		if (riskLevel === "low") {
			record.status = "approved"
			record.approvedBy = "system"
			record.reason = "Auto-approved: low risk"
			record.resolvedAt = Date.now()
			this.state.resolvedApprovals.push(record)

			this.addAuditEntry({
				actor,
				action: actionDescription,
				riskLevel,
				result: "auto",
				details: `Auto-approved low-risk action (score: ${riskScore})`,
			})
		} else {
			this.state.pendingApprovals.push(record)
			this.startEscalationTimer()

			this.addAuditEntry({
				actor,
				action: actionDescription,
				riskLevel,
				result: "denied",
				details: `Approval requested (score: ${riskScore}, level: ${riskLevel})`,
			})
		}

		this.emitChange()
		return record
	}

	approveAction(approvalId: string, approvedBy: string, reason: string): ApprovalRecord | undefined {
		const idx = this.state.pendingApprovals.findIndex((a) => a.id === approvalId)
		if (idx < 0) return undefined

		const record = this.state.pendingApprovals[idx]
		this.log.info("Action approved", { approvalId, approvedBy, action: record.actionDescription, riskLevel: record.riskLevel })
		record.status = "approved"
		record.approvedBy = approvedBy
		record.reason = reason
		record.resolvedAt = Date.now()

		this.state.pendingApprovals.splice(idx, 1)
		this.state.resolvedApprovals.push(record)

		this.addAuditEntry({
			actor: approvedBy,
			action: `Approved: ${record.actionDescription}`,
			riskLevel: record.riskLevel,
			result: "approved",
			details: `Approved by ${approvedBy}. Reason: ${reason}`,
		})

		this.emitChange()
		return record
	}

	rejectAction(approvalId: string, rejectedBy: string, reason: string): ApprovalRecord | undefined {
		const idx = this.state.pendingApprovals.findIndex((a) => a.id === approvalId)
		if (idx < 0) return undefined

		const record = this.state.pendingApprovals[idx]
		this.log.info("Action rejected", { approvalId, rejectedBy, action: record.actionDescription, riskLevel: record.riskLevel, reason })
		record.status = "rejected"
		record.approvedBy = rejectedBy
		record.reason = reason
		record.resolvedAt = Date.now()

		this.state.pendingApprovals.splice(idx, 1)
		this.state.resolvedApprovals.push(record)

		this.addAuditEntry({
			actor: rejectedBy,
			action: `Rejected: ${record.actionDescription}`,
			riskLevel: record.riskLevel,
			result: "denied",
			details: `Rejected by ${rejectedBy}. Reason: ${reason}`,
		})

		this.emitChange()
		return record
	}

	/**
	 * Gate an action: check if the actor's tier permits it and whether
	 * the risk level requires approval. Returns an object describing
	 * whether the action is allowed, needs approval, or is blocked.
	 */
	gateAction(
		actionId: string,
		actor: string,
		riskScore: number,
	): { allowed: boolean; needsApproval: boolean; blocked: boolean; reason: string } {
		const dangerousAction = this.state.dangerousActions.find((a) => a.id === actionId)

		if (dangerousAction) {
			// Blocked actions are never allowed
			if (dangerousAction.blocked) {
				this.addAuditEntry({
					actor,
					action: dangerousAction.name,
					riskLevel: this.classifyRisk(riskScore),
					result: "blocked",
					details: `Action "${dangerousAction.name}" is blocked`,
				})
				this.emitChange()
				return {
					allowed: false,
					needsApproval: false,
					blocked: true,
					reason: `Action "${dangerousAction.name}" is currently blocked`,
				}
			}

			// Check tier
			const actorTier = this.getUserTier(actor)
			const requiredLevel = tierLevel(dangerousAction.minimumTier)
			if (actorTier.level < requiredLevel) {
				this.addAuditEntry({
					actor,
					action: dangerousAction.name,
					riskLevel: this.classifyRisk(riskScore),
					result: "denied",
					details: `Insufficient tier: "${actorTier.name}" < "${dangerousAction.minimumTier}"`,
				})
				this.emitChange()
				return {
					allowed: false,
					needsApproval: false,
					blocked: false,
					reason: `Requires tier "${dangerousAction.minimumTier}", actor has "${actorTier.name}"`,
				}
			}

			// Critical-severity actions require SuperAdmin approval even if actor is Admin
			if (dangerousAction.severity === "critical" && actorTier.name !== "superadmin") {
				return {
					allowed: false,
					needsApproval: true,
					blocked: false,
					reason: `Critical-severity action "${dangerousAction.name}" requires SuperAdmin approval`,
				}
			}

			// Check if approval is required
			if (dangerousAction.requiresApproval) {
				return {
					allowed: false,
					needsApproval: true,
					blocked: false,
					reason: `Action "${dangerousAction.name}" requires approval`,
				}
			}
		}

		// Non-registered actions: gate by risk level
		const riskLevel = this.classifyRisk(riskScore)
		if (riskLevel === "critical") {
			return {
				allowed: false,
				needsApproval: true,
				blocked: false,
				reason: "Critical risk actions always require approval",
			}
		}
		if (riskLevel === "high") {
			const actorTier = this.getUserTier(actor)
			if (actorTier.level < tierLevel("admin")) {
				return {
					allowed: false,
					needsApproval: true,
					blocked: false,
					reason: "High risk actions require admin tier or approval",
				}
			}
		}

		return { allowed: true, needsApproval: false, blocked: false, reason: "Action permitted" }
	}

	// ── Escalation ────────────────────────────────────

	/**
	 * Check all pending approvals for escalation.
	 * Any pending approval older than `escalationConfig.timeoutMs` is
	 * marked as escalated and an audit entry is logged.
	 */
	checkEscalation(): ApprovalRecord[] {
		const now = Date.now()
		const escalated: ApprovalRecord[] = []

		for (const record of this.state.pendingApprovals) {
			if (!record.escalated && now - record.timestamp >= this.escalationConfig.timeoutMs) {
				record.escalated = true
				escalated.push(record)

				this.addAuditEntry({
					actor: "system",
					action: `Escalated: ${record.actionDescription}`,
					riskLevel: record.riskLevel,
					result: "auto",
					details: `Approval "${record.id}" escalated to ${this.escalationConfig.escalationTier} after ${this.escalationConfig.timeoutMs}ms timeout`,
				})
			}
		}

		if (escalated.length > 0) {
			this.emitChange()
		}

		return escalated
	}

	/**
	 * Start the escalation timer that checks pending approvals every 60 seconds.
	 * If the timer is already running, this is a no-op.
	 */
	private startEscalationTimer(): void {
		if (this.escalationTimer) {
			return
		}
		this.escalationTimer = setInterval(() => {
			this.checkEscalation()
		}, 60_000)
	}

	// ── Dangerous Action Registry ──────────────────────

	getDangerousActions(): DangerousAction[] {
		return this.state.dangerousActions.slice()
	}

	addDangerousAction(action: Omit<DangerousAction, "id">): DangerousAction {
		const entry: DangerousAction = {
			id: generateId(),
			...action,
		}
		this.log.info("New dangerous action registered", { id: entry.id, name: entry.name, severity: entry.severity, minimumTier: entry.minimumTier })
		this.state.dangerousActions.push(entry)

		this.addAuditEntry({
			actor: "system",
			action: `Registered dangerous action: ${entry.name}`,
			riskLevel: "medium",
			result: "auto",
			details: `New dangerous action "${entry.name}" registered (min tier: ${entry.minimumTier}, approval: ${entry.requiresApproval})`,
		})

		this.emitChange()
		return entry
	}

	toggleActionBlock(actionId: string, blocked: boolean): DangerousAction | undefined {
		const action = this.state.dangerousActions.find((a) => a.id === actionId)
		if (!action) return undefined

		action.blocked = blocked

		this.addAuditEntry({
			actor: "system",
			action: `${blocked ? "Blocked" : "Unblocked"} action: ${action.name}`,
			riskLevel: "high",
			result: "auto",
			details: `Action "${action.name}" ${blocked ? "blocked" : "unblocked"}`,
		})

		this.emitChange()
		return { ...action }
	}

	// ── Audit Log ──────────────────────────────────────

	private addAuditEntry(entry: Omit<AuditEntry, "id" | "timestamp">): void {
		const full: AuditEntry = {
			id: generateId(),
			timestamp: Date.now(),
			...entry,
		}
		this.state.auditLog.unshift(full)

		// Keep only the last 1000 entries to prevent unbounded growth
		if (this.state.auditLog.length > 1000) {
			this.state.auditLog = this.state.auditLog.slice(0, 1000)
		}
	}

	getAuditLog(options?: {
		limit?: number
		actor?: string
		riskLevel?: AuditEntry["riskLevel"]
		result?: AuditEntry["result"]
		startDate?: number
		endDate?: number
		search?: string
	}): AuditEntry[] {
		let entries = this.state.auditLog.slice()

		if (options?.actor) {
			const actor = options.actor.toLowerCase()
			entries = entries.filter((e) => e.actor.toLowerCase().includes(actor))
		}
		if (options?.riskLevel) {
			entries = entries.filter((e) => e.riskLevel === options.riskLevel)
		}
		if (options?.result) {
			entries = entries.filter((e) => e.result === options.result)
		}
		if (options?.startDate) {
			entries = entries.filter((e) => e.timestamp >= options.startDate!)
		}
		if (options?.endDate) {
			entries = entries.filter((e) => e.timestamp <= options.endDate!)
		}
		if (options?.search) {
			const q = options.search.toLowerCase()
			entries = entries.filter(
				(e) =>
					e.action.toLowerCase().includes(q) ||
					e.details.toLowerCase().includes(q) ||
					e.actor.toLowerCase().includes(q),
			)
		}

		const limit = options?.limit ?? 100
		return entries.slice(0, limit)
	}

	exportAuditLog(): string {
		return JSON.stringify(this.state.auditLog, null, 2)
	}

	/**
	 * Export audit log entries as JSONL (JSON Lines) format.
	 * Each line is a self-contained JSON object matching the run ledger format:
	 * `{ id, ts, actor, action, risk, result, details }`
	 */
	exportAuditLogAsJsonl(): string {
		return this.state.auditLog
			.map((entry) =>
				JSON.stringify({
					id: entry.id,
					ts: entry.timestamp,
					actor: entry.actor,
					action: entry.action,
					risk: entry.riskLevel,
					result: entry.result,
					details: entry.details,
				}),
			)
			.join("\n")
	}

	// ── Release Verdicts ───────────────────────────────

	getReleaseVerdicts(): ReleaseVerdict[] {
		return this.state.releaseVerdicts.slice()
	}

	getLatestVerdict(): ReleaseVerdict | undefined {
		if (this.state.releaseVerdicts.length === 0) return undefined
		return { ...this.state.releaseVerdicts[this.state.releaseVerdicts.length - 1] }
	}

	createReleaseVerdict(
		scope: string,
		criticalDefects: number,
		highDefects: number,
		riskSummary: string,
		rollbackPlan: string,
		decision: ReleaseVerdict["decision"],
	): ReleaseVerdict {
		const verdict: ReleaseVerdict = {
			id: generateId(),
			scope,
			criticalDefects,
			highDefects,
			riskSummary,
			rollbackPlan,
			decision,
			timestamp: Date.now(),
		}
		this.state.releaseVerdicts.push(verdict)

		const decisionLabel = decision === "pass" ? "PASS" : decision === "conditional_pass" ? "CONDITIONAL PASS" : "FAIL"

		this.addAuditEntry({
			actor: "system",
			action: `Release verdict: ${decisionLabel}`,
			riskLevel: decision === "fail" ? "critical" : decision === "conditional_pass" ? "high" : "low",
			result: decision === "fail" ? "denied" : "approved",
			details: `Scope: ${scope}. Critical: ${criticalDefects}, High: ${highDefects}. Decision: ${decisionLabel}`,
		})

		this.emitChange()
		return verdict
	}

	/**
	 * Determine if the system is rollback-ready based on whether the
	 * latest verdict includes a non-empty rollback plan.
	 */
	isRollbackReady(): boolean {
		const latest = this.getLatestVerdict()
		if (!latest) return false
		return latest.rollbackPlan.trim().length > 0
	}

	// ── Release Checklist ──────────────────────────────

	/**
	 * Generate a release checklist based on current governance state.
	 * Returns items with their pass/fail status.
	 */
	getReleaseChecklist(): Array<{ label: string; passed: boolean }> {
		const pending = this.state.pendingApprovals.length
		const blockedActions = this.state.dangerousActions.filter((a) => a.blocked).length
		const latestVerdict = this.getLatestVerdict()
		const rollbackReady = this.isRollbackReady()

		// Check if an adversarial audit has passed by looking at recent audit entries
		const adversarialAuditPassed = this.state.auditLog.some(
			(e) => e.action.includes("Adversarial audit completed") && e.result === "approved",
		)

		return [
			{
				label: "No pending approvals",
				passed: pending === 0,
			},
			{
				label: "No blocked dangerous actions",
				passed: blockedActions === 0,
			},
			{
				label: "Release verdict exists",
				passed: latestVerdict !== undefined,
			},
			{
				label: "Release verdict is not FAIL",
				passed: latestVerdict !== undefined && latestVerdict.decision !== "fail",
			},
			{
				label: "Zero critical defects",
				passed: latestVerdict !== undefined && latestVerdict.criticalDefects === 0,
			},
			{
				label: "Rollback plan documented",
				passed: rollbackReady,
			},
			{
				label: "Adversarial audit passed",
				passed: adversarialAuditPassed,
			},
		]
	}

	/**
	 * Compute the overall release readiness verdict from the checklist.
	 */
	computeReleaseReadiness(): "pass" | "conditional_pass" | "fail" {
		const checklist = this.getReleaseChecklist()
		const failed = checklist.filter((c) => !c.passed)
		if (failed.length === 0) return "pass"

		// Critical failures that prevent any release
		const criticalLabels = ["Release verdict is not FAIL", "Zero critical defects"]
		const hasCriticalFailure = failed.some((f) => criticalLabels.includes(f.label))
		if (hasCriticalFailure) return "fail"

		return "conditional_pass"
	}

	// ── Subsystem Registration ─────────────────────────

	registerSubsystem(name: string, status: "active" | "degraded" | "inactive"): void {
		this.log.debug("Subsystem registration", { name, status })
		const entry: RegisteredSubsystem = {
			name,
			status,
			registeredAt: Date.now(),
		}
		this.registeredSubsystems.set(name, entry)

		this.addAuditEntry({
			actor: "system",
			action: `Registered subsystem: ${name}`,
			riskLevel: "low",
			result: "auto",
			details: `Subsystem "${name}" registered with status "${status}"`,
		})

		this.emitChange()
	}

	getRegisteredSubsystems(): Array<{ name: string; status: string; registeredAt: number }> {
		return Array.from(this.registeredSubsystems.values()).map((entry) => ({
			name: entry.name,
			status: entry.status,
			registeredAt: entry.registeredAt,
		}))
	}

	// ── Evidence Bundles ────────────────────────────────

	createEvidenceBundle(block: string): EvidenceBundle {
		const bundle: EvidenceBundle = {
			bundleId: crypto.randomUUID(),
			block,
			createdAt: Date.now(),
			items: [],
			status: "collecting",
		}
		this.evidenceBundles.set(bundle.bundleId, bundle)

		this.addAuditEntry({
			actor: "system",
			action: `Created evidence bundle for block: ${block}`,
			riskLevel: "low",
			result: "auto",
			details: `Evidence bundle "${bundle.bundleId}" created for block "${block}"`,
		})

		this.emitChange()
		return { ...bundle, items: [...bundle.items] }
	}

	addEvidence(bundleId: string, item: Omit<EvidenceItem, "capturedAt">): void {
		const bundle = this.evidenceBundles.get(bundleId)
		if (!bundle) {
			throw new Error(`Evidence bundle "${bundleId}" not found`)
		}
		if (bundle.status === "verified") {
			throw new Error(`Evidence bundle "${bundleId}" is already verified and cannot be modified`)
		}

		const fullItem: EvidenceItem = {
			...item,
			capturedAt: Date.now(),
		}
		bundle.items.push(fullItem)

		this.addAuditEntry({
			actor: "system",
			action: `Added evidence to bundle: ${bundleId}`,
			riskLevel: "low",
			result: "auto",
			details: `Evidence item of type "${item.type}" added: ${item.description}`,
		})

		this.emitChange()
	}

	getEvidenceBundles(): EvidenceBundle[] {
		return Array.from(this.evidenceBundles.values()).map((bundle) => ({
			...bundle,
			items: bundle.items.map((i) => ({ ...i })),
		}))
	}

	verifyEvidenceBundle(bundleId: string): { complete: boolean; missing: string[] } {
		const bundle = this.evidenceBundles.get(bundleId)
		if (!bundle) {
			throw new Error(`Evidence bundle "${bundleId}" not found`)
		}

		const requiredTypes: EvidenceItem["type"][] = ["screenshot", "log", "trace", "config", "test_result"]
		const presentTypes = new Set(bundle.items.map((i) => i.type))
		const missing: string[] = []

		for (const required of requiredTypes) {
			if (!presentTypes.has(required)) {
				missing.push(required)
			}
		}

		const complete = missing.length === 0
		if (complete) {
			bundle.status = "verified"
		} else {
			bundle.status = "complete"
		}

		this.addAuditEntry({
			actor: "system",
			action: `Verified evidence bundle: ${bundleId}`,
			riskLevel: "low",
			result: complete ? "approved" : "denied",
			details: complete
				? `Evidence bundle "${bundleId}" verified successfully`
				: `Evidence bundle "${bundleId}" missing evidence types: ${missing.join(", ")}`,
		})

		this.emitChange()
		return { complete, missing }
	}

	// ── Adversarial Audit ──────────────────────────────

	// eslint-disable-next-line complexity
	runAdversarialAudit(): AdversarialAuditResult {
		const auditId = crypto.randomUUID()
		const subsystemResults: SubsystemAuditResult[] = []
		const criticalFindings: string[] = []
		const recommendations: string[] = []

		// Define the 7 expected subsystems and their audit criteria
		const expectedSubsystems = [
			"governance",
			"ssh",
			"vps",
			"zeroClaw",
			"routing",
			"memory",
			"training",
			"workstation",
			"hermes",
			"speech",
		]

		// Weight map for subsystem importance (must sum to 1.0)
		const subsystemWeights: Record<string, number> = {
			governance: 0.25,
			hermes: 0.15,
			speech: 0.10,
			security: 0.20,
			telemetry: 0.10,
			configuration: 0.10,
			diagnostics: 0.10,
		}

		for (const subsystemName of expectedSubsystems) {
			const findings: AuditFinding[] = []
			let score = 100
			const registered = this.registeredSubsystems.get(subsystemName)

			// Check 1: Service exists and is registered
			if (!registered) {
				score -= 40
				findings.push({
					severity: "critical",
					category: "registration",
					description: `Subsystem "${subsystemName}" is not registered`,
					subsystem: subsystemName,
					recommendation: `Register the "${subsystemName}" subsystem via registerSubsystem()`,
				})
			} else if (registered.status === "inactive") {
				score -= 30
				findings.push({
					severity: "high",
					category: "availability",
					description: `Subsystem "${subsystemName}" is registered but inactive`,
					subsystem: subsystemName,
					recommendation: `Activate the "${subsystemName}" subsystem or investigate why it is inactive`,
				})
			} else if (registered.status === "degraded") {
				score -= 15
				findings.push({
					severity: "medium",
					category: "availability",
					description: `Subsystem "${subsystemName}" is in degraded state`,
					subsystem: subsystemName,
					recommendation: `Investigate and resolve degraded state for "${subsystemName}"`,
				})
			}

			// Check 2: Error handling — look for audit entries indicating errors
			const errorEntries = this.state.auditLog.filter(
				(e) =>
					e.action.toLowerCase().includes(subsystemName) &&
					(e.result === "denied" || e.result === "blocked"),
			)
			if (registered && errorEntries.length === 0) {
				// No error patterns observed — may indicate insufficient error handling coverage
				score -= 5
				findings.push({
					severity: "low",
					category: "error_handling",
					description: `No error-handling audit trail found for "${subsystemName}"`,
					subsystem: subsystemName,
					recommendation: `Verify that "${subsystemName}" has proper error handling and logs failures to the audit trail`,
				})
			}

			// Check 3: Audit trail coverage
			const auditEntries = this.state.auditLog.filter((e) =>
				e.action.toLowerCase().includes(subsystemName) || e.details.toLowerCase().includes(subsystemName),
			)
			if (registered && auditEntries.length === 0) {
				score -= 15
				findings.push({
					severity: "high",
					category: "audit_coverage",
					description: `No audit trail entries found for "${subsystemName}"`,
					subsystem: subsystemName,
					recommendation: `Ensure "${subsystemName}" operations are logged to the governance audit trail`,
				})
			}

			// Check 4: Failure mode handling — check for evidence bundles
			const hasEvidence = Array.from(this.evidenceBundles.values()).some(
				(b) => b.block.toLowerCase().includes(subsystemName),
			)
			if (registered && !hasEvidence) {
				score -= 10
				findings.push({
					severity: "medium",
					category: "failure_modes",
					description: `No evidence bundle found for "${subsystemName}"`,
					subsystem: subsystemName,
					recommendation: `Create an evidence bundle documenting failure modes and recovery procedures for "${subsystemName}"`,
				})
			}

			// Clamp score
			score = Math.max(0, Math.min(100, score))

			// Collect critical findings
			for (const finding of findings) {
				if (finding.severity === "critical") {
					criticalFindings.push(`[${subsystemName}] ${finding.description}`)
				}
				if (finding.severity === "critical" || finding.severity === "high") {
					recommendations.push(finding.recommendation)
				}
			}

			subsystemResults.push({
				name: subsystemName,
				score,
				findings,
				evidencePresent: hasEvidence,
			})
		}

		// Calculate weighted overall score
		let overallScore = 0
		for (const result of subsystemResults) {
			const weight = subsystemWeights[result.name] ?? (1 / expectedSubsystems.length)
			overallScore += result.score * weight
		}
		overallScore = Math.round(overallScore)

		// Determine verdict
		let verdict: AdversarialAuditResult["verdict"]
		if (criticalFindings.length > 0 || overallScore < 50) {
			verdict = "fail"
		} else if (overallScore < 80) {
			verdict = "conditional_pass"
		} else {
			verdict = "pass"
		}

		const auditResult: AdversarialAuditResult = {
			auditId,
			timestamp: Date.now(),
			subsystems: subsystemResults,
			overallScore,
			criticalFindings,
			recommendations,
			verdict,
		}

		this.addAuditEntry({
			actor: "system",
			action: `Adversarial audit completed: ${verdict.toUpperCase()}`,
			riskLevel: verdict === "fail" ? "critical" : verdict === "conditional_pass" ? "high" : "low",
			result: verdict === "fail" ? "denied" : "approved",
			details: `Audit ${auditId}: overall score ${overallScore}/100, ${criticalFindings.length} critical findings, verdict: ${verdict}`,
		})

		this.emitChange()
		return auditResult
	}

	// ── Final Release Verdict ──────────────────────────

	generateFinalVerdict(auditResult: AdversarialAuditResult): ReleaseVerdict {
		let decision: ReleaseVerdict["decision"]
		if (auditResult.verdict === "fail" || auditResult.overallScore < 50) {
			decision = "fail"
		} else if (auditResult.verdict === "conditional_pass" || auditResult.overallScore < 80) {
			decision = "conditional_pass"
		} else {
			decision = "pass"
		}

		const riskSummary = [
			`Adversarial audit score: ${auditResult.overallScore}/100`,
			`Critical findings: ${auditResult.criticalFindings.length}`,
			`Subsystems audited: ${auditResult.subsystems.length}`,
			auditResult.recommendations.length > 0
				? `Top recommendation: ${auditResult.recommendations[0]}`
				: "No outstanding recommendations",
		].join(". ")

		const rollbackPlan = decision === "fail"
			? "Release blocked — resolve all critical findings before proceeding"
			: "Standard rollback procedure: revert to previous stable release tag if post-deploy issues detected"

		return this.createReleaseVerdict(
			`adversarial-audit-${auditResult.auditId}`,
			auditResult.criticalFindings.length,
			auditResult.recommendations.length,
			riskSummary,
			rollbackPlan,
			decision,
		)
	}

	// ── Disposal ───────────────────────────────────────

	dispose(): void {
		if (this.saveTimer) {
			clearTimeout(this.saveTimer)
			this.saveTimer = undefined
		}
		if (this.escalationTimer) {
			clearInterval(this.escalationTimer)
			this.escalationTimer = undefined
		}
		// Final save on disposal
		this.persistNow()
		this.onStateChangedEmitter.dispose()
	}
}
