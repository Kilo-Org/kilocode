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

// v1 heartbeat capabilities (ecccd1f remote-ws.ts stamps every heartbeat).
// The deployed relay broadcasts them per session row and the consumer gates
// its remote attachment path on attachments:true (cloud origin/main
// cloud-agent-sdk activeSessionSchema + mobile fail-closed gate). protocolVersion
// is omitted: no consumer reads it (protocol detection uses the list_models
// probe), so there is no host consumer to source a version fact from.
// sessionClone is deliberately never advertised: v1's contract is that the
// flag is present only when the CLI accepts a cloud-session clone, and this
// adapter refuses clone — its absence keeps the consumer's clone gate
// fail-closed.
export const RemoteHeartbeatSchema = z
  .object({
    type: z.literal("heartbeat"),
    sessions: z.array(RemoteSessionInfoSchema),
    capabilities: z.object({ attachments: z.boolean() }).strict(),
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

// V1 FilePartInput is {type: "file", mime, filename?, url}; v1 materializes
// https:// parts by fetching them. This adapter only admits inline data: URLs
// (source: ecccd1f remote-attachments.ts) — every other URL variant is
// rejected before any prompt is attempted.
export const RemoteMessagePartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().min(1) }).strict(),
  z
    .object({
      type: z.literal("file"),
      mime: z.string().min(1).max(255),
      url: z.string().min(1),
      filename: z.string().min(1).max(2_000).optional(),
    })
    .strict(),
])

export const RemoteMultipartMessageSchema = z
  .object({
    sessionID: z.string().min(1),
    messageID: z.string().startsWith("msg").optional(),
    parts: z.array(RemoteMessagePartSchema).min(1),
  })
  .strict()
export type RemoteMessagePart = z.infer<typeof RemoteMessagePartSchema>

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

// Same shape as v1 RemoteModelCatalog.Request (ecccd1f remote-model-catalog.ts).
export const RemoteModelListSchema = z.object({ protocolVersion: z.literal(1) }).strict()

export const RemoteDirectoryListSchema = z
  .object({ protocolVersion: z.literal(1), path: z.string().min(1).max(2_000).optional() })
  .strict()

export const RemoteDropQueuedMessageSchema = z.object({ messageID: z.string().startsWith("msg").max(2_000) }).strict()

// v1 exit_cli data (ecccd1f remote-sender.ts RemoteCommand.ExitRequest). The
// wire literal is the compatibility name for session-detach; the deployed
// relay (cloud origin/main UserConnectionDO) forwards only when the data is
// exactly { protocolVersion: 1 } alongside a sessionId.
export const RemoteExitSchema = z.object({ protocolVersion: z.literal(1) }).strict()

// v1 suggestion commands (ecccd1f remote-sender.ts:50-53): accept data is
// { requestID, index } (zero-based action index) and dismiss data is
// { requestID }, both routed by the deployed relay to the owning CLI.
export const RemoteSuggestionAcceptSchema = z
  .object({ requestID: z.string().min(1).max(2_000), index: z.number().int().nonnegative() })
  .strict()
export const RemoteSuggestionDismissSchema = z.object({ requestID: z.string().min(1).max(2_000) }).strict()

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

// v1 permission_respond data (ecccd1f remote-sender.ts PermissionData). v1
// parsed this shape non-strictly. `interactive` is the explicit human-reply
// bit: the adapter refuses sensitive approvals without it and never infers it
// from transport authentication.
export const RemotePermissionRespondSchema = z.object({
  requestID: z.string().min(1),
  reply: z.enum(["once", "always", "reject"]),
  message: z.string().optional(),
  interactive: z.boolean().optional(),
})
export type RemotePermissionRespond = z.infer<typeof RemotePermissionRespondSchema>

// v1 question_reply data (ecccd1f remote-sender.ts QuestionData): one array of
// selected labels per question, in question order.
export const RemoteQuestionReplySchema = z.object({
  requestID: z.string().min(1),
  answers: z.array(z.array(z.string())),
})
export type RemoteQuestionReply = z.infer<typeof RemoteQuestionReplySchema>

// v1 question_reject data (ecccd1f remote-sender.ts).
export const RemoteQuestionRejectSchema = z.object({ requestID: z.string().min(1) })
export type RemoteQuestionReject = z.infer<typeof RemoteQuestionRejectSchema>
