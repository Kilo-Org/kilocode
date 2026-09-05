import z from "zod"
import { CloudError } from "./errors"
import { type ServiceOrigin } from "./origin"
import { readBoundedJson } from "./response-json"

const MAX_STREAM_TICKET_RESPONSE_BYTES = 64 * 1024
const STREAM_TICKET_TIMEOUT_MS = 30_000
const TICKET_RETRY_ATTEMPTS = 10
const TICKET_RETRY_DELAY_MS = 1000

const StreamTicketResponseSchema = z.object({
  ticket: z.string().min(1),
  expiresAt: z.number(),
})

export interface StreamTicket {
  readonly ticket: string
  readonly expiresAt: number
}

export interface StreamTicketClient {
  fetchTicket(input: { readonly cloudAgentSessionId: string; readonly organizationId?: string }): Promise<StreamTicket>
}

export interface CreateStreamTicketClientOptions {
  readonly origin: ServiceOrigin
  readonly apiKey: string
  readonly fetch?: typeof globalThis.fetch
}

export function createStreamTicketClient(options: CreateStreamTicketClientOptions): StreamTicketClient {
  const fetcher = options.fetch ?? globalThis.fetch

  return {
    async fetchTicket(input) {
      const url = new URL("/api/cloud-agent-next/sessions/stream-ticket", options.origin)
      const body = JSON.stringify({
        cloudAgentSessionId: input.cloudAgentSessionId,
        ...(input.organizationId === undefined ? {} : { organizationId: input.organizationId }),
      })

      let last: Error | undefined
      for (let attempt = 0; attempt < TICKET_RETRY_ATTEMPTS; attempt++) {
        if (attempt > 0) await delay(TICKET_RETRY_DELAY_MS)

        let response: Response
        try {
          response = await fetcher(url, {
            method: "POST",
            redirect: "error",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${options.apiKey}`,
            },
            body,
            signal: AbortSignal.timeout(STREAM_TICKET_TIMEOUT_MS),
          })
        } catch {
          throw new CloudError("Unable to reach Web App stream ticket endpoint")
        }

        const payload = await readBoundedJson(response, MAX_STREAM_TICKET_RESPONSE_BYTES).catch(() => {
          if (response.status === 403 || response.status === 404) return undefined
          throw new CloudError("Web App returned an invalid stream ticket response")
        })

        if (response.ok) {
          const parsed = StreamTicketResponseSchema.safeParse(payload)
          if (!parsed.success) throw new CloudError("Web App returned an invalid stream ticket response")
          return { ticket: parsed.data.ticket, expiresAt: parsed.data.expiresAt }
        }

        last = new CloudError(messageForStatus(response.status, payload))
        if (response.status !== 403 && response.status !== 404) throw last
      }

      throw last ?? new CloudError("Unable to obtain stream ticket")
    },
  }
}

function messageForStatus(status: number, payload: unknown): string {
  const server =
    typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : undefined

  if (status === 401) return server ?? "Web App rejected authentication"
  if (status === 403) return server ?? "Web App denied stream ticket access"
  if (status === 404) return server ?? "Web App session was not found"
  return server ?? `Web App rejected the stream ticket request with status ${status}`
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
