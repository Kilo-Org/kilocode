import { z } from "zod"

// The relay protocol is defined by the shipped v1 sender. Keep its envelopes
// permissive where v1 did: the adapter validates each command at its boundary.
export const RemoteSessionInfoSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    title: z.string(),
    parentSessionId: z.string().optional(),
  })
  .strict()

export const RemoteHeartbeatSchema = z
  .object({
    type: z.literal("heartbeat"),
    sessions: z.array(RemoteSessionInfoSchema),
  })
  .strict()

export const RemoteResponseSchema = z
  .object({
    type: z.literal("response"),
    id: z.string(),
    result: z.unknown().optional(),
    error: z.unknown().optional(),
  })
  .strict()

export const RemoteEventSchema = z
  .object({
    type: z.literal("event"),
    sessionId: z.string(),
    parentSessionId: z.string().optional(),
    event: z.string(),
    data: z.unknown(),
  })
  .strict()

export const RemoteOutboundSchema = z.discriminatedUnion("type", [
  RemoteHeartbeatSchema,
  RemoteResponseSchema,
  RemoteEventSchema,
])
export type RemoteOutbound = z.infer<typeof RemoteOutboundSchema>

export const RemoteInboundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("subscribe"), sessionId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("unsubscribe"), sessionId: z.string().min(1) }).strict(),
  z
    .object({
      type: z.literal("command"),
      id: z.string().min(1),
      command: z.string().min(1),
      sessionId: z.string().min(1).optional(),
      data: z.unknown(),
    })
    .strict(),
  z.object({ type: z.literal("system"), event: z.string(), data: z.unknown() }).strict(),
  z.object({ type: z.literal("heartbeat_ack") }).strict(),
])
export type RemoteInbound = z.infer<typeof RemoteInboundSchema>

export const RemoteTextMessageSchema = z
  .object({
    sessionID: z.string().min(1),
    messageID: z.string().startsWith("msg").optional(),
    parts: z.array(z.object({ type: z.literal("text"), text: z.string().min(1) }).strict()).length(1),
  })
  .strict()

export const RemoteCreateSessionSchema = z
  .object({
    protocolVersion: z.literal(1),
    agent: z.string().min(1).optional(),
    model: z
      .object({ providerID: z.string().min(1), modelID: z.string().min(1), variant: z.string().min(1).optional() })
      .strict()
      .optional(),
    orgId: z.string().uuid().optional(),
    directory: z.string().min(1).max(2_000).optional(),
    cloneFromKiloSessionId: z.string().min(1).optional(),
  })
  .strict()

export const RemoteCommandListSchema = z.object({ protocolVersion: z.literal(1) }).strict()

export const RemoteSendCommandSchema = z
  .object({
    protocolVersion: z.literal(1),
    command: z.string().min(1).max(2_000),
    arguments: z.string().max(32_768),
    messageID: z.string().startsWith("msg").optional(),
    model: z
      .object({ providerID: z.string().min(1), modelID: z.string().min(1) })
      .strict()
      .optional(),
    variant: z.string().max(2_000).optional(),
  })
  .strict()

export const RemoteRenameSchema = z.object({ sessionId: z.string().min(1), title: z.string().min(1) }).strict()
