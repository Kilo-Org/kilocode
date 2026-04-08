/**
 * Devil Gateway TUI Integration
 *
 * This module provides TUI-specific functionality for kilo-gateway.
 * It requires OpenCode TUI dependencies to be injected at runtime.
 *
 * Import from "@devilcode/kilo-gateway/tui" for TUI features.
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
// NOTE: TUI Components Moved to OpenCode
// ============================================================================
// All TUI components with JSX have been moved to packages/opencode/src/devilcode/
// to ensure correct JSX transpilation with @opentui/solid.
//
// Components moved:
// - registerDevilCommands -> @/devilcode/kilo-commands
// - DialogDevilTeamSelect -> @/devilcode/components/dialog-kilo-team-select
// - DialogDevilOrganization -> @/devilcode/components/dialog-kilo-organization
// - DialogDevilProfile -> @/devilcode/components/dialog-kilo-profile
// - DevilAutoMethod -> @/devilcode/components/dialog-kilo-auto-method
// - DevilNews -> @/devilcode/components/kilo-news
// - NotificationBanner -> @/devilcode/components/notification-banner
// - DialogDevilNotifications -> @/devilcode/components/dialog-kilo-notifications
