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

// Phase 7 — Configurable Workflow DAG
export { WorkflowDAG, WorkflowDAGEdge, DAGOverride } from "./dag/schema"
export type { WorkflowDAG as WorkflowDAGType, WorkflowDAGEdge as WorkflowDAGEdgeType, DAGOverride as DAGOverrideType } from "./dag/schema"
export { validateDAG, formatDAGError } from "./dag/validator"
export type { DAGError } from "./dag/validator"
export { getNextStage, getEntryStage, generateDefaultDAG } from "./dag/helpers"

// Phase 10 — Live Team Editing (position swap)
export { PositionSwapRequest, PositionSwapResult, PositionSwapSuccess, PositionSwapFailure, PositionSwapErrorCode } from "./position-swap"
export { validatePositionSwap, applyPositionSwap } from "./position-swap"

// Phase 8 — Team Registry & Marketplace
export { publishManifest, installManifest } from "./registry/io"
export type { PublishOptions, InstallOptions } from "./registry/io"
export { TeamRegistryManifest, TeamManifestMetadata, RegistryIndex } from "./registry/manifest"
export type { TeamRegistryManifest as TeamRegistryManifestType } from "./registry/manifest"
export { TeamRegistryError, TeamSignatureError, TeamPublisherNotTrusted, TeamManifestFetchFailed, TeamManifestInvalid } from "./registry/errors"
export { generateKeyPair, signManifest, verifyManifestSignature, getPublicKeyFingerprint, computeSignaturePayload } from "./registry/signing"
export { loadTrustStore, saveTrustStore, addTrustedPublisher, removeTrustedPublisher, getTrustedPublisher, listTrustedPublishers } from "./registry/trust-store"
