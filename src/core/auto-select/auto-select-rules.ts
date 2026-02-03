// kilocode_change whole file
import { buildApiHandler } from "../../api"
import { Task } from "../task/Task"
import { calculateApiCostAnthropic, calculateApiCostOpenAI } from "../../shared/cost"
import { streamResponseFromHandler } from "../../utils/single-completion-handler"
import { getApiProtocol } from "@roo-code/types"
import type { RuleMetadata } from "../../shared/cline-rules"
import { supportPrompt } from "../../shared/support-prompt"

export interface AutoSelectResult {
	selectedRulePaths: string[]
	selectedRuleNames: string[]
	totalCost?: number
}

/**
 * Builds a numbered list of rules with descriptions for the prompt.
 */
function buildRuleList(availableRules: RuleMetadata[]): string {
	return availableRules
		.map((rule, idx) => {
			const scope = rule.isGlobal ? "[Global]" : "[Workspace]"
			return `${idx}. ${scope} ${rule.name}\n   ${rule.description || "(No description)"}`
		})
		.join("\n\n")
}

/**
 * Uses an AI model to determine which rules are relevant for the user's prompt.
 * Uses the configurable support prompt system.
 *
 * @param userPrompt - The user's task/prompt
 * @param availableRules - Array of rule metadata including names and descriptions
 * @param cline - The task instance for accessing provider settings and reporting
 * @returns Promise<AutoSelectResult> - Selected rule paths, names, and optional cost info
 */
export async function autoSelectRules(
	userPrompt: string,
	availableRules: RuleMetadata[],
	cline: Task,
): Promise<AutoSelectResult> {
	try {
		// If no rules available, return empty selection
		if (availableRules.length === 0) {
			return { selectedRulePaths: [], selectedRuleNames: [] }
		}

		const state = await cline.providerRef.deref()?.getState()

		// Get the auto-select rules API configuration (with fallback to current config)
		const autoSelectRulesApiConfigId = state?.autoSelectRulesApiConfigId

		// Get the API configuration
		const listApiConfigMeta = state?.listApiConfigMeta
		if (!listApiConfigMeta || !Array.isArray(listApiConfigMeta)) {
			console.warn("[AutoSelectRules] No API configs available, selecting all rules")
			return {
				selectedRulePaths: availableRules.map((r) => r.path),
				selectedRuleNames: availableRules.map((r) => r.name),
			}
		}

		// Determine which profile to use: specific config or current
		let profileId: string | undefined
		if (autoSelectRulesApiConfigId) {
			const configExists = listApiConfigMeta.find((config) => config.id === autoSelectRulesApiConfigId)
			if (configExists) {
				profileId = autoSelectRulesApiConfigId
			} else {
				console.warn("[AutoSelectRules] Configured API config not found, using current config")
			}
		}

		// Load the profile settings (specific or current)
		let profile
		if (profileId) {
			profile = await cline.providerRef.deref()?.providerSettingsManager.getProfile({
				id: profileId,
			})
		} else {
			// Use the current API configuration
			profile = state?.apiConfiguration
		}

		if (!profile || !profile.apiProvider) {
			console.warn("[AutoSelectRules] Could not load profile, selecting all rules")
			return {
				selectedRulePaths: availableRules.map((r) => r.path),
				selectedRuleNames: availableRules.map((r) => r.name),
			}
		}

		// Get custom support prompts from state
		const customSupportPrompts = state?.customSupportPrompts

		// Build the prompt using the support prompt system
		const ruleList = buildRuleList(availableRules)
		const systemPrompt = supportPrompt.create("AUTO_SELECT_RULES", { ruleList, userPrompt }, customSupportPrompts)

		const handler = buildApiHandler(profile)

		// Initialize handler if it has an initialize method
		if ("initialize" in handler && typeof handler.initialize === "function") {
			await handler.initialize()
		}

		// The system prompt contains the full instruction, user message is just the task
		const { text, usage } = await streamResponseFromHandler(handler, `User's task:\n${userPrompt}`, systemPrompt)

		// Parse the response - expecting comma-separated indices like "0,2,5" or "none"
		const selectedIndices = parseAutoSelectResponse(text, availableRules.length)
		const selectedRulePaths = selectedIndices.map((idx) => availableRules[idx]!.path)
		const selectedRuleNames = selectedIndices.map((idx) => availableRules[idx]!.name)

		// Calculate cost if usage information is available
		let totalCost: number | undefined
		if (usage) {
			totalCost = usage.totalCost

			if (totalCost === undefined) {
				const model = handler.getModel()
				const modelInfo = model.info
				const apiProtocol = getApiProtocol(profile.apiProvider, model.id)

				if (apiProtocol === "anthropic") {
					totalCost = calculateApiCostAnthropic(
						modelInfo,
						usage.inputTokens,
						usage.outputTokens,
						usage.cacheWriteTokens,
						usage.cacheReadTokens,
					).totalCost
				} else {
					totalCost = calculateApiCostOpenAI(
						modelInfo,
						usage.inputTokens,
						usage.outputTokens,
						usage.cacheWriteTokens,
						usage.cacheReadTokens,
					).totalCost
				}
			}
		}

		return { selectedRulePaths, selectedRuleNames, totalCost }
	} catch (error) {
		// On any error, select all rules to avoid blocking the workflow
		console.error("[AutoSelectRules] Error during auto-selection:", error)
		return {
			selectedRulePaths: availableRules.map((r) => r.path),
			selectedRuleNames: availableRules.map((r) => r.name),
		}
	}
}

/**
 * Parses the LLM response to extract selected rule indices.
 */
function parseAutoSelectResponse(response: string, maxIndex: number): number[] {
	const normalized = response.toLowerCase().trim()

	// Check for "none" response
	if (normalized === "none" || normalized.startsWith("none")) {
		return []
	}

	// Extract numbers from the response
	const indices: number[] = []
	const matches = normalized.match(/\d+/g)

	if (matches) {
		for (const match of matches) {
			const idx = parseInt(match, 10)
			if (!isNaN(idx) && idx >= 0 && idx < maxIndex && !indices.includes(idx)) {
				indices.push(idx)
			}
		}
	}

	return indices.sort((a, b) => a - b)
}
