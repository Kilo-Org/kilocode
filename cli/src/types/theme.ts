/**
 * Theme Types
 *
 * Re-exports types from @kilocode/core-schemas for runtime validation
 * and backward compatibility with existing code.
 */

// Re-export all theme types from core-schemas
export {
	// Schemas
	themeTypeSchema,
	themeSchema,
	themeIdSchema,
	// Types
	type ThemeType,
	type Theme,
	type ThemeId,
} from "@kilocode/core-schemas"
