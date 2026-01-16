import { z } from "zod"

/**
 * Theme type for categorization
 */
export const themeTypeSchema = z.enum(["dark", "light", "custom"])

/**
 * Core theme interface defining all color categories
 */
export const themeSchema = z.object({
	/** Theme identifier */
	id: z.string(),
	/** Theme display name */
	name: z.string(),
	/** Theme type for categorization */
	type: themeTypeSchema,

	/** Brand identity colors */
	brand: z.object({
		primary: z.string(),
		secondary: z.string(),
	}),

	/** Semantic colors for common states */
	semantic: z.object({
		success: z.string(),
		error: z.string(),
		warning: z.string(),
		info: z.string(),
		neutral: z.string(),
	}),

	/** Interactive element colors */
	interactive: z.object({
		prompt: z.string(),
		selection: z.string(),
		hover: z.string(),
		disabled: z.string(),
		focus: z.string(),
	}),

	/** Message type colors */
	messages: z.object({
		user: z.string(),
		assistant: z.string(),
		system: z.string(),
		error: z.string(),
	}),

	/** Action colors (unified approve/reject/cancel patterns) */
	actions: z.object({
		approve: z.string(),
		reject: z.string(),
		cancel: z.string(),
		pending: z.string(),
	}),

	/** Code and diff display colors */
	code: z.object({
		addition: z.string(),
		deletion: z.string(),
		modification: z.string(),
		context: z.string(),
		lineNumber: z.string(),
	}),

	/** Markdown rendering colors */
	markdown: z.object({
		text: z.string(),
		heading: z.string(),
		strong: z.string(),
		em: z.string(),
		code: z.string(),
		blockquote: z.string(),
		link: z.string(),
		list: z.string(),
	}),

	/** UI structure colors */
	ui: z.object({
		border: z.object({
			default: z.string(),
			active: z.string(),
			warning: z.string(),
			error: z.string(),
		}),
		text: z.object({
			primary: z.string(),
			secondary: z.string(),
			dimmed: z.string(),
			highlight: z.string(),
		}),
		background: z.object({
			default: z.string(),
			elevated: z.string(),
		}),
	}),

	/** Status indicator colors */
	status: z.object({
		online: z.string(),
		offline: z.string(),
		busy: z.string(),
		idle: z.string(),
	}),
})

/**
 * Theme identifier type - can be a built-in theme or custom theme ID
 */
export const themeIdSchema = z.union([z.literal("dark"), z.literal("light"), z.string()])

// Inferred types
export type ThemeType = z.infer<typeof themeTypeSchema>
export type Theme = z.infer<typeof themeSchema>
export type ThemeId = z.infer<typeof themeIdSchema>
