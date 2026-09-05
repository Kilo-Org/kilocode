import { z } from "zod"
import {
  projectStatus,
  resultExitCode,
  type AgentResultExitCode,
  type AgentSendRequest,
  type AgentSendResponse,
  type AgentStartRequest,
  type AgentStartResponse,
  type AgentStatus,
  type GetMessageResultInput,
  type MessageResult,
} from "./contracts"
import { CloudError } from "./errors"
import { parseServiceOrigin, type ServiceOrigin } from "./origin"
import { createStreamTicketClient, type StreamTicketClient } from "./stream-ticket"
import { createCloudAgentClient, type AgentClient } from "./trpc"
import { resolveWebSocketUrl, streamAgentEvents, type StreamAgentEventsOptions } from "./websocket-stream"

// The organization ID is forwarded to the cloud agent as a tRPC input field and
// to the web-app ticket endpoint; the wire contract requires a UUID.
const OrganizationIdSchema = z.string().uuid()

// The adapter is the only entry point the host wires against. It is handed a
// fully-resolved bearer token, optional organization ID, and both service
// origins; it never reads a credential store, environment variable, or global
// on its own. Resolution of `token`/`organizationId` from auth/config storage is
// the caller's (parent's) responsibility.
export interface CloudConnection {
  readonly token: string
  readonly organizationId?: string
  readonly agentOrigin: ServiceOrigin
  readonly webAppOrigin: ServiceOrigin
}

export interface CloudAdapterOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly WebSocket?: typeof WebSocket | undefined
  readonly timeoutMs?: number
  // Test/dev escape hatch matching parseServiceOrigin's contract. Production
  // callers leave this unset so only HTTPS origins are accepted; loopback HTTP
  // is admitted only for a local stub server when explicitly enabled.
  readonly allowHttpLoopback?: boolean
  readonly ticketClient?: (options: { readonly origin: ServiceOrigin; readonly apiKey: string }) => StreamTicketClient
  readonly stream?: (options: StreamAgentEventsOptions) => Promise<void>
}

export interface CloudAdapter {
  start(input: AgentStartRequest): Promise<AgentStartResponse>
  send(input: AgentSendRequest): Promise<AgentSendResponse>
  status(input: GetMessageResultInput): Promise<AgentStatus>
  result(input: GetMessageResultInput): Promise<{ readonly result: MessageResult; readonly exitCode: AgentResultExitCode }>
  // prepare resolves the WebSocket stream target for a session. A provided
  // streamUrl is validated and pinned to the agent origin first; only when it
  // is absent is a stream ticket fetched. Origin validation always precedes any
  // ticket forward so a caller-provided URL can never redirect the ticket.
  prepare(input: {
    readonly cloudAgentSessionId: string
    readonly streamUrl?: string
  }): Promise<{ readonly origin: string; readonly streamUrl: string }>
  streamEvents(options: {
    readonly streamUrl: string
    readonly writeLine: (line: string) => void | Promise<void>
    readonly signal?: AbortSignal | undefined
  }): Promise<void>
}

export function createCloudAdapter(connection: CloudConnection, options: CloudAdapterOptions = {}): CloudAdapter {
  if (typeof connection.token !== "string" || connection.token.trim() === "") {
    throw new CloudError("A bearer token is required")
  }
  if (connection.organizationId !== undefined && !OrganizationIdSchema.safeParse(connection.organizationId).success) {
    throw new CloudError("Kilo organization ID must be a valid UUID")
  }
  const agentOrigin = parseServiceOrigin(connection.agentOrigin, { allowHttpLoopback: options.allowHttpLoopback })
  const webAppOrigin = parseServiceOrigin(connection.webAppOrigin, { allowHttpLoopback: options.allowHttpLoopback })

  const agent: AgentClient = createCloudAgentClient({
    origin: agentOrigin,
    apiKey: connection.token,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  })

  return {
    start(input) {
      return agent.start(withOrganization(input, connection.organizationId))
    },
    send(input) {
      return agent.send(input)
    },
    async status(input) {
      return projectStatus(await agent.getMessageResult(input))
    },
    async result(input) {
      const result = await agent.getMessageResult(input)
      return { result, exitCode: resultExitCode(result.status) }
    },
    async prepare({ cloudAgentSessionId, streamUrl: provided }) {
      if (provided !== undefined) {
        // Validate and pin the caller-provided URL to the agent origin before
        // any ticket fetch; a cross-origin URL is rejected, never followed.
        return { origin: agentOrigin, streamUrl: resolveWebSocketUrl(provided, agentOrigin) }
      }
      const ticket = (options.ticketClient ?? createStreamTicketClient)({
        origin: webAppOrigin,
        apiKey: connection.token,
      })
      const fetched = await ticket.fetchTicket({
        cloudAgentSessionId,
        ...(connection.organizationId === undefined ? {} : { organizationId: connection.organizationId }),
      })
      const params = new URLSearchParams({ cloudAgentSessionId, ticket: fetched.ticket })
      return { origin: agentOrigin, streamUrl: `/stream?${params.toString()}` }
    },
    streamEvents({ streamUrl, writeLine, signal }) {
      return (options.stream ?? streamAgentEvents)({
        streamUrl,
        origin: agentOrigin,
        writeLine,
        ...(options.WebSocket === undefined ? {} : { WebSocket: options.WebSocket }),
        ...(signal === undefined ? {} : { signal }),
      })
    },
  }
}

function withOrganization(input: AgentStartRequest, organizationId: string | undefined): AgentStartRequest {
  if (organizationId === undefined) return input
  return {
    ...input,
    options: { ...input.options, kilocodeOrganizationId: organizationId },
  }
}
