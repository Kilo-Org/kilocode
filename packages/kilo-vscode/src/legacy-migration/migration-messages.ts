/**
 * legacy-migration - Message type definitions for migration wizard communication.
 *
 * These types extend the extension ↔ webview message contract specifically for
 * the legacy migration wizard. They are defined here to keep them isolated from
 * the main messages.ts file and easy to remove.
 */

import type {
  MigrationProviderInfo,
  MigrationMcpServerInfo,
  MigrationCustomModeInfo,
  MigrationSelections,
  MigrationResultItem,
  LegacySettings,
} from "./legacy-types"

// ---------------------------------------------------------------------------
// Extension → Webview
// ---------------------------------------------------------------------------

/** Sends detected legacy data to the wizard for display in the selection step. */
export interface LegacyMigrationDataMessage {
  type: "legacyMigrationData"
  data: {
    providers: MigrationProviderInfo[]
    mcpServers: MigrationMcpServerInfo[]
    customModes: MigrationCustomModeInfo[]
    defaultModel?: { provider: string; model: string }
    settings?: LegacySettings
  }
}

/** Real-time progress update for a single item being migrated. */
export interface LegacyMigrationProgressMessage {
  type: "legacyMigrationProgress"
  item: string
  status: "migrating" | "success" | "warning" | "error"
  message?: string
}

/** Final results once all selected items have been processed. */
export interface LegacyMigrationCompleteMessage {
  type: "legacyMigrationComplete"
  results: MigrationResultItem[]
}

// ---------------------------------------------------------------------------
// Webview → Extension
// ---------------------------------------------------------------------------

/** Webview requests the legacy data payload (e.g. on component mount). */
export interface RequestLegacyMigrationDataMessage {
  type: "requestLegacyMigrationData"
}

/** User has confirmed selections and wants to start migration. */
export interface StartLegacyMigrationMessage {
  type: "startLegacyMigration"
  selections: MigrationSelections
}

/** User chose to skip migration entirely. */
export interface SkipLegacyMigrationMessage {
  type: "skipLegacyMigration"
}

/** User opted to clear legacy data after successful migration. */
export interface ClearLegacyDataMessage {
  type: "clearLegacyData"
}
