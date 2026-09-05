export * as KiloRouted from "./routed.js"

import { Effect } from "effect"
import { Protocol, type ProtocolBody } from "../route/protocol.js"
import { LLMEvent, type LLMRequest, type ProtocolID, type ProviderMetadata } from "../schema/index.js"
import { isRecord } from "../utils/record.js"
import { OpenAIChat } from "../protocols/openai-chat.js"

/** Shared provider-metadata namespace for every Kilo routed native route. */
export const providerMetadataKey = "kilo"

interface ParserState {
  readonly parser: OpenAIChat.ParserState
  readonly routedModelID?: string
}

const modelIDPattern = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/

// Core merges key-credential metadata into the resolved body overlay before calling model(). The
// Kilo account payload (profile fields plus server/organizationID written by kilo-gateway auth) and
// credential secrets must never serialize into the compiled request body, while explicit config
// body overlays survive. Keep in sync with the same closed set in packages/kilo-gateway/src/plugin.ts
// — the package boundary prevents sharing it.
// Collision: a deliberately configured top-level `name` or `user` request-body field would also be
// removed. Neither is a supported Kilo Gateway dialect field (the OpenRouter wrapper no longer
// forwards source `user`, and account identification is the credential itself), so the reserved set
// wins over the undocumented configured-field case.
export const accountBodyKeys = new Set([
  "access",
  "apiKey",
  "authToken",
  "email",
  "hasPersonalAccount",
  "key",
  "name",
  "organizationID",
  "organizationName",
  "organizations",
  "refresh",
  "selectedOrganizationId",
  "server",
  "token",
  "user",
])

/** Drop the closed Kilo account key set from a resolved `http.body` overlay. */
export function isolateBody(body: Readonly<Record<string, unknown>> | undefined) {
  if (body === undefined) return {}
  return Object.fromEntries(Object.entries(body).filter(([name]) => !accountBodyKeys.has(name)))
}

/** Read only a bounded, printable gateway model identifier from a decoded stream event. */
function responseModelID(input: unknown) {
  if (!isRecord(input)) return
  if (typeof input.model !== "string" || input.model.length > 256 || !modelIDPattern.test(input.model)) return
  return input.model
}

/**
 * Wrap a chat body contract in the shared Kilo routed stream parser: the OpenAI
 * Chat state machine plus capture of the gateway's response-selected model,
 * which `onHalt` adds to terminal step/finish metadata under `providerMetadataKey`.
 */
export const protocol = <Body>(input: { readonly id: ProtocolID; readonly body: ProtocolBody<Body> }) => {
  const stream = OpenAIChat.protocol.stream
  return Protocol.make({
    id: input.id,
    body: input.body,
    stream: {
      event: stream.event,
      initial: (request: LLMRequest): ParserState => ({ parser: stream.initial(request) }),
      step: (state: ParserState, event: Parameters<typeof stream.step>[1]) =>
        stream.step(state.parser, event).pipe(
          Effect.map(([parser, events]) => {
            const routedModelID = responseModelID(event) ?? state.routedModelID
            return [{ parser, ...(routedModelID === undefined ? {} : { routedModelID }) }, events] as const
          }),
        ),
      terminal: stream.terminal,
      onHalt: (state: ParserState) => {
        const onHalt = stream.onHalt
        if (onHalt === undefined) return Effect.succeed([])
        return onHalt(state.parser).pipe(Effect.map((events) => decorateTerminalEvents(events, state.routedModelID)))
      },
    },
  })
}

function decorateTerminalEvents(
  events: ReadonlyArray<LLMEvent>,
  routedModelID: string | undefined,
): ReadonlyArray<LLMEvent> {
  if (routedModelID === undefined) return events
  return events.map((event) => {
    if (!LLMEvent.is.stepFinish(event) && !LLMEvent.is.finish(event)) return event
    const existing =
      event.providerMetadata?.[providerMetadataKey] ?? event.usage?.providerMetadata?.[providerMetadataKey]
    return {
      ...event,
      providerMetadata: {
        ...event.providerMetadata,
        [providerMetadataKey]: {
          ...(isRecord(existing) ? existing : {}),
          routedModelID,
        },
      } satisfies ProviderMetadata,
    }
  })
}
