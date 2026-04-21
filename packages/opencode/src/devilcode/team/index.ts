export { EffortLevel, ReactionRule } from "./config"
export {
  CanonicalTeamConfig,
  CanonicalTeamRole,
  CanonicalTeamRouting,
} from "./config"
export type {
  CanonicalTeamConfig as CanonicalTeamConfigType,
  CanonicalTeamRole as CanonicalTeamRoleType,
  CanonicalTeamRouting as CanonicalTeamRoutingType,
  ReactionRule as ReactionRuleType,
} from "./config"
export { resolveTaskModel, TeamDelegationError, TeamConcurrencyError } from "./router"
export type { ResolvedTaskModel } from "./router"
export { ConcurrencyManager, getConcurrencyManager } from "./concurrency"
export { effortToProviderOptions } from "./effort"
export { createWorkflowAgents } from "./agents"
export { TeamTaskResult, Escalation, TaskResultStatus } from "./types"
export { fromLegacyTeamConfig, migrateLegacyTeamConfig, migrateLegacyTeamConfigFile } from "./migration"
export type { LegacyMigrationIssue, LegacyMigrationResult } from "./migration"
export { loadQuickstartTemplates, getQuickstart, QUICKSTART_IDS } from "./quickstarts"
export type { QuickstartTemplate, QuickstartId } from "./quickstarts"
export { POSITION_LIBRARY } from "./library"
export type { CanonicalPosition } from "./library"
export { STAGE_CAPABILITY_REQUIREMENTS } from "./capabilities"
export type { CanonicalCapability } from "./capabilities"
export type { TeamHandle, TeamRepository, CreateFileSystemTeamRepositoryOptions } from "./repository"
export { createFileSystemTeamRepository } from "./repository"

// Phase 6 — Export/Import & Persistence Layer (public surface only; internal symbols imported via deep paths)
export { TeamImportError, TeamVersionMismatchError, TeamChecksumError, TeamSchemaValidationError } from "./errors"
export type { TeamImportErrorKind } from "./errors"
export { TeamExportEnvelope } from "./export-envelope"
export { exportTeamToFile, importTeamFromFile } from "./io"
export { createLayeredTeamRepository } from "./layered-repository"
export { createProjectLocalTeamRepository } from "./repositories/project-local"
export { createQuickstartTeamRepository } from "./repositories/quickstart"
