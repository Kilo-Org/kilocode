// kilocode_change - new file
import { Anthropic } from "@anthropic-ai/sdk"
import * as vscode from "vscode"
import EventEmitter from "events"
import type { ModelInfo, ProviderSettings } from "@roo-code/types"
import { RooCodeEventName } from "@roo-code/types"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { ContextProxy } from "../../core/config/ContextProxy"
import { ApiStream } from "../transform/stream"
import { type ApiHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { buildApiHandler } from "../index"
import {
	IntelligentProfileConfig,
	IntelligentProviderConfig,
	DifficultyLevel,
	ProfileMap,
} from "../../shared/types/intelligent-provider"

/**
 * Intelligent Provider API processor.
 * This handler selects the appropriate provider based on the difficulty of the user's prompt.
 * It analyzes the prompt to determine if it's easy, medium, or hard and routes to the appropriate provider.
 */
export class IntelligentHandler extends EventEmitter implements ApiHandler {
	private settingsManager: ProviderSettingsManager
	private settings: ProviderSettings

	private handlers: ProfileMap = {
		easy: undefined,
		medium: undefined,
		hard: undefined,
		classifier: undefined,
	}

	private isInitialized: boolean = false
	private activeDifficulty: "easy" | "medium" | "hard" | null = null
	private lastNotificationMessage: string | null = null
	private settingsHash: string | null = null
	private assessmentInProgress: boolean = false
	private assessmentCount: number = 0
	private lastResetPromptKey: string | null = null

	// Event-driven assessment state
	private assessmentCompleted: boolean = false
	private lastAssessedPrompt: string | null = null
	private assessmentCompletedTs: number | null = null
	private taskMessageEventHandler?: (...args: any[]) => void
	private currentTaskId: string | null = null

	private readonly CLASSIFIER_PROMPT = `You are an expert Task Complexity Classifier for software development tasks. Your role is to help route tasks to the appropriate AI model while minimizing costs.

**Classification Framework:**

EASY Tasks (Fast responses, basic understanding):
- Single-step changes: rename variable, add console.log, fix typo
- Questions about code: "what does this function do?", "explain this class"
- Simple lookups: "how do I use this API?", "what's the syntax for..."
- Basic operations: create file, delete function, edit import
- Sum: 1-2 simple actions

MEDIUM Tasks (Moderate complexity, balanced features):
- Multi-step development: implement feature, create component, write tests
- Analysis: debug issue, refactor function, optimize algorithm
- Integration: connect to API, handle data flow, setup authentication
- Configuration: modify settings, update dependencies, change architecture
- Development workflow: create PR, merge code, deploy to staging
- Sum: 3-5 related steps requiring context

HARD Tasks (Complex thought processes, advanced reasoning):
- System architecture: design plugin system, restructure application
- Complex refactoring: multi-file changes across modules, design pattern implementation
- Advanced debugging: diagnose race conditions, memory issues, performance bottlenecks
- Enterprise features: authentication systems, real-time features, distributed systems
- Strategy: codebase analysis, technology migrations, performance audits
- Sum: 5+ interconnected steps requiring deep understanding

**Classification Rules:**
1. FOCUS ON COGNITIVE LOAD: Consider thinking time, domain knowledge, and complexity rather than code volume
2. DEFAULT TO MEDIUM: When uncertain, choose medium to ensure capabilities
3. SINGLE-DOMAIN vs MULTI-DOMAIN: Multi-system tasks are usually HARD
4. TECHNICAL DEPTH: Tasks requiring advanced patterns, algorithms, or architectural decisions are HARD
5. RESEARCH INTENSITY: Tasks needing investigation across unknown territory are HARD

**Output:** JSON only: {"difficulty": "easy|medium|hard"}

**Examples:**
- "add error handling to this function" → easy (single edit)
- "why does this code return undefined?" → easy (explanation requested)
- "create a user registration form" → medium (multiple components, data flow)
- "implement JWT authentication with refresh tokens" → hard (security critical, multi-system)
- "optimize React component rendering performance" → hard (analysis + refactoring)
- "migrate from REST to GraphQL" → hard (architecture change)`

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
				this.handlers = {
					easy: undefined,
					medium: undefined,
					hard: undefined,
					classifier: undefined,
				}
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
			const activeHandler = this.handlers.hard || this.handlers.medium || this.handlers.easy
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

			// Get the user's prompt from metadata (set by Task.ts from UI inputValue)
			const userPrompt = metadata?.rawUserPrompt ?? ""

			// Check if this is a new user message - reset assessment state only for new messages
			const isNewUserMessage =
				metadata?.isInitialMessage || this.shouldResetAssessment(userPrompt, metadata?.taskId)

			// Reset assessment state for new user messages
			if (isNewUserMessage) {
				this.resetAssessmentState(userPrompt, metadata?.taskId)
			}

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
			const wasCached = this.assessmentCompleted && !isNewUserMessage
			if (this.activeDifficulty !== difficulty || !wasCached) {
				this.activeDifficulty = difficulty
				// Emit an event similar to how virtual quota fallback works
				this.emit("handlerChanged", activeHandler)
				// Show notification when difficulty changes or when a new assessment was performed
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
		if (this.handlers.hard) {
			return this.handlers.hard.getModel()
		} else if (this.handlers.medium) {
			return this.handlers.medium.getModel()
		} else if (this.handlers.easy) {
			return this.handlers.easy.getModel()
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
		const profiles = this.settings.profiles || []
		const config = this.mapProfilesToConfig(profiles)

		// Validate required profiles in one place
		const required = ["easy", "medium", "hard"] as const
		const missing = required.filter((type) => !config[`${type}Profile` as keyof IntelligentProviderConfig])
		if (missing.length > 0) {
			throw new Error(`Required profiles missing: ${missing.join(", ")}`)
		}

		// Load all profiles in parallel
		await Promise.all([
			config.easyProfile && this.loadProfile(config.easyProfile, "easy"),
			config.mediumProfile && this.loadProfile(config.mediumProfile, "medium"),
			config.hardProfile && this.loadProfile(config.hardProfile, "hard"),
			config.classifierProfile && this.loadProfile(config.classifierProfile, "classifier"),
		])
	}

	private mapProfilesToConfig(profiles: any[]): IntelligentProviderConfig {
		return profiles.reduce((config, profile) => {
			const type = profile.difficultyLevel as DifficultyLevel
			config[`${type}Profile` as keyof IntelligentProviderConfig] = {
				profileId: profile.profileId,
				profileName: profile.profileName,
			}
			return config
		}, {} as IntelligentProviderConfig)
	}

	private async loadProfile(config: IntelligentProfileConfig, type: DifficultyLevel): Promise<void> {
		if (!config?.profileId) return

		try {
			const profileSettings = await this.settingsManager.getProfile({
				id: config.profileId,
			})
			const handler = buildApiHandler(profileSettings)

			this.handlers[type] = handler

			console.debug(`Loaded ${type} profile: ${config.profileName}`)
		} catch (error) {
			console.error(`Failed to load ${type} profile ${config.profileName}:`, error)
		}
	}

	private parseDifficultyResponse(response: string): "easy" | "medium" | "hard" {
		const jsonMatch = response.match(/\{[^}]+\}/)
		if (!jsonMatch) {
			throw new Error(`Invalid AI response: ${response}`)
		}

		const parsed = JSON.parse(jsonMatch[0])
		return parsed.difficulty.toLowerCase()
	}

	async assessDifficulty(
		prompt: string,
		metadata?: ApiHandlerCreateMessageMetadata,
	): Promise<"easy" | "medium" | "hard"> {
		// Return cached result if assessment is already completed for this conversation
		if (this.assessmentCompleted && this.activeDifficulty !== null) {
			console.debug(`IntelligentHandler: Using cached assessment result: ${this.activeDifficulty}`)
			return this.activeDifficulty
		}

		// Reset activeDifficulty for new user messages (when not an initial message)
		// Only reset once per user message to avoid multiple logs
		const currentPromptKey = this.getPromptKey(prompt)
		if (metadata && !metadata.isInitialMessage) {
			// Only reset if we haven't already reset for this prompt
			if (this.lastResetPromptKey !== currentPromptKey) {
				this.activeDifficulty = null
				this.lastResetPromptKey = currentPromptKey
				console.debug(
					`IntelligentHandler: Reset activeDifficulty for new user message: "${prompt.substring(0, 50)}${prompt.length > 50 ? "..." : ""}"`,
				)
			}
		}

		// Default to medium for empty prompts
		if (!prompt.trim()) {
			const defaultDifficulty = "medium" as const
			this.activeDifficulty = defaultDifficulty
			this.markAssessmentCompleted()
			return defaultDifficulty
		}

		// Set flag to prevent concurrent assessments
		this.assessmentInProgress = true

		try {
			console.debug(`IntelligentHandler: Starting AI assessment for prompt`)

			// Perform AI assessment only if not already completed for this conversation
			const calculatedDifficulty = await this.assessDifficultyWithAI(prompt, metadata)

			// Set the active difficulty for this request and conversation
			this.activeDifficulty = calculatedDifficulty

			// Mark assessment as completed for this conversation
			this.markAssessmentCompleted()

			console.debug(`IntelligentHandler: AI assessment result: ${calculatedDifficulty}`)
			return calculatedDifficulty
		} finally {
			this.assessmentInProgress = false
		}
	}

	private async assessDifficultyWithAI(
		prompt: string,
		metadata?: ApiHandlerCreateMessageMetadata,
	): Promise<"easy" | "medium" | "hard"> {
		// Determine which handler to use for classification
		let classificationHandler: ApiHandler | undefined

		// Prioritize the classifier handler if it's configured and no specific classifierProfileId is requested
		if (this.handlers.classifier && !metadata?.classifierProfileId) {
			classificationHandler = this.handlers.classifier
		} else if (metadata?.classifierProfileId) {
			// Find the handler based on the classifier profile ID
			// We need to match the profile ID with the actual profile settings
			const profiles = this.settings.profiles || []

			// Find which difficulty level the classifierProfileId belongs to
			const profile = profiles.find((p) => p.profileId === metadata.classifierProfileId)
			if (profile && profile.difficultyLevel) {
				const handlerType = profile.difficultyLevel as DifficultyLevel
				classificationHandler = this.handlers[handlerType]
			}
		}

		// If no specific classifier handler found or no metadata provided, use easy handler as default
		if (!classificationHandler) {
			classificationHandler = this.handlers.easy
		}

		// If we don't have a classification handler, throw an error
		if (!classificationHandler) {
			throw new Error("No classification handler available for intelligent assessment")
		}

		const taskToClassify = `Task: "${prompt.substring(0, 500)}"`

		try {
			this.assessmentCount++
			console.debug(`IntelligentHandler: Starting assessment #${this.assessmentCount}`)

			// Use the classification handler to perform classification
			const response = await classificationHandler.createMessage(
				this.CLASSIFIER_PROMPT,
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

			// Debug: Log the raw AI response
			console.debug(`IntelligentHandler: Classifier AI response: "${fullResponse.trim()}"`)

			return this.parseDifficultyResponse(fullResponse)
		} catch (error) {
			console.error("AI classification failed:", error)
			throw error
		}
	}

	private getHandlerForDifficulty(difficulty: "easy" | "medium" | "hard"): ApiHandler | undefined {
		switch (difficulty) {
			case "easy":
				return this.handlers.easy
			case "medium":
				return this.handlers.medium
			case "hard":
				return this.handlers.hard
			default:
				return this.handlers.medium // default to medium
		}
	}

	private getPromptKey(prompt: string): string {
		// Create a unique key for the prompt to track reset events
		// Use first 100 characters, trimmed and normalized
		const normalized = prompt.substring(0, 100).trim().toLowerCase()
		return btoa(normalized).replace(/=/g, "").substring(0, 32)
	}

	/**
	 * Check if assessment should be reset for this prompt/task combination
	 * Resets assessment when:
	 * - Task ID changes (new conversation)
	 * - User prompt changes significantly (new user message)
	 * - Initial message flag is set
	 */
	private shouldResetAssessment(userPrompt: string, taskId?: string): boolean {
		if (!userPrompt.trim()) {
			return false
		}

		// Reset if task changed
		if (taskId && taskId !== this.currentTaskId) {
			return true
		}

		// Reset if prompt changed significantly
		if (userPrompt !== this.lastAssessedPrompt) {
			return true
		}

		return false
	}

	/**
	 * Reset assessment state for a new user message
	 */
	private resetAssessmentState(userPrompt: string, taskId?: string): void {
		console.debug(`IntelligentHandler: Resetting assessment state for new user message (task: ${taskId})`)

		this.assessmentCompleted = false
		this.lastAssessedPrompt = userPrompt
		this.assessmentCompletedTs = null
		this.currentTaskId = taskId || null

		// Reset the active difficulty for the new message
		this.activeDifficulty = null
		this.lastResetPromptKey = null
	}

	/**
	 * Mark assessment as completed for the current conversation
	 */
	private markAssessmentCompleted(): void {
		this.assessmentCompleted = true
		this.assessmentCompletedTs = Date.now()
		console.debug(`IntelligentHandler: Assessment completed and cached`)
	}
}
