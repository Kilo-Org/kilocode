// kilocode_change - new file for BMAD-METHOD mode integration

import type { BmadAgent, BmadModule } from "./types"
import { BmadIntegrationService } from "./BmadIntegrationService"
import { logger } from "../../utils/logging"
import { t } from "../../i18n"

/**
 * Mapping between BMAD agents and Kilo Code modes
 */
export interface AgentModeMapping {
	agentId: string
	agent: BmadAgent
	modeSlug: string
	modeName: string
	modeDescription: string
	modeIcon?: string
	customInstructions?: string
}

/**
 * BMAD mode manager
 * Manages the mapping between BMAD agents and Kilo Code modes
 */
export class BmadModeManager {
	private integrationService: BmadIntegrationService
	private agentModeMappings: Map<string, AgentModeMapping> = new Map()
	private isInitialized = false

	constructor(integrationService: BmadIntegrationService) {
		this.integrationService = integrationService
	}

	/**
	 * Initialize the mode manager
	 */
	async initialize(): Promise<void> {
		try {
			if (this.isInitialized) {
				logger.warn("[BmadModeManager] Already initialized")
				return
			}

			// Wait for integration service to be ready
			await this.integrationService.initialize()

			// Build agent-to-mode mappings
			await this.buildAgentModeMappings()

			this.isInitialized = true
			logger.info("[BmadModeManager] Initialized successfully", {
				mappingsCount: this.agentModeMappings.size,
			})
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadModeManager] Failed to initialize", { error: errorMessage })
			throw new Error(`Failed to initialize BMAD mode manager: ${errorMessage}`)
		}
	}

	/**
	 * Build mappings between BMAD agents and Kilo Code modes
	 */
	private async buildAgentModeMappings(): Promise<void> {
		const modules = this.integrationService.getAvailableModules()

		for (const module of modules) {
			const agents = this.integrationService.getModuleAgents(module.id)

			for (const agent of agents) {
				const mapping = this.createAgentModeMapping(agent, module)
				this.agentModeMappings.set(agent.id, mapping)
			}
		}
	}

	/**
	 * Create a mode mapping for a BMAD agent
	 */
	private createAgentModeMapping(agent: BmadAgent, module: BmadModule): AgentModeMapping {
		// Generate mode slug from agent name
		const modeSlug = `bmad-${agent.id.toLowerCase().replace(/\s+/g, "-")}`

		return {
			agentId: agent.id,
			agent,
			modeSlug,
			modeName: agent.name,
			modeDescription: this.generateModeDescription(agent, module),
			modeIcon: this.getModeIcon(agent),
			customInstructions: this.generateCustomInstructions(agent),
		}
	}

	/**
	 * Generate a mode description from agent information
	 */
	private generateModeDescription(agent: BmadAgent, module: BmadModule): string {
		const parts: string[] = []

		if (agent.role) {
			parts.push(agent.role)
		}

		if (agent.identity) {
			parts.push(agent.identity)
		}

		if (module.name) {
			parts.push(`(${module.name})`)
		}

		return parts.join(" - ")
	}

	/**
	 * Get an icon for the mode based on agent role
	 */
	private getModeIcon(agent: BmadAgent): string | undefined {
		const role = agent.role.toLowerCase()

		// Map common roles to icons
		const iconMap: Record<string, string> = {
			architect: "🏗️",
			developer: "💻",
			"product manager": "📊",
			designer: "🎨",
			"ux designer": "🎯",
			"qa engineer": "🧪",
			tester: "🧪",
			devops: "🔧",
			security: "🔒",
			analyst: "📈",
			reviewer: "👀",
			mentor: "👨‍🏫",
			consultant: "💡",
			expert: "⭐",
		}

		return iconMap[role] || "🤖"
	}

	/**
	 * Generate custom instructions for the mode
	 */
	private generateCustomInstructions(agent: BmadAgent): string {
		const parts: string[] = []

		// Add identity
		if (agent.identity) {
			parts.push(`You are ${agent.identity}.`)
		}

		// Add communication style
		if (agent.communicationStyle) {
			parts.push(`Communication style: ${agent.communicationStyle}`)
		}

		// Add principles
		if (agent.principles && agent.principles.length > 0) {
			parts.push("Follow these principles:")
			agent.principles.forEach((principle, index) => {
				parts.push(`${index + 1}. ${principle}`)
			})
		}

		// Add capabilities
		if (agent.capabilities && agent.capabilities.length > 0) {
			parts.push("You are capable of:")
			agent.capabilities.forEach((capability) => {
				parts.push(`- ${capability.name}: ${capability.description}`)
			})
		}

		return parts.join("\n")
	}

	/**
	 * Get all agent mode mappings
	 */
	getAllMappings(): AgentModeMapping[] {
		return Array.from(this.agentModeMappings.values())
	}

	/**
	 * Get a mapping by agent ID
	 */
	getMappingByAgentId(agentId: string): AgentModeMapping | undefined {
		return this.agentModeMappings.get(agentId)
	}

	/**
	 * Get a mapping by mode slug
	 */
	getMappingByModeSlug(modeSlug: string): AgentModeMapping | undefined {
		return this.getAllMappings().find((mapping) => mapping.modeSlug === modeSlug)
	}

	/**
	 * Get mappings for a specific module
	 */
	getMappingsByModule(moduleId: string): AgentModeMapping[] {
		return this.getAllMappings().filter((mapping) => mapping.agent.moduleId === moduleId)
	}

	/**
	 * Check if a mode slug is a BMAD mode
	 */
	isBmadMode(modeSlug: string): boolean {
		return modeSlug.startsWith("bmad-")
	}

	/**
	 * Create Kilo Code mode configuration from BMAD agent
	 */
	createKiloCodeMode(mapping: AgentModeMapping): any {
		return {
			slug: mapping.modeSlug,
			name: mapping.modeName,
			description: mapping.modeDescription,
			icon: mapping.modeIcon,
			customInstructions: mapping.customInstructions,
			// Add agent metadata for reference
			metadata: {
				bmadAgentId: mapping.agentId,
				bmadModuleId: mapping.agent.moduleId,
				isBmadMode: true,
			},
		}
	}

	/**
	 * Create all Kilo Code mode configurations
	 */
	createAllKiloCodeModes(): any[] {
		return this.getAllMappings().map((mapping) => this.createKiloCodeMode(mapping))
	}

	/**
	 * Get agent information for a mode
	 */
	getAgentForMode(modeSlug: string): BmadAgent | undefined {
		const mapping = this.getMappingByModeSlug(modeSlug)
		return mapping?.agent
	}

	/**
	 * Get recommended agents for a task
	 */
	getRecommendedAgentsForTask(taskDescription: string): AgentModeMapping[] {
		// Simple keyword-based recommendation
		// In a real implementation, this could use AI or more sophisticated matching
		const keywords = taskDescription.toLowerCase().split(/\s+/)
		const recommendations: AgentModeMapping[] = []

		for (const mapping of Array.from(this.agentModeMappings.values())) {
			const agent = mapping.agent
			let score = 0

			// Check role match
			if (agent.role) {
				const role = agent.role.toLowerCase()
				keywords.forEach((keyword) => {
					if (role.includes(keyword)) {
						score += 2
					}
				})
			}

			// Check capabilities
			if (agent.capabilities) {
				agent.capabilities.forEach((capability) => {
					const capabilityText = `${capability.name} ${capability.description}`.toLowerCase()
					keywords.forEach((keyword) => {
						if (capabilityText.includes(keyword)) {
							score += 1
						}
					})
				})
			}

			if (score > 0) {
				recommendations.push({ ...mapping, score } as any)
			}
		}

		// Sort by score (highest first)
		return recommendations.sort((a, b) => (b as any).score - (a as any).score)
	}

	/**
	 * Get agent triggers
	 */
	getAgentTriggers(agentId: string): string[] {
		const mapping = this.getMappingByAgentId(agentId)
		return mapping?.agent.triggers?.map((trigger) => trigger.trigger) || []
	}

	/**
	 * Check if an agent should be triggered by a message
	 */
	shouldTriggerAgent(agentId: string, message: string): boolean {
		const triggers = this.getAgentTriggers(agentId)
		const lowerMessage = message.toLowerCase()

		return triggers.some((trigger) => lowerMessage.includes(trigger.toLowerCase()))
	}

	/**
	 * Get statistics about the mode mappings
	 */
	getStatistics(): {
		totalMappings: number
		mappingsByModule: Record<string, number>
		mappingsByRole: Record<string, number>
	} {
		const mappings = this.getAllMappings()
		const mappingsByModule: Record<string, number> = {}
		const mappingsByRole: Record<string, number> = {}

		for (const mapping of mappings) {
			// Count by module
			const moduleId = mapping.agent.moduleId
			mappingsByModule[moduleId] = (mappingsByModule[moduleId] || 0) + 1

			// Count by role
			const role = mapping.agent.role || "unknown"
			mappingsByRole[role] = (mappingsByRole[role] || 0) + 1
		}

		return {
			totalMappings: mappings.length,
			mappingsByModule,
			mappingsByRole,
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
		this.agentModeMappings.clear()
		this.isInitialized = false
		logger.info("[BmadModeManager] Disposed")
	}
}
