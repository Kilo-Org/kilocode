// kilocode_change - new file
import type { ExtensionContext, Memento } from "vscode"
import { AllUsageResult, UsageEvent, UsageResult, UsageType, UsageWindow } from "@roo-code/types"
import { ContextProxy } from "../core/config/ContextProxy"

const USAGE_STORAGE_KEY = "kilocode.virtualQuotaFallbackProvider.usage.v1"
const COOLDOWNS_STORAGE_KEY = "kilocode.virtualQuotaFallbackProvider.cooldowns.v1"
const ONE_MINUTE_MS = 60 * 1000
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS
const ONE_DAY_MS = 24 * ONE_HOUR_MS

export class UsageTracker {
	private static _instance: UsageTracker
	private memento: Memento

	// Private constructor to enforce singleton pattern
	private constructor(context: ExtensionContext) {
		this.memento = context.globalState
	}

	/**
	 * Initializes the singleton instance of the UsageTracker.
	 * @param context The extension context provided by VS Code.
	 */
	public static initialize(context: ExtensionContext): UsageTracker {
		if (!UsageTracker._instance) {
			UsageTracker._instance = new UsageTracker(context)
		}
		return UsageTracker._instance
	}

	public static getInstance(): UsageTracker {
		if (!UsageTracker._instance) {
			UsageTracker.initialize(ContextProxy.instance.rawContext)
		}
		return UsageTracker._instance
	}

	/**
	 * Records a usage event.
	 * This data is added to a list in the global state. Old data is automatically pruned.
	 *
	 * @param providerId The unique identifier of the AI provider.
	 * @param type The type of usage, either "tokens" or "requests".
	 * @param count The number of tokens or requests to record.
	 */
	public async consume(providerId: string, type: UsageType, count: number): Promise<void> {
		const newEvent: UsageEvent = {
			timestamp: Date.now(),
			providerId,
			type,
			count,
		}

		const allEvents = this.getPrunedEvents()
		allEvents.push(newEvent)

		await this.memento.update(USAGE_STORAGE_KEY, allEvents)
	}

	/**
	 * Calculates the total usage for a given provider over a specified sliding window.
	 *
	 * @param providerId The provider to retrieve usage for.
	 * @param window The time window to calculate usage within ('minute', 'hour', 'day').
	 * @returns An object containing the total number of tokens and requests.
	 */
	public getUsage(providerId: string, window: UsageWindow): UsageResult {
		const now = Date.now()
		let startTime: number

		switch (window) {
			case "minute":
				startTime = now - ONE_MINUTE_MS
				break
			case "hour":
				startTime = now - ONE_HOUR_MS
				break
			case "day":
				startTime = now - ONE_DAY_MS
				break
		}

		// Get pruned events to improve memory efficiency
		const allEvents = this.getPrunedEvents()

		const relevantEvents = allEvents.filter(
			(event) => event.providerId === providerId && event.timestamp >= startTime,
		)

		const result = relevantEvents.reduce<UsageResult>(
			(acc, event) => {
				if (event.type === "tokens") {
					acc.tokens += event.count
				} else if (event.type === "requests") {
					acc.requests += event.count
				}
				return acc
			},
			{ tokens: 0, requests: 0 },
		)

		return result
	}

	/**
	 * Calculates the total usage for a given provider across all time windows.
	 *
	 * @param providerId The provider to retrieve usage for.
	 * @returns An object containing the total number of tokens and requests for each window.
	 */
	public getAllUsage(providerId: string): AllUsageResult {
		return {
			minute: this.getUsage(providerId, "minute"),
			hour: this.getUsage(providerId, "hour"),
			day: this.getUsage(providerId, "day"),
		}
	}

	/**
	 * Retrieves all events from storage and filters out any that are older
	 * than the longest tracking window (1 day). This prevents the storage
	 * from growing indefinitely.
	 */
	private getPrunedEvents(): UsageEvent[] {
		const allEvents = this.memento.get<UsageEvent[]>(USAGE_STORAGE_KEY, [])
		const cutoff = Date.now() - ONE_DAY_MS
		const prunedEvents = allEvents.filter((event) => event.timestamp >= cutoff)
		return prunedEvents
	}

	/**
	 * A utility method to completely clear all tracked usage data.
	 */
	public async clearAllUsageData(): Promise<void> {
		await this.memento.update(USAGE_STORAGE_KEY, undefined)
		await this.memento.update(COOLDOWNS_STORAGE_KEY, undefined)
	}

	/**
	 * Sets a cooldown period for a specific provider.
	 * @param providerId The ID of the provider to put on cooldown.
	 * @param durationMs The duration of the cooldown in milliseconds.
	 */
	public async setCooldown(providerId: string, durationMs: number): Promise<void> {
		const cooldownUntil = Date.now() + durationMs
		const allCooldowns = await this.getPrunedCooldowns()
		allCooldowns[providerId] = cooldownUntil
		await this.memento.update(COOLDOWNS_STORAGE_KEY, allCooldowns)
	}

	/**
	 * Checks if a provider is currently under a cooldown.
	 * @param providerId The ID of the provider to check.
	 * @returns True if the provider is on cooldown, false otherwise.
	 */
	public async isUnderCooldown(providerId: string): Promise<boolean> {
		const allCooldowns = await this.getPrunedCooldowns()
		const cooldownUntil = allCooldowns[providerId]

		if (cooldownUntil && Date.now() < cooldownUntil) {
			console.debug(
				`Provider ${providerId} is under cooldown. Cooldown expires at: ${new Date(
					cooldownUntil,
				).toLocaleTimeString()}`,
			)
			return true
		}

		return false
	}

	/**
	 * Retrieves all cooldowns from storage and filters out expired ones.
	 */
	private async getPrunedCooldowns(): Promise<{ [key: string]: number }> {
		const allCooldowns = this.memento.get<{ [key: string]: number }>(COOLDOWNS_STORAGE_KEY, {})
		const now = Date.now()
		const prunedCooldowns: { [key: string]: number } = {}

		for (const [providerId, cooldownUntil] of Object.entries(allCooldowns)) {
			if (cooldownUntil > now) {
				prunedCooldowns[providerId] = cooldownUntil
			}
		}

		// Asynchronously update storage with the pruned list, but don't wait for it
		// to avoid blocking the check.
		if (Object.keys(prunedCooldowns).length !== Object.keys(allCooldowns).length) {
			this.memento.update(COOLDOWNS_STORAGE_KEY, prunedCooldowns)
		}

		return prunedCooldowns
	}
}
