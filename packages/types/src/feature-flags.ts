/**
 * Feature flags for development-only features
 */

/**
 * Enable extreme snooze values for ghost autocomplete in development mode.
 */
export const EXTREME_SNOOZE_VALUES_ENABLED = process.env.NODE_ENV === "development"
