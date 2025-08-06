// kilocode_change - new file
import type { ExtensionContext, Memento } from "vscode"
import { UsageResultByDuration, UsageEvent, UsageResult, UsageType, UsageWindow } from "@roo-code/types"
import { ContextProxy } from "../core/config/ContextProxy"

const USAGE_STORAGE_KEY = "kilocode.virtualQuotaFallbackProvider.usage.v1"
const COOLDOWNS_STORAGE_KEY = "kilocode.virtualQuotaFallbackProvider.cooldowns.v1"
const ONE_MINUTE_MS = 60 * 1000
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS
const ONE_DAY_MS = 24 * ONE_HOUR_MS

export class UsageTracker {
	private static _instance: UsageTracker
	private memento: Memento

	private constructor(context: ExtensionContext) {
		this.memento = context.globalState
	}

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

	public getAllUsage(providerId: string): UsageResultByDuration {
		return {
			minute: this.getUsage(providerId, "minute"),
			hour: this.getUsage(providerId, "hour"),
			day: this.getUsage(providerId, "day"),
		}
	}

	private getPrunedEvents(): UsageEvent[] {
		const allEvents = this.memento.get<UsageEvent[]>(USAGE_STORAGE_KEY, [])
		const cutoff = Date.now() - ONE_DAY_MS
		const prunedEvents = allEvents.filter((event) => event.timestamp >= cutoff)
		return prunedEvents
	}

	public async clearAllUsageData(): Promise<void> {
		await this.memento.update(USAGE_STORAGE_KEY, undefined)
		await this.memento.update(COOLDOWNS_STORAGE_KEY, undefined)
	}

	public async setCooldown(providerId: string, durationMs: number): Promise<void> {
		const cooldownUntil = Date.now() + durationMs
		const allCooldowns = await this.getPrunedCooldowns()
		allCooldowns[providerId] = cooldownUntil
		await this.memento.update(COOLDOWNS_STORAGE_KEY, allCooldowns)
	}

	public async isUnderCooldown(providerId: string): Promise<boolean> {
		const allCooldowns = await this.getPrunedCooldowns()
		const cooldownUntil = allCooldowns[providerId]

		if (cooldownUntil && Date.now() < cooldownUntil) {
			return true
		}

		return false
	}

	private async getPrunedCooldowns(): Promise<{ [key: string]: number }> {
		const now = Date.now()
		const allCooldowns = this.memento.get<{ [key: string]: number }>(COOLDOWNS_STORAGE_KEY, {})
		const prunedCooldowns: { [key: string]: number } = {}

		for (const [providerId, cooldownUntil] of Object.entries(allCooldowns)) {
			if (cooldownUntil > now) {
				prunedCooldowns[providerId] = cooldownUntil
			}
		}

		if (Object.keys(prunedCooldowns).length !== Object.keys(allCooldowns).length) {
			this.memento.update(COOLDOWNS_STORAGE_KEY, prunedCooldowns)
		}

		return prunedCooldowns
	}
}
