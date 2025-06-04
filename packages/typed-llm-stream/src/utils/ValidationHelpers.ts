import { z } from "zod"

/**
 * Common validation patterns for LLM data
 */
export const ValidationHelpers = {
	/**
	 * Creates a confidence score schema with optional validation
	 */
	confidenceScore: (min = 0, max = 1, required = false) => {
		const schema = z
			.number()
			.min(min, `Confidence score must be at least ${min}`)
			.max(max, `Confidence score must be at most ${max}`)

		return required ? schema : schema.optional()
	},

	/**
	 * Creates a schema for a list of reasons with validation
	 */
	reasonsList: (minReasons = 1, maxReasons = 10, required = true) => {
		const schema = z
			.array(z.string())
			.min(minReasons, `At least ${minReasons} reason(s) must be provided`)
			.max(maxReasons, `At most ${maxReasons} reasons can be provided`)

		return required ? schema : schema.optional()
	},

	/**
	 * Creates a schema for a metadata object
	 */
	metadata: (required = false) => {
		const schema = z.object({}).passthrough()
		return required ? schema : schema.optional()
	},

	/**
	 * Creates a schema for a timestamp
	 */
	timestamp: (required = false) => {
		const schema = z.string().datetime({ message: "Invalid ISO timestamp format" })
		return required ? schema : schema.optional()
	},

	/**
	 * Creates a schema for a code snippet
	 */
	codeSnippet: (minLength = 1, required = true) => {
		const schema = z.string().min(minLength, `Code snippet must be at least ${minLength} characters`)
		return required ? schema : schema.optional()
	},

	/**
	 * Creates a schema for a semantic version string
	 */
	semver: (required = false) => {
		const schema = z
			.string()
			.regex(
				/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
				"Invalid semantic version format",
			)

		return required ? schema : schema.optional()
	},

	/**
	 * Creates a schema for a URL
	 */
	url: (required = false) => {
		const schema = z.string().url()
		return required ? schema : schema.optional()
	},

	/**
	 * Creates a schema for a file path
	 */
	filePath: (required = false) => {
		const schema = z.string()
		return required ? schema : schema.optional()
	},
}

/**
 * Common schema builders for LLM tools
 */
export const SchemaBuilders = {
	/**
	 * Creates a basic suggestion schema with common fields
	 */
	suggestion: <T extends z.ZodTypeAny>(dataSchema: T) => {
		return z.object({
			suggestion: dataSchema,
			confidence: ValidationHelpers.confidenceScore(),
			reasons: ValidationHelpers.reasonsList(),
			metadata: ValidationHelpers.metadata(),
		})
	},

	/**
	 * Creates a code suggestion schema
	 */
	codeSuggestion: () => {
		return SchemaBuilders.suggestion(
			z.object({
				code: ValidationHelpers.codeSnippet(),
				description: z.string().min(1, "Description is required"),
				language: z.string().min(1, "Language is required"),
			}),
		)
	},

	/**
	 * Creates a list suggestion schema
	 */
	listSuggestion: <T extends z.ZodTypeAny>(itemSchema: T, minItems = 1, maxItems = 10) => {
		return SchemaBuilders.suggestion(
			z.object({
				title: z.string().min(1, "Title is required"),
				items: z
					.array(itemSchema)
					.min(minItems, `At least ${minItems} item(s) required`)
					.max(maxItems, `At most ${maxItems} items allowed`),
			}),
		)
	},
}
