import * as vscode from "vscode"
import { SimpleSavingsTracker } from "./simpleTracker"
import { SimpleSavingsNotifications } from "./simpleNotifications"
import { calculateSavings } from "./simpleCalculator"
import { calculateApiCostAnthropic, calculateApiCostOpenAI, type ApiCostResult } from "../../shared/cost"

interface TokenUsage {
	input: number
	output: number
	cacheWrites?: number
	cacheReads?: number
}

export class AgenticaSavingsTracker {
	private tracker: SimpleSavingsTracker
	private notifications: SimpleSavingsNotifications

	constructor(private readonly context: vscode.ExtensionContext) {
		this.tracker = new SimpleSavingsTracker(context)
		this.notifications = new SimpleSavingsNotifications(this.tracker)
	}

	async trackSavings(
		modelInfo: any, // ModelInfo type
		tokenUsage: TokenUsage
	): Promise<void> {
		try {
			// Calculate Agentica cost
			const agenticaCost = this.calculateAgenticaCost(modelInfo, tokenUsage)
			
			// Calculate savings vs GPT-5.1
			const saved = calculateSavings(agenticaCost, tokenUsage)

			if (saved > 0) {
				// Check for milestone
				await this.notifications.checkAndShowMilestone(saved)
				
				// Show status bar notification
				vscode.window.setStatusBarMessage(`💰 Saved $${saved.toFixed(2)} vs GPT-5.1`, 3000)
			}
		} catch (error) {
			console.error("Failed to track savings:", error)
		}
	}

	private calculateAgenticaCost(modelInfo: any, tokenUsage: TokenUsage): ApiCostResult {
		const isAnthropic = modelInfo.supportsPromptCache || modelInfo.provider === 'anthropic'
		
		if (isAnthropic) {
			return calculateApiCostAnthropic(
				modelInfo,
				tokenUsage.input,
				tokenUsage.output,
				tokenUsage.cacheWrites,
				tokenUsage.cacheReads
			)
		} else {
			const totalInputTokens = tokenUsage.input + (tokenUsage.cacheWrites || 0) + (tokenUsage.cacheReads || 0)
			return calculateApiCostOpenAI(
				modelInfo,
				totalInputTokens,
				tokenUsage.output,
				tokenUsage.cacheWrites,
				tokenUsage.cacheReads
			)
		}
	}

	async getTotalSaved(): Promise<number> {
		return await this.tracker.getTotalSaved()
	}
}

// Global instance
let savingsTracker: AgenticaSavingsTracker | undefined

export function initializeSavingsTracker(context: vscode.ExtensionContext): AgenticaSavingsTracker {
	if (!savingsTracker) {
		savingsTracker = new AgenticaSavingsTracker(context)
	}
	return savingsTracker
}

export function getSavingsTracker(): AgenticaSavingsTracker | undefined {
	return savingsTracker
}
