import { Client } from "./client.js"
import { Identity } from "./identity.js"
import { TelemetryEvent } from "./events.js"
import { TracerSetup } from "./tracer.js"
import type { Tracer } from "@opentelemetry/api"

export interface TelemetryProperties {
  appName: string
  appVersion: string
  platform: string
}

export namespace Telemetry {
  let initialized = false
  let startTime = 0
  let props: TelemetryProperties = {
    appName: "kilo-cli",
    appVersion: "unknown",
    platform: process.platform,
  }

  export async function init(options: { dataPath: string; version: string; enabled: boolean }): Promise<void> {
    if (initialized) return

    Identity.setDataPath(options.dataPath)
    props.appVersion = options.version

    Client.init()
    Client.setEnabled(options.enabled)

    // Initialize OpenTelemetry tracer for AI SDK spans
    TracerSetup.init({ version: options.version, enabled: options.enabled })

    await Identity.getMachineId()

    initialized = true
    startTime = Date.now()
  }

  export function setEnabled(value: boolean) {
    Client.setEnabled(value)
    TracerSetup.setEnabled(value)
  }

  /**
   * Get the OpenTelemetry tracer for use with AI SDK's experimental_telemetry.
   * Returns null if telemetry is not initialized.
   */
  export function getTracer(): Tracer | null {
    return TracerSetup.getTracer()
  }

  export function isEnabled(): boolean {
    return Client.isEnabled()
  }

  export async function updateIdentity(
    token: string | null,
    accountId?: string,
    options?: { disableForOrg?: boolean },
  ): Promise<void> {
    const previousId = Identity.getDistinctId()
    await Identity.updateFromKiloAuth(token, accountId)

    // Disable telemetry for organizational users only (never auto-enable to respect explicit opt-out)
    const disableForOrg = options?.disableForOrg ?? true
    if (disableForOrg && Identity.isOrganizationalUser()) {
      setEnabled(false)
    }

    const email = Identity.getUserId()
    if (email && previousId && email !== previousId) {
      // Identify the user with their email and properties
      Client.identify(email, {
        ...(accountId && { kilocodeOrganizationId: accountId }),
        appName: props.appName,
        appVersion: props.appVersion,
        platform: props.platform,
      })

      // Link the anonymous machineId to the authenticated email
      Client.alias(email, previousId)
    }
  }

  export function track(event: TelemetryEvent, properties?: Record<string, unknown>) {
    Client.capture(event, { ...props, ...properties })
  }

  // CLI Lifecycle
  export function trackCliStart() {
    track(TelemetryEvent.CLI_START)
  }

  export function trackCliExit(exitCode?: number) {
    track(TelemetryEvent.CLI_EXIT, {
      duration: Date.now() - startTime,
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
    sessionId?: string
    provider: string
    model: string
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
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

  export async function shutdown(): Promise<void> {
    await TracerSetup.shutdown()
    await Client.shutdown()
  }
}
