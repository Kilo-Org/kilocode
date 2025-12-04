/**
 * Feature flags for development-only features
 */

/**
 * Enable model selection for autocomplete in development mode.
 * This allows developers to test different models for autocomplete functionality.
 */
export const MODEL_SELECTION_ENABLED = process.env.NODE_ENV === "development";

/**
 * Enable the Agent Manager feature in development mode.
 * This allows developers to test the multi-agent orchestration functionality.
 */
export const AGENT_MANAGER_ENABLED = process.env.NODE_ENV === "development";
