/**
 * Feature flags for development-only features
 */

/**
 * Enable model selection for autocomplete in development mode.
 * This allows developers to test different models for autocomplete functionality.
 */
export const MODEL_SELECTION_ENABLED = process.env.NODE_ENV === "development"

/**
 * Enable extreme snooze values for autocomplete in development mode.
 */
export const EXTREME_SNOOZE_VALUES_ENABLED = process.env.NODE_ENV === "development"
