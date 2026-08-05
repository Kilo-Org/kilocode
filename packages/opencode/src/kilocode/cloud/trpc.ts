import z from "zod"
import {
  AgentSendRequestSchema,
  AgentSendResponseSchema,
  AgentStartRequestSchema,
  AgentStartResponseSchema,
  GetMessageResultInputSchema,
  GetMessageResultOutputSchema,
  type AgentSendRequest,
  type AgentSendResponse,
  type AgentStartRequest,
  type AgentStartResponse,
  type Decoder,
  type GetMessageResultInput,
  type MessageResult,
} from "./contracts"
import { ambiguousAdmissionError, CloudError, ServiceRedirectError, ServiceTransportError } from "./errors"
import { createBearerHttpClient, type BearerHttpClient, type BearerHttpClientOptions, type BearerRequest } from "./http"
import { createMessageId } from "./message-id"
import { readBoundedJson } from "./response-json"

const TrpcSuccessEnvelopeSchema = z.object({ result: z.object({ data: z.unknown() }).strict() }).strict()

type Admission = "start" | "send"

export interface TrpcClient {
  query<T>(procedure: "getMessageResult", input: unknown, decoder: Decoder<T>): Promise<T>
  mutation<T>(procedure: Admission, input: unknown, decoder: Decoder<T>): Promise<T>
}

export interface AgentClient {
  start(input: AgentStartRequest): Promise<AgentStartResponse>
  send(input: AgentSendRequest): Promise<AgentSendResponse>
  getMessageResult(input: GetMessageResultInput): Promise<MessageResult>
}

export interface AgentClientOptions {
  readonly id?: () => string
}

export interface CloudAgentClientOptions extends BearerHttpClientOptions, AgentClientOptions {}

export function createTrpcClient(options: { readonly http: BearerHttpClient }): TrpcClient {
  return {
    query(procedure, input, decoder) {
      return request(
        options.http,
        {
          method: "GET",
          path: `/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`,
        },
        decoder,
      )
    },
    mutation(procedure, input, decoder) {
      return request(
        options.http,
        {
          method: "POST",
          path: `/trpc/${procedure}`,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
        decoder,
        procedure,
      )
    },
  }
}

export function createAgentClient(trpc: TrpcClient, options: AgentClientOptions = {}): AgentClient {
  const create = options.id ?? createMessageId
  return {
    async start(input) {
      const parsed = decode(AgentStartRequestSchema, input, "Cloud Agent start request is invalid")
      const id = parsed.message.id ?? create()
      const body = { ...parsed, message: { ...parsed.message, id } }
      const result = await trpc.mutation("start", body, AgentStartResponseSchema)
      if (result.messageId !== id) throw ambiguousAdmissionError("start")
      return result
    },
    async send(input) {
      const parsed = decode(AgentSendRequestSchema, input, "Cloud Agent send request is invalid")
      const id = parsed.message.id ?? create()
      const body = { ...parsed, message: { ...parsed.message, id } }
      const result = await trpc.mutation("send", body, AgentSendResponseSchema)
      if (result.cloudAgentSessionId !== parsed.cloudAgentSessionId || result.messageId !== id) {
        throw ambiguousAdmissionError("send")
      }
      return result
    },
    async getMessageResult(input) {
      const parsed = decode(GetMessageResultInputSchema, input, "Cloud Agent lookup request is invalid")
      const result = await trpc.query("getMessageResult", parsed, GetMessageResultOutputSchema)
      if (result.cloudAgentSessionId !== parsed.cloudAgentSessionId || result.messageId !== parsed.messageId) {
        throw new CloudError("Cloud Agent returned an invalid response")
      }
      return result
    },
  }
}

export function createCloudAgentClient(options: CloudAgentClientOptions) {
  const http = createBearerHttpClient(options)
  return createAgentClient(createTrpcClient({ http }), options)
}

function decode<T>(schema: z.ZodType<T>, input: unknown, message: string) {
  const result = schema.safeParse(input)
  if (!result.success) throw new CloudError(message)
  return result.data
}

async function request<T>(
  http: BearerHttpClient,
  req: BearerRequest,
  decoder: Decoder<T>,
  admission?: Admission,
): Promise<T> {
  const response = await http.request(req).catch((error: unknown) => {
    if (admission !== undefined && (error instanceof ServiceTransportError || error instanceof ServiceRedirectError)) {
      throw ambiguousAdmissionError(admission)
    }
    throw error
  })

  if (!response.ok) {
    await discard(response)
    if (admission !== undefined && response.status >= 500) throw ambiguousAdmissionError(admission)
    throw new CloudError(errorMessageForStatus(response.status))
  }

  const payload = await readBoundedJson(response).catch(() => {
    if (admission !== undefined) throw ambiguousAdmissionError(admission)
    throw new CloudError("Cloud Agent returned an invalid response")
  })

  try {
    const envelope = TrpcSuccessEnvelopeSchema.parse(payload)
    return decoder.parse(envelope.result.data)
  } catch {
    if (admission !== undefined) throw ambiguousAdmissionError(admission)
    throw new CloudError("Cloud Agent returned an invalid response")
  }
}

async function discard(response: Response) {
  await response.body?.cancel().catch(() => undefined)
}

function errorMessageForStatus(status: number) {
  if (status === 401) return "Cloud Agent rejected authentication"
  if (status === 402) return "Cloud Agent requires additional balance"
  if (status === 403) return "Cloud Agent denied the request"
  if (status === 404) return "Cloud Agent session or message was not found"
  if (status >= 500) return "Cloud Agent is temporarily unavailable"
  return `Cloud Agent rejected the request with status ${status}`
}
