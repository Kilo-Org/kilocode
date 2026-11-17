export * as Telemetry from "./telemetry.js"

import { release } from "node:os"
import { Client } from "./client.js"
import { Identity } from "./identity.js"
import { TelemetryEvent } from "./events.js"

export interface TelemetryProperties {
  appName: string
  appVersion: string
  platform: string
  os_name: string
  os_version: string
  os_arch: string
  editorName?: string
  vscodeVersion?: string
}

export type ReviewCommand = "review"

export interface IndexingTelemetryProperties extends Record<string, unknown> {
  source: "scan" | "watcher"
  provider: string
  vectorStore: "lancedb" | "qdrant"
  modelId?: string
  trigger?: "background" | "manual"
  mode?: "full" | "incremental"
}

export interface IndexingCompletedTelemetryProperties extends IndexingTelemetryProperties {
  trigger: "background" | "manual"
  mode: "full" | "incremental"
  filesIndexed: number
  filesDiscovered: number
  totalBlocks: number
  batchErrors: number
}

export interface IndexingFileCountTelemetryProperties extends IndexingTelemetryProperties {
  mode: "full" | "incremental"
  discovered: number
  candidate: number
}

export interface IndexingRetryTelemetryProperties extends IndexingTelemetryProperties {
  mode: "full" | "incremental"
  attempt: number
  maxRetries: number
  batchSize: number
  error: string
}

export interface IndexingErrorTelemetryProperties extends IndexingTelemetryProperties {
  location: string
  error: string
  retryCount?: number
  maxRetries?: number
}

export interface FeedbackProperties extends Record<string, unknown> {
  providerID: string
  modelID: string
  variant?: string
  rating: "up" | "down" | "cleared"
  previousRating?: "up" | "down"
  sessionID?: string
  messageID?: string
  parentMessageID?: string
}

const state = {
  initialized: false,
  startTime: 0,
  props: {
    appName: "kilo-cli",
    appVersion: "unknown",
    platform: process.platform,
    os_name: process.platform,
    os_version: release(),
    os_arch: process.arch,
  } as TelemetryProperties,
}

/**
 * Create the PostHog client once per process. `enabled` is the caller's decision (consent and config); the engine
 * does not read a consent variable itself. `host` replaces the PostHog endpoint, for a local stand-in.
 */
export async function init(options: { dataPath: string; version: string; enabled: boolean; host?: string }): Promise<void> {
  if (state.initialized) return
  state.initialized = true

  Identity.setDataPath(options.dataPath)
  state.props.appVersion = options.version

  const app = process.env.KILO_APP_NAME
  if (app) state.props.appName = app
  const editor = process.env.KILO_EDITOR_NAME
  if (editor) state.props.editorName = editor
  const platform = process.env.KILO_PLATFORM
  if (platform) state.props.platform = platform
  const version = process.env.KILO_APP_VERSION
  if (version) state.props.appVersion = version
  const vscodeVersion = process.env.KILO_VSCODE_VERSION
  if (vscodeVersion) state.props.vscodeVersion = vscodeVersion

  Client.setEnabled(options.enabled)
  Client.init(options.dataPath, options.host)

  await Identity.getMachineId()

  state.startTime = Date.now()
}

export function initialized() {
  return state.initialized
}

export function setEnabled(value: boolean) {
  Client.setEnabled(value)
}

export function isEnabled(): boolean {
  return Client.isEnabled()
}

export async function updateIdentity(token: string | null, accountId?: string | null, server?: string): Promise<void> {
  if (!isEnabled()) return

  await Identity.updateFromKiloAuth(token, accountId, server)
  const email = Identity.getUserId()
  // Link the anonymous machine ID to the authenticated email. Not the previous distinct ID: after an account switch
  // in the same process that is the other account's email, and aliasing it would merge two people.
  const machine = await Identity.getMachineId()
  if (email && machine && email !== machine) Client.alias(email, machine)
}

// The PostHog project and the identities are shared with the other Kilo line, so every event names its line.
const LINE = "v2"

export function track(event: string, properties?: Record<string, unknown>) {
  const org = Identity.getOrganizationId()
  const props = state.props
  Client.capture(event, {
    ...props,
    ...properties,
    kiloLine: LINE,
    ...(Identity.getUserId() &&
      (event === TelemetryEvent.CLI_START || event === TelemetryEvent.AUTH_SUCCESS) && {
        $set: {
          ...(org && { kilocodeOrganizationId: org }),
          appName: props.appName,
          appVersion: props.appVersion,
          platform: props.platform,
          os_name: props.os_name,
          os_version: props.os_version,
          os_arch: props.os_arch,
        },
      }),
  })
}

// CLI Lifecycle
export function trackCliStart() {
  track(TelemetryEvent.CLI_START)
}

// Upload queued events without blocking, so the flush overlaps with the work that follows and shutdown() stays fast.
export function flushInBackground() {
  Client.flushInBackground()
}

export function trackCliExit(exitCode?: number) {
  track(TelemetryEvent.CLI_EXIT, {
    duration: Date.now() - state.startTime,
    exitCode,
  })
}

// Sessions
export function trackSessionStart(sessionId: string, model?: string, provider?: string) {
  track(TelemetryEvent.SESSION_START, { sessionId, model, provider })
}

export function trackSessionEnd(
  sessionId: string,
  stats: {
    messageCount?: number
    inputTokens?: number
    outputTokens?: number
    duration?: number
  },
) {
  track(TelemetryEvent.SESSION_END, { sessionId, ...stats })
}

export function trackSessionMessage(sessionId: string, source: "user" | "assistant") {
  track(TelemetryEvent.SESSION_MESSAGE, { sessionId, source })
}

// LLM
export function trackLlmCompletion(properties: {
  taskId?: string
  mode?: "review"
  feature?: "code_reviews"
  command?: ReviewCommand
  tool?: "suggest"
  apiProvider: string
  modelId: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  cost?: number
  completionTime?: number
  duration?: number
}) {
  track(TelemetryEvent.LLM_COMPLETION, properties)
}

// Features
export function trackCommandUsed(command: string) {
  track(TelemetryEvent.COMMAND_USED, { command })
}

export function trackToolUsed(tool: string, sessionId?: string) {
  track(TelemetryEvent.TOOL_USED, { tool, sessionId })
}

export function trackAgentUsed(agent: string, sessionId?: string) {
  track(TelemetryEvent.AGENT_USED, { agent, sessionId })
}

export function trackPlanFollowup(
  sessionId: string,
  choice: "new_session" | "continue" | "keep_refining" | "custom" | "dismissed",
) {
  track(TelemetryEvent.PLAN_FOLLOWUP, { sessionId, choice })
}

export function trackSuggestionAccepted(properties: {
  sessionId: string
  requestId: string
  index: number
  tool: "suggest"
  command: ReviewCommand
  actionCount?: number
}) {
  track(TelemetryEvent.SUGGESTION_ACCEPTED, properties)
}

export function trackSuggestionShown(properties: {
  sessionId: string
  requestId: string
  index: number
  tool: "suggest"
  command: ReviewCommand
  actionCount?: number
}) {
  track(TelemetryEvent.SUGGESTION_SHOWN, properties)
}

export function trackIndexingStarted(properties: IndexingTelemetryProperties) {
  track(TelemetryEvent.INDEXING_STARTED, properties)
}

export function trackIndexingCompleted(properties: IndexingCompletedTelemetryProperties) {
  track(TelemetryEvent.INDEXING_COMPLETED, properties)
}

export function trackIndexingFileCount(properties: IndexingFileCountTelemetryProperties) {
  track(TelemetryEvent.INDEXING_FILE_COUNT, properties)
}

export function trackIndexingBatchRetry(properties: IndexingRetryTelemetryProperties) {
  track(TelemetryEvent.INDEXING_BATCH_RETRY, properties)
}

export function trackIndexingError(properties: IndexingErrorTelemetryProperties) {
  track(TelemetryEvent.INDEXING_ERROR, properties)
}

// Share
export function trackShareCreated(sessionId: string) {
  track(TelemetryEvent.SHARE_CREATED, { sessionId })
}

export function trackShareDeleted(sessionId: string) {
  track(TelemetryEvent.SHARE_DELETED, { sessionId })
}

// MCP
export function trackMcpServerConnected(server: string) {
  track(TelemetryEvent.MCP_SERVER_CONNECTED, { server })
}

export function trackMcpServerError(server: string, error?: string) {
  track(TelemetryEvent.MCP_SERVER_ERROR, { server, error })
}

// Remote
export function trackRemoteConnectionOpened() {
  track(TelemetryEvent.REMOTE_CONNECTION_OPENED)
}

// Auth
export function trackAuthSuccess(provider: string) {
  track(TelemetryEvent.AUTH_SUCCESS, { provider })
}

export function trackAuthLogout(provider: string) {
  track(TelemetryEvent.AUTH_LOGOUT, { provider })
}

// Errors
export function trackError(error: string, context?: string) {
  track(TelemetryEvent.ERROR, { error, context })
}

// Feedback
export function trackFeedback(props: FeedbackProperties) {
  track(TelemetryEvent.FEEDBACK_SUBMITTED, props)
}

/** Drain the queue within `timeoutMs` and drop the client; a later `init` creates a new one. */
export async function shutdown(timeoutMs?: number): Promise<void> {
  state.initialized = false
  await Client.shutdown(timeoutMs)
}
