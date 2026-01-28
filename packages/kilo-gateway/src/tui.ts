/**
 * Kilo Gateway TUI Integration
 *
 * This module provides TUI-specific functionality for kilo-gateway.
 * It requires OpenCode TUI dependencies to be injected at runtime.
 *
 * Import from "@kilocode/kilo-gateway/tui" for TUI features.
 */

// ============================================================================
// TUI Dependency Injection
// ============================================================================
export { initializeTUIDependencies, getTUIDependencies, areTUIDependenciesInitialized } from "./tui/context.js"
export type { TUIDependencies } from "./tui/types.js"

// ============================================================================
// TUI Helpers
// ============================================================================
export { formatProfileInfo, getOrganizationOptions, getDefaultOrganizationSelection } from "./tui/helpers.js"

// ============================================================================
// TUI Components (requires solid-js and @opentui/*)
// ============================================================================
export { registerKiloCommands } from "./tui/commands/kilo-commands.js"
export { DialogKiloTeamSelect } from "./tui/components/dialog-kilo-team-select.js"
export { DialogKiloOrganization } from "./tui/components/dialog-kilo-organization.js"
export { KiloAutoMethod } from "./tui/components/dialog-kilo-auto-method.js"
export { KiloNews } from "./tui/components/kilo-news.js"

// ============================================================================
// Re-exported Types
// ============================================================================
export type { KilocodeNotification } from "./api/notifications.js"
