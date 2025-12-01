// kilocode_change - new file
import { Anthropic } from "@anthropic-ai/sdk"
import * as vscode from "vscode"
import EventEmitter from "events"
import type { ModelInfo, ProviderSettings } from "@roo-code/types"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { ContextProxy } from "../../core/config/ContextProxy"
import { ApiStream } from "../transform/stream"
import { type ApiHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { buildApiHandler } from "../index"

interface IntelligentProfileConfig {
	profileId?: string
	profileName?: string
}

interface IntelligentProviderConfig {
	easyProfile?: IntelligentProfileConfig
	mediumProfile?: IntelligentProfileConfig
	hardProfile?: IntelligentProfileConfig
	classifierProfile?: IntelligentProfileConfig
}

/**
 * Intelligent Provider API processor.
 * This handler selects the appropriate provider based on the difficulty of the user's prompt.
 * It analyzes the prompt to determine if it's easy, medium, or hard and routes to the appropriate provider.
 */
export class IntelligentHandler extends EventEmitter implements ApiHandler {
	private settingsManager: ProviderSettingsManager
	private settings: ProviderSettings

	private easyHandler: ApiHandler | undefined
	private mediumHandler: ApiHandler | undefined
	private hardHandler: ApiHandler | undefined
	private classifierHandler: ApiHandler | undefined

	private isInitialized: boolean = false
	private activeDifficulty: "easy" | "medium" | "hard" | null = null
	private lastNotificationMessage: string | null = null
	private settingsHash: string | null = null

	constructor(options: ProviderSettings) {
		super()
		this.settings = {
			...options,
			profiles: options.profiles ? [...options.profiles] : undefined, // Deep copy profiles array
		}
		this.settingsManager = new ProviderSettingsManager(ContextProxy.instance.rawContext)
	}

	private getSettingsHash(): string {
		// Create a simple hash of the profiles configuration
		const profiles = this.settings.profiles || []
		return JSON.stringify(
			profiles.map((p) => ({
				id: p.profileId,
				name: p.profileName,
				level: p.difficultyLevel,
			})),
		)
	}

	async initialize(): Promise<void> {
		const currentHash = this.getSettingsHash()
		if (!this.isInitialized || this.settingsHash !== currentHash) {
			try {
				// Reset handlers when re-initializing with different settings
				this.easyHandler = undefined
				this.mediumHandler = undefined
				this.hardHandler = undefined
				this.classifierHandler = undefined
				await this.loadConfiguredProfiles()
				this.isInitialized = true
				this.settingsHash = currentHash
			} catch (error) {
				console.error("Failed to initialize IntelligentHandler:", error)
				throw error
			}
		}
	}

	async countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number> {
		try {
			await this.initialize()

			// Use the most capable handler for token counting (hard > medium > easy)
			const activeHandler = this.hardHandler || this.mediumHandler || this.easyHandler
			if (!activeHandler) {
				return 0
			}

			return activeHandler.countTokens(content)
		} catch (error) {
			console.error("Error in countTokens:", error)
			throw error
		}
	}

	async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		try {
			await this.initialize()

			// Get the user's prompt from the last message to assess difficulty
			const userPrompt = this.extractUserPrompt(messages)
			const difficulty = await this.assessDifficulty(userPrompt, metadata)

			// Debug logging for difficulty assessment
			console.debug(
				`IntelligentHandler: User prompt: "${userPrompt.substring(0, 100)}${userPrompt.length > 10 ? "..." : ""}"`,
			)
			console.debug(`IntelligentHandler: Word count: ${userPrompt.trim().split(/\s+/).length}`)

			const activeHandler = this.getHandlerForDifficulty(difficulty)
			if (!activeHandler) {
				throw new Error("No provider configured for difficulty level: " + difficulty)
			}

			// Check if the active difficulty has changed and emit event if so
			if (this.activeDifficulty !== difficulty) {
				this.activeDifficulty = difficulty
				// Emit an event similar to how virtual quota fallback works
				this.emit("handlerChanged", activeHandler)
				// Show notification when difficulty changes
				await this.notifyDifficultySwitch(difficulty)
			}

			console.debug(`IntelligentHandler: Selected ${difficulty} difficulty provider for prompt`)

			const stream = activeHandler.createMessage(systemPrompt, messages, metadata)
			for await (const chunk of stream) {
				yield chunk
			}
		} catch (error) {
			console.error("Error in createMessage:", error)
			throw error
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		// Return the currently active handler's model based on activeDifficulty
		if (this.activeDifficulty) {
			const activeHandler = this.getHandlerForDifficulty(this.activeDifficulty)
			if (activeHandler) {
				return activeHandler.getModel()
			}
		}

		// Fallback: Return the most capable model info if no active difficulty
		if (this.hardHandler) {
			return this.hardHandler.getModel()
		} else if (this.mediumHandler) {
			return this.mediumHandler.getModel()
		} else if (this.easyHandler) {
			return this.easyHandler.getModel()
		}

		return {
			id: "",
			info: {
				maxTokens: 1,
				contextWindow: 1,
				supportsPromptCache: false,
			},
		}
	}

	get contextWindow(): number {
		const model = this.getModel()
		return model.info.contextWindow
	}

	/**
	 * Show notification when difficulty level changes.
	 */
	private async notifyDifficultySwitch(difficulty: "easy" | "medium" | "hard"): Promise<void> {
		// Get the active handler for the difficulty to get its model info
		const handler = this.getHandlerForDifficulty(difficulty)
		if (!handler) {
			return
		}

		const modelInfo = handler.getModel()
		const modelName = modelInfo.id || "Unknown Model"

		let message: string
		switch (difficulty) {
			case "easy":
				message = `Switched to Easy Profile: ${modelName}`
				break
			case "medium":
				message = `Switched to Medium Profile: ${modelName}`
				break
			case "hard":
				message = `Switched to Hard Profile: ${modelName}`
				break
			default:
				message = `Switched to Profile: ${modelName}`
		}

		// Avoid showing duplicate notifications
		if (this.lastNotificationMessage !== message) {
			this.lastNotificationMessage = message
			vscode.window.showInformationMessage(message)
		}
	}

	private async loadConfiguredProfiles(): Promise<void> {
		// The profiles are stored in the settings with difficultyLevel information
		const profiles = this.settings.profiles || []

		// Convert profiles array to our config structure
		const intelligentConfig: IntelligentProviderConfig = {}
		profiles.forEach((profile: any) => {
			// Check if this profile has difficultyLevel (from our UI storage)
			if (profile.difficultyLevel === "easy") {
				intelligentConfig.easyProfile = {
					profileId: profile.profileId,
					profileName: profile.profileName,
				}
			} else if (profile.difficultyLevel === "medium") {
				intelligentConfig.mediumProfile = {
					profileId: profile.profileId,
					profileName: profile.profileName,
				}
			} else if (profile.difficultyLevel === "hard") {
				intelligentConfig.hardProfile = {
					profileId: profile.profileId,
					profileName: profile.profileName,
				}
			} else if (profile.difficultyLevel === "classifier") {
				intelligentConfig.classifierProfile = {
					profileId: profile.profileId,
					profileName: profile.profileName,
				}
			}
		})

		// Validate that easy, medium, and hard profiles are all present
		if (!intelligentConfig.easyProfile) {
			throw new Error("Easy profile is required for Intelligent Provider configuration")
		}
		if (!intelligentConfig.mediumProfile) {
			throw new Error("Medium profile is required for Intelligent Provider configuration")
		}
		if (!intelligentConfig.hardProfile) {
			throw new Error("Hard profile is required for Intelligent Provider configuration")
		}

		// Load classifier profile
		if (intelligentConfig.classifierProfile?.profileId) {
			try {
				const profileSettings = await this.settingsManager.getProfile({
					id: intelligentConfig.classifierProfile.profileId,
				})
				this.classifierHandler = buildApiHandler(profileSettings)
				console.debug(`Loaded classifier profile: ${intelligentConfig.classifierProfile.profileName}`)
			} catch (error) {
				console.error(
					`Failed to load classifier profile ${intelligentConfig.classifierProfile.profileName}:`,
					error,
				)
			}
		}

		// Load easy profile
		if (intelligentConfig.easyProfile?.profileId) {
			try {
				const profileSettings = await this.settingsManager.getProfile({
					id: intelligentConfig.easyProfile.profileId,
				})
				this.easyHandler = buildApiHandler(profileSettings)
				console.debug(`Loaded easy profile: ${intelligentConfig.easyProfile.profileName}`)
			} catch (error) {
				console.error(`Failed to load easy profile ${intelligentConfig.easyProfile.profileName}:`, error)
			}
		}

		// Load medium profile
		if (intelligentConfig.mediumProfile?.profileId) {
			try {
				const profileSettings = await this.settingsManager.getProfile({
					id: intelligentConfig.mediumProfile.profileId,
				})
				this.mediumHandler = buildApiHandler(profileSettings)
				console.debug(`Loaded medium profile: ${intelligentConfig.mediumProfile.profileName}`)
			} catch (error) {
				console.error(`Failed to load medium profile ${intelligentConfig.mediumProfile.profileName}:`, error)
			}
		}

		// Load hard profile
		if (intelligentConfig.hardProfile?.profileId) {
			try {
				const profileSettings = await this.settingsManager.getProfile({
					id: intelligentConfig.hardProfile.profileId,
				})
				this.hardHandler = buildApiHandler(profileSettings)
				console.debug(`Loaded hard profile: ${intelligentConfig.hardProfile.profileName}`)
			} catch (error) {
				console.error(`Failed to load hard profile ${intelligentConfig.hardProfile.profileName}:`, error)
			}
		}

		if (!this.easyHandler && !this.mediumHandler && !this.hardHandler) {
			console.warn("No profiles configured for IntelligentHandler")
		}
	}

	private extractUserPrompt(messages: Anthropic.Messages.MessageParam[]): string {
		// Get the last user message as the prompt to analyze
		for (let i = messages.length - 1; i >= 0; i--) {
			const message = messages[i]
			if (message.role === "user") {
				let userContent = ""
				if (Array.isArray(message.content)) {
					userContent = message.content
						.map((block) => {
							if (block.type === "text") {
								return block.text
							}
							return ""
						})
						.filter((text) => text)
						.join(" ")
				} else {
					userContent = message.content || ""
				}

				// Try to extract just the actual user question from the task context
				// Look for patterns that indicate task boundaries
				const taskMatch = userContent.match(/<task>(.*?)<\/task>/s)
				if (taskMatch) {
					return taskMatch[1].trim()
				}

				// Fallback: if no task tags, try to get the last meaningful part
				// Split by common separators and take the last non-context part
				const lines = userContent.split("\n")
				// Look for lines that don't match environment details patterns
				const meaningfulLines = lines.filter(
					(line) =>
						!line.includes("extensionHostProcess.js") &&
						!line.includes("# VSCode") &&
						!line.includes("# Current") &&
						!line.includes("<environment_details>"),
				)

				if (meaningfulLines.length > 0) {
					return meaningfulLines[meaningfulLines.length - 1].trim()
				}

				return userContent
			}
		}
		return ""
	}

	private recentAssessments: ("easy" | "medium" | "hard")[] = []
	private lastDifficultyChange: number = 0
	private readonly COOLDOWN_PERIOD = 30000 // 30 seconds cooldown between difficulty changes
	private readonly ASSESSMENT_HISTORY_SIZE = 5

	async assessDifficulty(
		prompt: string,
		metadata?: ApiHandlerCreateMessageMetadata,
	): Promise<"easy" | "medium" | "hard"> {
		const currentDifficulty = this.activeDifficulty

		if (!prompt.trim()) {
			return currentDifficulty || "medium" // maintain current or default to medium
		}

		// Apply cooldown period to prevent rapid switching
		const now = Date.now()
		if (this.lastDifficultyChange && now - this.lastDifficultyChange < this.COOLDOWN_PERIOD) {
			return currentDifficulty || "medium"
		}

		// Use AI-powered semantic analysis with the easy profile
		const calculatedDifficulty = await this.assessDifficultyWithAI(prompt, metadata)

		// Improved hysteresis logic
		const finalDifficulty = this.applyHysteresis(currentDifficulty, calculatedDifficulty)

		// Track assessment history
		this.recentAssessments.push(finalDifficulty)
		if (this.recentAssessments.length > this.ASSESSMENT_HISTORY_SIZE) {
			this.recentAssessments.shift()
		}

		// Update cooldown timestamp if difficulty changed
		if (currentDifficulty !== finalDifficulty) {
			this.lastDifficultyChange = now
		}

		return finalDifficulty
	}

	private async assessDifficultyWithAI(
		prompt: string,
		metadata?: ApiHandlerCreateMessageMetadata,
	): Promise<"easy" | "medium" | "hard"> {
		// Determine which handler to use for classification
		let classificationHandler: ApiHandler | undefined

		// Prioritize the classifier handler if it's configured and no specific classifierProfileId is requested
		if (this.classifierHandler && !metadata?.classifierProfileId) {
			classificationHandler = this.classifierHandler
		} else if (metadata?.classifierProfileId) {
			// Find the handler based on the classifier profile ID
			// We need to match the profile ID with the actual profile settings
			const profiles = this.settings.profiles || []

			// Find which difficulty level the classifierProfileId belongs to
			const profile = profiles.find((p) => p.profileId === metadata.classifierProfileId)
			if (profile && profile.difficultyLevel) {
				if (profile.difficultyLevel === "easy") {
					classificationHandler = this.easyHandler
				} else if (profile.difficultyLevel === "medium") {
					classificationHandler = this.mediumHandler
				} else if (profile.difficultyLevel === "hard") {
					classificationHandler = this.hardHandler
				} else if (profile.difficultyLevel === "classifier") {
					classificationHandler = this.classifierHandler
				}
			}
		}

		// If no specific classifier handler found or no metadata provided, use easy handler as default
		if (!classificationHandler) {
			classificationHandler = this.easyHandler
		}

		// If we don't have a classification handler, fallback to keyword-based assessment
		if (!classificationHandler) {
			return this.assessDifficultyWithKeywords(prompt)
		}

		const classifierPrompt = `You are a Task Complexity Classifier for coding tasks. Classify the complexity as EASY, MEDIUM, or HARD.

**Levels:**
- EASY: 1-2 steps, simple edits, questions, single file changes
- MEDIUM: 3-4 steps, feature implementation, moderate debugging, multiple file changes
- HARD: 5+ steps, architecture design, complex refactoring, system-wide changes

**Rules:**
- When uncertain, default to MEDIUM
- Consider both the explicit request AND implied work

**Output:** JSON only: {"difficulty": "easy|medium|hard"}

**Examples:**
- "add a console.log" → easy
- "rename this variable" → easy
- "what does this function do?" → easy
- "fix this bug" → medium
- "add user authentication" → medium
- "write tests for this module" → medium
- "refactor to use dependency injection" → hard
- "design a plugin system" → hard
- "optimize database queries across the app" → hard`

		const taskToClassify = `Task: "${prompt.substring(0, 500)}"`

		try {
			// Use the classification handler to perform classification
			const response = await classificationHandler.createMessage(
				classifierPrompt,
				[{ role: "user", content: taskToClassify }],
				{ taskId: "classification-task" } as ApiHandlerCreateMessageMetadata,
			)

			// Extract the JSON response from the stream
			let fullResponse = ""
			for await (const chunk of response) {
				if (chunk.type === "text") {
					fullResponse += chunk.text
				}
			}

			// Parse the JSON response
			const jsonMatch = fullResponse.match(/\{[^}]+\}/)
			if (jsonMatch) {
				const parsed = JSON.parse(jsonMatch[0])
				return parsed.difficulty.toLowerCase()
			}

			// Fallback to keyword-based if AI parsing fails
			return this.assessDifficultyWithKeywords(prompt)
		} catch (error) {
			console.error("AI classification failed, falling back to keywords:", error)
			return this.assessDifficultyWithKeywords(prompt)
		}
	}

	private assessDifficultyWithKeywords(prompt: string): "easy" | "medium" | "hard" {
		// Fallback keyword-based assessment (original logic)
		const wordCount = prompt.trim().split(/\s+/).length
		const easyThreshold = 50
		const hardThreshold = 500

		// Check for complexity keywords
		const complexityKeywords = {
			easy: [
				"simple",
				"basic",
				"small",
				"easy",
				"quick",
				"fast",
				"short",
				"brief",
				"summarize",
				"explain briefly",
				"list",
				"define",
				"what is",
				"how to",
			],
			medium: [
				"analyze",
				"compare",
				"evaluate",
				"implement",
				"create",
				"build",
				"design",
				"review",
				"optimize",
				"improve",
				"modify",
				"update",
				"fix",
				"debug",
			],
			hard: [
				"complex",
				"advanced",
				"sophisticated",
				"challenging",
				"difficult",
				"intricate",
				"architecture",
				"refactor",
				"scalability",
				"performance",
				"security",
				"optimization",
				"algorithm",
				"data structure",
				"pattern",
				"design pattern",
			],
		}

		const lowerPrompt = prompt.toLowerCase()
		let easyScore = 0,
			mediumScore = 0,
			hardScore = 0

		Object.entries(complexityKeywords).forEach(([level, keywords]) => {
			keywords.forEach((keyword) => {
				if (lowerPrompt.includes(keyword.toLowerCase())) {
					if (level === "easy") easyScore++
					else if (level === "medium") mediumScore++
					else if (level === "hard") hardScore++
				}
			})
		})

		// Determine difficulty
		if (hardScore > mediumScore && hardScore > easyScore) return "hard"
		if (mediumScore > easyScore) return "medium"
		if (wordCount > hardThreshold) return "hard"
		if (wordCount > easyThreshold) return "medium"
		return "easy"
	}

	private applyHysteresis(
		currentDifficulty: "easy" | "medium" | "hard" | null,
		calculatedDifficulty: "easy" | "medium" | "hard",
	): "easy" | "medium" | "hard" {
		// If no current difficulty, use calculated
		if (!currentDifficulty) return calculatedDifficulty

		// Enhanced hysteresis: Look at recent assessment history
		const recentCount = this.recentAssessments.length
		if (recentCount >= 3) {
			const recent = this.recentAssessments.slice(-3)
			const nonHardCount = recent.filter((d) => d !== "hard").length

			// Only downgrade from hard if we have 3 consecutive non-hard assessments
			if (currentDifficulty === "hard" && nonHardCount >= 3) {
				return calculatedDifficulty === "easy" ? "medium" : calculatedDifficulty
			}
		}

		// For other transitions, be more conservative
		if (currentDifficulty === "hard") {
			return "hard" // Stay in hard unless conditions above are met
		}

		if (currentDifficulty === "medium" && calculatedDifficulty === "easy") {
			// Only downgrade to easy after 2 consecutive easy assessments
			const recentEasy = this.recentAssessments.slice(-2).every((d) => d === "easy")
			return recentEasy ? "easy" : "medium"
		}

		return calculatedDifficulty
	}

	private getHandlerForDifficulty(difficulty: "easy" | "medium" | "hard"): ApiHandler | undefined {
		switch (difficulty) {
			case "easy":
				return this.easyHandler
			case "medium":
				return this.mediumHandler
			case "hard":
				return this.hardHandler
			default:
				return this.mediumHandler // default to medium
		}
	}
}
