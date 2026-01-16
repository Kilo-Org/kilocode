import { z } from "zod"
import { providerConfigSchema } from "./provider.js"
import { autoApprovalConfigSchema } from "./auto-approval.js"
import { themeSchema, themeIdSchema } from "../theme/theme.js"

/**
 * Default maximum number of files that can be read in a single read_file request.
 * This is a CLI-specific constant that matches the extension's default value.
 */
export const DEFAULT_MAX_CONCURRENT_FILE_READS = 5

/**
 * CLI configuration schema
 */
export const cliConfigSchema = z.object({
	version: z.literal("1.0.0"),
	mode: z.string(),
	telemetry: z.boolean(),
	provider: z.string(),
	providers: z.array(providerConfigSchema),
	autoApproval: autoApprovalConfigSchema.optional(),
	theme: themeIdSchema.optional(),
	customThemes: z.record(z.string(), themeSchema).optional(),
	maxConcurrentFileReads: z.number().min(1).default(DEFAULT_MAX_CONCURRENT_FILE_READS).optional(),
})

// Inferred type
export type CLIConfig = z.infer<typeof cliConfigSchema>

// Type guard
export function isValidConfig(config: unknown): config is CLIConfig {
	return cliConfigSchema.safeParse(config).success
}

/**
 * Validation result structure
 */
export const validationResultSchema = z.object({
	valid: z.boolean(),
	errors: z
		.array(
			z.object({
				path: z.array(z.union([z.string(), z.number()])),
				message: z.string(),
			}),
		)
		.optional(),
})

export type ValidationResult = z.infer<typeof validationResultSchema>

/**
 * Config load result structure
 */
export const configLoadResultSchema = z.object({
	config: cliConfigSchema.optional(),
	validation: validationResultSchema,
})

export type ConfigLoadResult = z.infer<typeof configLoadResultSchema>
