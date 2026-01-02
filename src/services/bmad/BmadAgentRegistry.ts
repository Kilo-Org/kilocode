// kilocode_change - new file for BMAD-METHOD agent registry

import type { BmadAgent, BmadModule, AgentCapability, AgentTrigger } from "./types"
import { BmadIntegrationService } from "./BmadIntegrationService"
import { logger } from "../../utils/logging"
import { t } from "../../i18n"

/**
 * Agent metadata with runtime information
 */
export interface AgentMetadataExtended extends BmadAgent {
	// Runtime metadata
	registrationTime: Date
	lastUsedTime?: Date
	usageCount: number
	isActive: boolean
	customSettings?: Record<string, any>
}

/**
 * Agent search criteria
 */
export interface AgentSearchCriteria {
	moduleId?: string
	role?: string
	capability?: string
	keyword?: string
	isActive?: boolean
}

/**
 * Agent recommendation result
 */
export interface AgentRecommendation {
	agent: AgentMetadataExtended
	relevanceScore: number
	matchReasons: string[]
}

/**
 * BMAD agent registry
 * Manages the catalog and lifecycle of BMAD agents
 */
export class BmadAgentRegistry {
	private integrationService: BmadIntegrationService
	private agents: Map<string, AgentMetadataExtended> = new Map()
	private isInitialized = false

	constructor(integrationService: BmadIntegrationService) {
		this.integrationService = integrationService
	}

	/**
	 * Initialize the agent registry
	 */
	async initialize(): Promise<void> {
		try {
			if (this.isInitialized) {
				logger.warn("[BmadAgentRegistry] Already initialized")
				return
			}

			// Wait for integration service to be ready
			await this.integrationService.initialize()

			// Load all agents from modules
			await this.loadAgents()

			this.isInitialized = true
			logger.info("[BmadAgentRegistry] Initialized successfully", {
				totalAgents: this.agents.size,
			})
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadAgentRegistry] Failed to initialize", { error: errorMessage })
			throw new Error(`Failed to initialize BMAD agent registry: ${errorMessage}`)
		}
	}

	/**
	 * Load all agents from available modules
	 */
	private async loadAgents(): Promise<void> {
		const modules = this.integrationService.getAvailableModules()

		for (const module of modules) {
			const agents = this.integrationService.getModuleAgents(module.id)

			for (const agent of agents) {
				const extendedAgent: AgentMetadataExtended = {
					...agent,
					registrationTime: new Date(),
					usageCount: 0,
					isActive: true,
				}

				this.agents.set(agent.id, extendedAgent)
			}
		}
	}

	/**
	 * Get all registered agents
	 */
	getAllAgents(): AgentMetadataExtended[] {
		return Array.from(this.agents.values())
	}

	/**
	 * Get an agent by ID
	 */
	getAgentById(agentId: string): AgentMetadataExtended | undefined {
		return this.agents.get(agentId)
	}

	/**
	 * Get agents by module
	 */
	getAgentsByModule(moduleId: string): AgentMetadataExtended[] {
		return this.getAllAgents().filter((agent) => agent.moduleId === moduleId)
	}

	/**
	 * Get agents by role
	 */
	getAgentsByRole(role: string): AgentMetadataExtended[] {
		return this.getAllAgents().filter((agent) => agent.role.toLowerCase() === role.toLowerCase())
	}

	/**
	 * Get agents with specific capability
	 */
	getAgentsByCapability(capabilityName: string): AgentMetadataExtended[] {
		return this.getAllAgents().filter((agent) =>
			agent.capabilities?.some((cap) => cap.name.toLowerCase() === capabilityName.toLowerCase()),
		)
	}

	/**
	 * Search agents based on criteria
	 */
	searchAgents(criteria: AgentSearchCriteria): AgentMetadataExtended[] {
		let results = this.getAllAgents()

		if (criteria.moduleId) {
			results = results.filter((agent) => agent.moduleId === criteria.moduleId)
		}

		if (criteria.role) {
			results = results.filter((agent) => agent.role.toLowerCase().includes(criteria.role!.toLowerCase()))
		}

		if (criteria.capability) {
			results = results.filter((agent) =>
				agent.capabilities?.some((cap) => cap.name.toLowerCase().includes(criteria.capability!.toLowerCase())),
			)
		}

		if (criteria.keyword) {
			const keyword = criteria.keyword.toLowerCase()
			results = results.filter(
				(agent) =>
					agent.name.toLowerCase().includes(keyword) ||
					agent.role.toLowerCase().includes(keyword) ||
					agent.identity?.toLowerCase().includes(keyword) ||
					agent.capabilities?.some((cap) => cap.name.toLowerCase().includes(keyword)),
			)
		}

		if (criteria.isActive !== undefined) {
			results = results.filter((agent) => agent.isActive === criteria.isActive)
		}

		return results
	}

	/**
	 * Recommend agents for a task
	 */
	recommendAgents(taskDescription: string, limit: number = 5): AgentRecommendation[] {
		const keywords = taskDescription.toLowerCase().split(/\s+/)
		const recommendations: AgentRecommendation[] = []

		for (const agent of this.agents.values()) {
			if (!agent.isActive) continue

			let score = 0
			const matchReasons: string[] = []

			// Check role match
			const role = agent.role.toLowerCase()
			keywords.forEach((keyword) => {
				if (role.includes(keyword)) {
					score += 3
					matchReasons.push(`Role matches "${keyword}"`)
				}
			})

			// Check capabilities
			if (agent.capabilities) {
				agent.capabilities.forEach((capability) => {
					const capabilityText = `${capability.name} ${capability.description}`.toLowerCase()
					keywords.forEach((keyword) => {
						if (capabilityText.includes(keyword)) {
							score += 2
							matchReasons.push(`Capability: ${capability.name}`)
						}
					})
				})
			}

			// Check identity
			if (agent.identity) {
				const identity = agent.identity.toLowerCase()
				keywords.forEach((keyword) => {
					if (identity.includes(keyword)) {
						score += 1
						matchReasons.push(`Identity matches "${keyword}"`)
					}
				})
			}

			// Check triggers
			if (agent.triggers) {
				agent.triggers.forEach((trigger) => {
					const triggerText = trigger.trigger.toLowerCase()
					keywords.forEach((keyword) => {
						if (triggerText.includes(keyword)) {
							score += 2
							matchReasons.push(`Trigger pattern matches`)
						}
					})
				})
			}

			if (score > 0) {
				recommendations.push({
					agent,
					relevanceScore: score,
					matchReasons,
				})
			}
		}

		// Sort by score (highest first) and limit results
		return recommendations.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, limit)
	}

	/**
	 * Check if an agent should be triggered by a message
	 */
	shouldTriggerAgent(agentId: string, message: string): boolean {
		const agent = this.getAgentById(agentId)
		if (!agent || !agent.isActive || !agent.triggers) {
			return false
		}

		const lowerMessage = message.toLowerCase()
		return agent.triggers.some((trigger) => lowerMessage.includes(trigger.trigger.toLowerCase()))
	}

	/**
	 * Get agents that should be triggered by a message
	 */
	getTriggeredAgents(message: string): AgentMetadataExtended[] {
		return this.getAllAgents().filter((agent) => this.shouldTriggerAgent(agent.id, message))
	}

	/**
	 * Record agent usage
	 */
	recordAgentUsage(agentId: string): void {
		const agent = this.agents.get(agentId)
		if (agent) {
			agent.lastUsedTime = new Date()
			agent.usageCount++
			logger.debug("[BmadAgentRegistry] Recorded agent usage", { agentId, usageCount: agent.usageCount })
		}
	}

	/**
	 * Get agent usage statistics
	 */
	getAgentUsageStats(agentId: string): {
		usageCount: number
		lastUsedTime?: Date
		registrationTime: Date
	} | null {
		const agent = this.agents.get(agentId)
		if (!agent) return null

		return {
			usageCount: agent.usageCount,
			lastUsedTime: agent.lastUsedTime,
			registrationTime: agent.registrationTime,
		}
	}

	/**
	 * Get most used agents
	 */
	getMostUsedAgents(limit: number = 10): AgentMetadataExtended[] {
		return this.getAllAgents()
			.filter((agent) => agent.usageCount > 0)
			.sort((a, b) => b.usageCount - a.usageCount)
			.slice(0, limit)
	}

	/**
	 * Get recently used agents
	 */
	getRecentlyUsedAgents(limit: number = 5): AgentMetadataExtended[] {
		return this.getAllAgents()
			.filter((agent) => agent.lastUsedTime)
			.sort((a, b) => b.lastUsedTime!.getTime() - a.lastUsedTime!.getTime())
			.slice(0, limit)
	}

	/**
	 * Activate an agent
	 */
	activateAgent(agentId: string): boolean {
		const agent = this.agents.get(agentId)
		if (agent) {
			agent.isActive = true
			logger.info("[BmadAgentRegistry] Activated agent", { agentId })
			return true
		}
		return false
	}

	/**
	 * Deactivate an agent
	 */
	deactivateAgent(agentId: string): boolean {
		const agent = this.agents.get(agentId)
		if (agent) {
			agent.isActive = false
			logger.info("[BmadAgentRegistry] Deactivated agent", { agentId })
			return true
		}
		return false
	}

	/**
	 * Update agent custom settings
	 */
	updateAgentSettings(agentId: string, settings: Record<string, any>): boolean {
		const agent = this.agents.get(agentId)
		if (agent) {
			agent.customSettings = { ...agent.customSettings, ...settings }
			logger.info("[BmadAgentRegistry] Updated agent settings", { agentId })
			return true
		}
		return false
	}

	/**
	 * Get agent custom settings
	 */
	getAgentSettings(agentId: string): Record<string, any> | undefined {
		return this.agents.get(agentId)?.customSettings
	}

	/**
	 * Get all unique roles
	 */
	getAllRoles(): string[] {
		const roles = new Set<string>()
		this.getAllAgents().forEach((agent) => roles.add(agent.role))
		return Array.from(roles).sort()
	}

	/**
	 * Get all unique capabilities
	 */
	getAllCapabilities(): string[] {
		const capabilities = new Set<string>()
		this.getAllAgents().forEach((agent) => {
			agent.capabilities?.forEach((cap) => capabilities.add(cap.name))
		})
		return Array.from(capabilities).sort()
	}

	/**
	 * Get registry statistics
	 */
	getStatistics(): {
		totalAgents: number
		activeAgents: number
		inactiveAgents: number
		totalUsage: number
		agentsByModule: Record<string, number>
		agentsByRole: Record<string, number>
		mostUsedAgents: Array<{ agentId: string; name: string; usageCount: number }>
	} {
		const agents = this.getAllAgents()
		const activeAgents = agents.filter((a) => a.isActive)
		const totalUsage = agents.reduce((sum, agent) => sum + agent.usageCount, 0)

		const agentsByModule: Record<string, number> = {}
		const agentsByRole: Record<string, number> = {}

		for (const agent of agents) {
			agentsByModule[agent.moduleId] = (agentsByModule[agent.moduleId] || 0) + 1
			agentsByRole[agent.role] = (agentsByRole[agent.role] || 0) + 1
		}

		const mostUsedAgents = this.getMostUsedAgents(5).map((agent) => ({
			agentId: agent.id,
			name: agent.name,
			usageCount: agent.usageCount,
		}))

		return {
			totalAgents: agents.length,
			activeAgents: activeAgents.length,
			inactiveAgents: agents.length - activeAgents.length,
			totalUsage,
			agentsByModule,
			agentsByRole,
			mostUsedAgents,
		}
	}

	/**
	 * Check if initialized
	 */
	isReady(): boolean {
		return this.isInitialized
	}

	/**
	 * Dispose of resources
	 */
	dispose(): void {
		this.agents.clear()
		this.isInitialized = false
		logger.info("[BmadAgentRegistry] Disposed")
	}
}
