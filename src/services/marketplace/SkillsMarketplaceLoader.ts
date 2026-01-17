import { z } from "zod"
import type { SkillMarketplaceItem, MarketplaceItem } from "@roo-code/types"

// kilocode_change start
// Static skills JSON file
import skillsJson from "./skills.json"

// Schema for static skills response
const staticSkillsResponseSchema = z.object({
	skills: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			description: z.string(),
			author: z.null().or(z.string()),
			authorUrl: z.null().or(z.string()),
			tags: z.array(z.string()),
			prerequisites: z.array(z.string()),
			repository: z
				.object({
					fullName: z.string(),
					stars: z.number(),
					forks: z.number(),
					url: z.string(),
					pushedAt: z.string(),
				})
				.optional(),
			category: z.string().optional(),
			hasInstallCommand: z.boolean().optional(),
			skillFile: z.string().optional(),
			marketplaceJson: z.null().or(
				z.object({
					name: z.string(),
					version: z.string().optional(),
					installCommand: z.string().optional(),
					description: z.string().optional(),
				}),
			),
		}),
	),
	generatedAt: z.string(),
	sourceRepo: z.string(),
	version: z.string(),
})

type StaticSkillsResponse = z.infer<typeof staticSkillsResponseSchema>

// kilocode_change end

export class SkillsMarketplaceLoader {
	private cache: Map<string, { data: MarketplaceItem[]; timestamp: number }> = new Map()
	private cacheDuration = 5 * 60 * 1000 // 5 minutes

	async fetchAllSkills(): Promise<MarketplaceItem[]> {
		const cacheKey = "skills"
		const cached = this.getFromCache(cacheKey)

		if (cached) {
			return cached
		}

		const skills = await this.loadSkillsFromStaticJson()

		this.setCache(cacheKey, skills)
		return skills
	}

	// kilocode_change start
	// Load skills from static JSON file (lazy-loaded)
	private async loadSkillsFromStaticJson(): Promise<MarketplaceItem[]> {
		try {
			// Dynamic import for lazy loading
			const json = skillsJson as StaticSkillsResponse
			const validated = staticSkillsResponseSchema.parse(json)

			return validated.skills.map(
				(skill) =>
					({
						type: "skill" as const,
						id: skill.id,
						name: skill.name,
						description: skill.description,
						author: skill.author ?? undefined,
						authorUrl: skill.authorUrl ?? undefined,
						tags: skill.tags,
						prerequisites: skill.prerequisites,
						repository: skill.repository,
						category: skill.category,
						hasInstallCommand: skill.hasInstallCommand,
						skillFile: skill.skillFile,
						marketplaceJson: skill.marketplaceJson ?? undefined,
					}) satisfies MarketplaceItem,
			)
		} catch (error) {
			console.error("Failed to load static skills JSON:", error)
			return []
		}
	}
	// kilocode_change end

	async getSkill(id: string): Promise<SkillMarketplaceItem | null> {
		const skills = await this.fetchAllSkills()
		const skill = skills.find((item) => item.type === "skill" && item.id === id)
		return skill as SkillMarketplaceItem | null
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
