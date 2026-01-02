import { EventEmitter } from "events"
import * as vscode from "vscode"

export interface SecurityRule {
	id: string
	name: string
	description: string
	pattern: RegExp
	risk: "low" | "medium" | "high" | "critical"
	action: "allow" | "deny" | "require_approval"
	category: "file_system" | "network" | "system" | "data" | "execution"
}

export interface PermissionRequest {
	id: string
	type: "command" | "file_access" | "network" | "system"
	content: string
	risk: "low" | "medium" | "high" | "critical"
	category: string
	timestamp: number
	requester: "ai_agent" | "user" | "system"
	context?: string
	suggestions?: string[]
}

export interface PermissionResponse {
	requestId: string
	approved: boolean
	reason?: string
	rememberChoice?: boolean
	applyToAll?: boolean
}

export interface SecurityPolicy {
	allowAutoApproval: boolean
	requireApprovalForHighRisk: boolean
	blockCriticalRisk: boolean
	rememberUserChoices: boolean
	maxApprovalTime: number
	allowedCommands: string[]
	deniedCommands: string[]
	trustedWorkspaces: string[]
}

/**
 * Security & Human-in-the-Loop Permission Gate
 * Provides security controls and user approval mechanisms for AI agent actions
 */
export class SecurityPermissionGate extends EventEmitter {
	private activeRequests: Map<string, PermissionRequest> = new Map()
	private securityRules: SecurityRule[] = []
	private userChoices: Map<string, boolean> = new Map()
	private policy: SecurityPolicy = {
		allowAutoApproval: false,
		requireApprovalForHighRisk: true,
		blockCriticalRisk: true,
		rememberUserChoices: true,
		maxApprovalTime: 300000, // 5 minutes
		allowedCommands: [],
		deniedCommands: [],
		trustedWorkspaces: [],
	}
	private isEnabled = true

	constructor(private outputChannel: vscode.OutputChannel) {
		super()
		this.initializeSecurityRules()
		this.loadSecurityPolicy()
	}

	private initializeSecurityRules(): void {
		this.securityRules = [
			// File system rules
			{
				id: "fs_rm_rf",
				name: "Recursive Delete",
				description: "Recursive file deletion commands",
				pattern: /rm\s+-rf|--recursive|--force/i,
				risk: "critical",
				action: "require_approval",
				category: "file_system",
			},
			{
				id: "fs_system_modify",
				name: "System File Modification",
				description: "Modifying system files or directories",
				pattern: /\/(etc|bin|sbin|usr|lib|sys|proc|dev)\//i,
				risk: "high",
				action: "require_approval",
				category: "file_system",
			},
			{
				id: "fs_sensitive_access",
				name: "Sensitive File Access",
				description: "Accessing sensitive files like keys or passwords",
				pattern: /\.(key|pem|p12|pfx|gpg|ssh|rsa|dsa|ecdsa)$/i,
				risk: "high",
				action: "require_approval",
				category: "file_system",
			},

			// Network rules
			{
				id: "net_port_binding",
				name: "Port Binding",
				description: "Binding to network ports below 1024",
				pattern: /:(\d{1,3}|0x[0-9a-f]{1,3})\b/i,
				risk: "medium",
				action: "require_approval",
				category: "network",
			},
			{
				id: "net_external_connect",
				name: "External Network Connection",
				description: "Connecting to external network addresses",
				pattern: /(curl|wget|nc|telnet|ssh)\s+https?:\/\/[^\\s]+/i,
				risk: "medium",
				action: "require_approval",
				category: "network",
			},

			// System rules
			{
				id: "sys_package_install",
				name: "Package Installation",
				description: "Installing system packages",
				pattern: /(apt|yum|dnf|pacman|brew|pip|npm)\s+(install|update|upgrade)/i,
				risk: "medium",
				action: "require_approval",
				category: "system",
			},
			{
				id: "sys_service_control",
				name: "Service Control",
				description: "Starting/stopping system services",
				pattern: /(systemctl|service|svsup|launchctl)\s+(start|stop|restart|enable|disable)/i,
				risk: "high",
				action: "require_approval",
				category: "system",
			},
			{
				id: "sys_user_management",
				name: "User Management",
				description: "User account management commands",
				pattern: /(useradd|usermod|userdel|passwd|su|sudo)/i,
				risk: "high",
				action: "require_approval",
				category: "system",
			},

			// Data rules
			{
				id: "data_database_ops",
				name: "Database Operations",
				description: "Database modification operations",
				pattern: /(drop\s+database|truncate\s+table|delete\s+from.*where\s+1\s*=\s*1)/i,
				risk: "high",
				action: "require_approval",
				category: "data",
			},
			{
				id: "data_large_transfer",
				name: "Large Data Transfer",
				description: "Commands that might transfer large amounts of data",
				pattern: /(dd|rsync|scp|ftp|sftp)/i,
				risk: "medium",
				action: "require_approval",
				category: "data",
			},

			// Execution rules
			{
				id: "exec_unknown_binary",
				name: "Unknown Binary Execution",
				description: "Executing binaries from non-standard paths",
				pattern: /\.\/[a-zA-Z0-9_-]+(\.exe|\.sh|\.py|\.js|\.rb|\.php)?$/i,
				risk: "medium",
				action: "require_approval",
				category: "execution",
			},
		]
	}

	private loadSecurityPolicy(): void {
		// Load policy from VSCode settings or use defaults
		this.policy = {
			allowAutoApproval: false,
			requireApprovalForHighRisk: true,
			blockCriticalRisk: true,
			rememberUserChoices: true,
			maxApprovalTime: 300000, // 5 minutes
			allowedCommands: [],
			deniedCommands: [],
			trustedWorkspaces: [],
		}
	}

	/**
	 * Check if an action requires approval
	 */
	public async checkApproval(
		content: string,
		type: "command" | "file_access" | "network" | "system" = "command",
		requester: "ai_agent" | "user" | "system" = "ai_agent",
		context?: string,
	): Promise<{ approved: boolean; reason?: string }> {
		if (!this.isEnabled) {
			return { approved: true, reason: "Security gate disabled" }
		}

		// Check against security rules
		const matchingRule = this.findMatchingRule(content)
		if (!matchingRule) {
			return { approved: true, reason: "No security rules matched" }
		}

		// Check policy for this risk level
		if (matchingRule.risk === "critical" && this.policy.blockCriticalRisk) {
			return { approved: false, reason: `Critical risk action blocked: ${matchingRule.name}` }
		}

		if (matchingRule.risk === "high" && this.policy.requireApprovalForHighRisk) {
			return await this.requestApproval(content, type, matchingRule, requester, context)
		}

		if (matchingRule.action === "deny") {
			return { approved: false, reason: `Action denied by security rule: ${matchingRule.name}` }
		}

		if (matchingRule.action === "require_approval") {
			return await this.requestApproval(content, type, matchingRule, requester, context)
		}

		return { approved: true, reason: `Allowed by security rule: ${matchingRule.name}` }
	}

	/**
	 * Find matching security rule for content
	 */
	private findMatchingRule(content: string): SecurityRule | null {
		for (const rule of this.securityRules) {
			if (rule.pattern.test(content)) {
				return rule
			}
		}
		return null
	}

	/**
	 * Request user approval for an action
	 */
	private async requestApproval(
		content: string,
		type: "command" | "file_access" | "network" | "system",
		rule: SecurityRule,
		requester: "ai_agent" | "user" | "system",
		context?: string,
	): Promise<{ approved: boolean; reason?: string }> {
		const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

		const request: PermissionRequest = {
			id: requestId,
			type,
			content,
			risk: rule.risk,
			category: rule.category,
			timestamp: Date.now(),
			requester,
			context,
			suggestions: this.generateSuggestions(rule, content),
		}

		this.activeRequests.set(requestId, request)
		this.emit("approvalRequested", request)

		this.outputChannel.appendLine(
			`[Security Gate] Approval required for ${rule.risk} risk ${rule.category}: ${rule.name}`,
		)

		try {
			const response = await this.showApprovalDialog(request)

			if (response.approved && response.rememberChoice) {
				this.userChoices.set(rule.id, true)
			}

			this.activeRequests.delete(requestId)
			this.emit("approvalResponded", { request, response })

			return {
				approved: response.approved,
				reason: response.reason || (response.approved ? "User approved" : "User denied"),
			}
		} catch (error) {
			this.activeRequests.delete(requestId)
			return { approved: false, reason: `Approval request failed: ${error}` }
		}
	}

	/**
	 * Show approval dialog to user
	 */
	private async showApprovalDialog(request: PermissionRequest): Promise<PermissionResponse> {
		const riskEmoji = {
			low: "🟢",
			medium: "🟡",
			high: "🟠",
			critical: "🔴",
		}

		const quickPickItems = [
			{
				label: `${riskEmoji[request.risk]} Allow`,
				description: "Approve this action",
				action: "allow" as const,
			},
			{
				label: `${riskEmoji[request.risk]} Deny`,
				description: "Block this action",
				action: "deny" as const,
			},
			{
				label: "🔍 View Details",
				description: "Show more information about this request",
				action: "details" as const,
			},
		]

		const choice = await vscode.window.showQuickPick(quickPickItems, {
			title: "Kilo Code - Security Approval Required",
			placeHolder: `Action: ${request.content.substring(0, 50)}${request.content.length > 50 ? "..." : ""}`,
			ignoreFocusOut: true,
		})

		if (!choice) {
			return { requestId: request.id, approved: false, reason: "User cancelled" }
		}

		switch (choice.action) {
			case "allow": {
				const rememberChoice = await vscode.window.showQuickPick(
					[
						{ label: "Allow Once", description: "Approve only this time" },
						{ label: "Always Allow", description: "Remember this choice for future actions" },
					],
					{ placeHolder: "Remember choice?" },
				)

				return {
					requestId: request.id,
					approved: true,
					reason: "User approved",
					rememberChoice: rememberChoice?.label === "Always Allow",
				}
			}

			case "deny": {
				const reason = await vscode.window.showInputBox({
					prompt: "Optional: Reason for denial",
					placeHolder: "Enter reason (optional)",
				})

				return {
					requestId: request.id,
					approved: false,
					reason: reason || "User denied",
				}
			}

			case "details": {
				await this.showDetailedApprovalDialog(request)
				return await this.showApprovalDialog(request) // Recursively show main dialog
			}

			default:
				return { requestId: request.id, approved: false, reason: "Unknown action" }
		}
	}

	/**
	 * Show detailed approval dialog
	 */
	private async showDetailedApprovalDialog(request: PermissionRequest): Promise<void> {
		const details = [
			`**Action:** ${request.content}`,
			`**Type:** ${request.type}`,
			`**Risk Level:** ${request.risk.toUpperCase()}`,
			`**Category:** ${request.category}`,
			`**Requester:** ${request.requester}`,
			`**Time:** ${new Date(request.timestamp).toLocaleString()}`,
		]

		if (request.context) {
			details.push(`**Context:** ${request.context}`)
		}

		if (request.suggestions && request.suggestions.length > 0) {
			details.push(`**Suggestions:**`)
			details.push(...request.suggestions.map((s) => `- ${s}`))
		}

		const message = details.join("\n\n")

		await vscode.window.showInformationMessage(message, { modal: true }, "OK")
	}

	/**
	 * Generate safety suggestions for a rule
	 */
	private generateSuggestions(rule: SecurityRule, content: string): string[] {
		const suggestions: string[] = []

		switch (rule.id) {
			case "fs_rm_rf":
				suggestions.push("Consider using specific file deletion instead of recursive")
				suggestions.push("Verify the target path is correct")
				suggestions.push("Backup important data before deletion")
				break

			case "sys_package_install":
				suggestions.push("Use virtual environments when possible")
				suggestions.push("Verify package source and integrity")
				suggestions.push("Check for alternative package managers")
				break

			case "net_external_connect":
				suggestions.push("Verify the external server is trusted")
				suggestions.push("Use HTTPS when available")
				suggestions.push("Consider using VPN for secure connections")
				break

			case "data_database_ops":
				suggestions.push("Create database backup before modifications")
				suggestions.push("Test operations on development database first")
				suggestions.push("Use transactions for data consistency")
				break

			default:
				suggestions.push("Review the command carefully before execution")
				suggestions.push("Consider safer alternatives if available")
				suggestions.push("Ensure you have backups of important data")
				break
		}

		return suggestions
	}

	/**
	 * Get active approval requests
	 */
	public getActiveRequests(): PermissionRequest[] {
		return Array.from(this.activeRequests.values())
	}

	/**
	 * Cancel an approval request
	 */
	public cancelRequest(requestId: string): boolean {
		const request = this.activeRequests.get(requestId)
		if (request) {
			this.activeRequests.delete(requestId)
			this.emit("requestCancelled", request)
			return true
		}
		return false
	}

	/**
	 * Update security policy
	 */
	public updatePolicy(updates: Partial<SecurityPolicy>): void {
		this.policy = { ...this.policy, ...updates }
		this.emit("policyUpdated", this.policy)
		this.outputChannel.appendLine("[Security Gate] Security policy updated")
	}

	/**
	 * Get current security policy
	 */
	public getPolicy(): SecurityPolicy {
		return { ...this.policy }
	}

	/**
	 * Add custom security rule
	 */
	public addSecurityRule(rule: SecurityRule): void {
		this.securityRules.push(rule)
		this.emit("ruleAdded", rule)
		this.outputChannel.appendLine(`[Security Gate] Added security rule: ${rule.name}`)
	}

	/**
	 * Remove security rule
	 */
	public removeSecurityRule(ruleId: string): boolean {
		const index = this.securityRules.findIndex((r) => r.id === ruleId)
		if (index >= 0) {
			const rule = this.securityRules.splice(index, 1)[0]
			this.emit("ruleRemoved", rule)
			this.outputChannel.appendLine(`[Security Gate] Removed security rule: ${rule.name}`)
			return true
		}
		return false
	}

	/**
	 * Get all security rules
	 */
	public getSecurityRules(): SecurityRule[] {
		return [...this.securityRules]
	}

	/**
	 * Enable or disable the security gate
	 */
	public setEnabled(enabled: boolean): void {
		this.isEnabled = enabled
		this.emit("enabledChanged", enabled)
		this.outputChannel.appendLine(`[Security Gate] ${enabled ? "Enabled" : "Disabled"}`)
	}

	/**
	 * Check if security gate is enabled
	 */
	public isSecurityGateEnabled(): boolean {
		return this.isEnabled
	}

	/**
	 * Clear user choices
	 */
	public clearUserChoices(): void {
		this.userChoices.clear()
		this.emit("userChoicesCleared")
		this.outputChannel.appendLine("[Security Gate] Cleared user choice memory")
	}

	/**
	 * Get security statistics
	 */
	public getSecurityStats(): {
		totalRequests: number
		approvedRequests: number
		deniedRequests: number
		pendingRequests: number
		rulesCount: number
		userChoicesCount: number
	} {
		// This would track actual statistics over time
		// For now, return current state
		return {
			totalRequests: 0,
			approvedRequests: 0,
			deniedRequests: 0,
			pendingRequests: this.activeRequests.size,
			rulesCount: this.securityRules.length,
			userChoicesCount: this.userChoices.size,
		}
	}

	/**
	 * Dispose of the security gate
	 */
	public dispose(): void {
		this.removeAllListeners()
		this.activeRequests.clear()
		this.userChoices.clear()
	}
}
