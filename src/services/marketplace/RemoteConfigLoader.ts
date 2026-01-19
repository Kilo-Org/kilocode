import axios from "axios"
import * as yaml from "yaml"
import { z } from "zod"
import { getApiUrl } from "@roo-code/types" // kilocode_change
import {
	type MarketplaceItem,
	type MarketplaceItemType,
	type SkillMarketplaceItem, // kilocode_change
	modeMarketplaceItemSchema,
	mcpMarketplaceItemSchema,
	skillsMarketplaceCatalogSchema, // kilocode_change
} from "@roo-code/types"
//import { getRooCodeApiUrl } from "@roo-code/cloud" kilocode_change: use our own api

const modeMarketplaceResponse = z.object({
	items: z.array(modeMarketplaceItemSchema),
})

const mcpMarketplaceResponse = z.object({
	items: z.array(mcpMarketplaceItemSchema),
})

export class RemoteConfigLoader {
	// private apiBaseUrl: string // kilocode_change
	private cache: Map<string, { data: MarketplaceItem[]; timestamp: number }> = new Map()
	private cacheDuration = 5 * 60 * 1000 // 5 minutes

	// kilocode_change - empty constructor
	// constructor() {
	// 	this.apiBaseUrl = getKiloBaseUriFromToken()
	// }

	async loadAllItems(hideMarketplaceMcps = false): Promise<MarketplaceItem[]> {
		const modesPromise = this.fetchModes()
		const mcpsPromise = hideMarketplaceMcps ? Promise.resolve([]) : this.fetchMcps()
		// kilocode_change start - add skills
		const skillsPromise = this.fetchSkills()

		const [modes, mcps, skills] = await Promise.all([modesPromise, mcpsPromise, skillsPromise])

		return [...modes, ...mcps, ...skills]
		//kilocode change end
	}

	private async fetchModes(): Promise<MarketplaceItem[]> {
		const cacheKey = "modes"
		const cached = this.getFromCache(cacheKey)

		if (cached) {
			return cached
		}

		const url = getApiUrl("/api/marketplace/modes") // kilocode_change
		const data = await this.fetchWithRetry<string>(url)

		const yamlData = yaml.parse(data)
		const validated = modeMarketplaceResponse.parse(yamlData)

		const items: MarketplaceItem[] = validated.items.map((item) => ({
			type: "mode" as const,
			...item,
		}))

		this.setCache(cacheKey, items)
		return items
	}

	private async fetchMcps(): Promise<MarketplaceItem[]> {
		const cacheKey = "mcps"
		const cached = this.getFromCache(cacheKey)

		if (cached) {
			return cached
		}

		const url = getApiUrl("/api/marketplace/mcps") // kilocode_change
		const data = await this.fetchWithRetry<string>(url)

		const yamlData = yaml.parse(data)
		const validated = mcpMarketplaceResponse.parse(yamlData)

		const items: MarketplaceItem[] = validated.items.map((item) => ({
			type: "mcp" as const,
			...item,
		}))

		this.setCache(cacheKey, items)
		return items
	}

	// kilocode_change start - fetch skills from marketplace API and transform to MarketplaceItem
	private async fetchSkills(): Promise<MarketplaceItem[]> {
		const cacheKey = "skills"
		const cached = this.getFromCache(cacheKey)

		if (cached) {
			return cached
		}

		// Convert kebab-case to Title Case (e.g., "my-skill" -> "My Skill")
		const kebabToTitleCase = (str: string): string =>
			str
				.split("-")
				.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
				.join(" ")

		const url = getApiUrl("/api/marketplace/skills")
		const data = await this.fetchWithRetry<string>(url)

		const yamlData = yaml.parse(data)
		const validated = skillsMarketplaceCatalogSchema.parse(yamlData)

		// Transform raw skills to MarketplaceItem format
		const items: MarketplaceItem[] = validated.items.map(
			(rawSkill): SkillMarketplaceItem => ({
				type: "skill" as const,
				id: rawSkill.id,
				name: rawSkill.id, // Use id as name (UI derives display name from id)
				description: rawSkill.description,
				category: rawSkill.category,
				githubUrl: rawSkill.githubUrl,
				rawUrl: rawSkill.rawUrl,
				displayName: kebabToTitleCase(rawSkill.id),
				displayCategory: kebabToTitleCase(rawSkill.category),
			}),
		)

		this.setCache(cacheKey, items)
		return items
	}
	// kilocode_change end

	private async fetchWithRetry<T>(url: string, maxRetries = 3): Promise<T> {
		let lastError: Error

		for (let i = 0; i < maxRetries; i++) {
			try {
				const response = await axios.get(url, {
					timeout: 10000, // 10 second timeout
					headers: {
						Accept: "application/json",
						"Content-Type": "application/json",
					},
				})
				return response.data as T
			} catch (error) {
				lastError = error as Error
				if (i < maxRetries - 1) {
					// Exponential backoff: 1s, 2s, 4s
					const delay = Math.pow(2, i) * 1000
					await new Promise((resolve) => setTimeout(resolve, delay))
				}
			}
		}

		throw lastError!
	}

	async getItem(id: string, type: MarketplaceItemType): Promise<MarketplaceItem | null> {
		const items = await this.loadAllItems()
		return items.find((item) => item.id === id && item.type === type) || null
	}

	private getFromCache(key: string): MarketplaceItem[] | null {
		const cached = this.cache.get(key)
		if (!cached) return null

		const now = Date.now()
		if (now - cached.timestamp > this.cacheDuration) {
			this.cache.delete(key)
			return null
		}

		return cached.data
	}

	private setCache(key: string, data: MarketplaceItem[]): void {
		this.cache.set(key, {
			data,
			timestamp: Date.now(),
		})
	}

	clearCache(): void {
		this.cache.clear()
	}
}
