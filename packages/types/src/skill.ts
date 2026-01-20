// kilocode_change new file

import { z } from "zod"

/**
 * Type definitions for Skills Marketplace items
 *
 * These types define the structure of skills data that will be served
 * from the Skills Marketplace API and displayed in the UI.
 */

/**
 * Schema for raw skill data from the API (before transformation to MarketplaceItem)
 */
export const rawSkillSchema = z.object({
	// Core identity
	id: z.string(),
	description: z.string(),

	// Categorization
	category: z.string(),

	// URLs for viewing/downloading
	githubUrl: z.string(),
	// Tarball URL for installation (provided by API)
	content: z.string(),
})

export type RawSkill = z.infer<typeof rawSkillSchema>

/**
 * A skill as a marketplace item (extends base marketplace item schema)
 * This is defined in marketplace.ts as part of the discriminated union
 */
export const skillMarketplaceItemSchema = z.object({
	type: z.literal("skill"),
	id: z.string().min(1),
	name: z.string().min(1),
	description: z.string(),
	author: z.string().optional(),
	authorUrl: z.string().url("Author URL must be a valid URL").optional(),
	tags: z.array(z.string()).optional(),
	prerequisites: z.array(z.string()).optional(),
	// Skill-specific fields
	category: z.string(),
	githubUrl: z.string(),
	// content is the URL to the tarball (.tar.gz) - used for installation
	content: z.string(),
	// Display fields (computed from id and category)
	displayName: z.string(),
	displayCategory: z.string(),
})

export type SkillMarketplaceItem = z.infer<typeof skillMarketplaceItemSchema>

export function isSkillItem(item: { type: string }): item is SkillMarketplaceItem {
	return item.type === "skill"
}

/**
 * Container for raw skills from the API (the YAML output format from backend)
 */
export const skillsMarketplaceCatalogSchema = z.object({
	items: z.array(rawSkillSchema),
})

export type SkillsMarketplaceCatalog = z.infer<typeof skillsMarketplaceCatalogSchema>
