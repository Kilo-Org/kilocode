import z from "zod"

export namespace RemoteProtocol {
  // --- Shared ---

  export const SessionInfo = z.object({
    id: z.string(),
    status: z.string(),
    title: z.string(),
    parentSessionId: z.string().optional(),
    gitUrl: z.string().optional(),
    gitBranch: z.string().optional(),
  })
  export type SessionInfo = z.infer<typeof SessionInfo>

  // --- CLI → DO (Outbound) ---

  // Local runtime presence. Defined here so the CLI and the relay share one
  // shape. `runtimeId` is a per-process UUID; `connectionId` is opaque relay
  // routing metadata. The relay rejects heartbeats whose `connectionId` does
  // not match the authenticated socket.
  export const RuntimeCapability = z.enum(["catalog.v1", "create-and-run.v1"])
  export type RuntimeCapability = z.infer<typeof RuntimeCapability>

  export const RuntimePresence = z
    .object({
      runtimeId: z.string().uuid(),
      connectionId: z.string().min(1).max(128),
      protocolVersion: z.literal(1),
      cliVersion: z.string().min(1).max(32),
      displayName: z.string().min(1).max(80),
      projectName: z.string().min(1).max(80),
      capabilities: z
        .array(RuntimeCapability)
        .max(2)
        .refine(values => new Set(values).size === values.length, {
          message: "runtime capabilities must be unique",
        }),
    })
    .strict()
  export type RuntimePresence = z.infer<typeof RuntimePresence>

  export const Heartbeat = z.object({
    type: z.literal("heartbeat"),
    sessions: z.array(SessionInfo),
    protocolVersion: z.string().optional(), // lets relay detect CLI capabilities without probing commands
    // Optional sequence number used for acknowledged heartbeats. Legacy CLIs
    // omit it; the relay treats an unsequenced heartbeat as fire-and-forget.
    sequence: z.number().int().nonnegative().optional(),
    // Optional runtime presence. Legacy CLIs omit it and remain compatible.
    runtime: RuntimePresence.optional(),
  })
  export type Heartbeat = z.infer<typeof Heartbeat>

  export const Event = z.object({
    type: z.literal("event"),
    sessionId: z.string(),
    parentSessionId: z.string().optional(),
    event: z.string(),
    data: z.unknown(),
  })
  export type Event = z.infer<typeof Event>

  export const Response = z.object({
    type: z.literal("response"),
    id: z.string(),
    result: z.unknown().optional(),
    error: z.unknown().optional(),
  })
  export type Response = z.infer<typeof Response>

  export const Outbound = z.discriminatedUnion("type", [Heartbeat, Event, Response])
  export type Outbound = z.infer<typeof Outbound>

  // --- DO → CLI (Inbound) ---

  export const Subscribe = z.object({
    type: z.literal("subscribe"),
    sessionId: z.string(),
  })
  export type Subscribe = z.infer<typeof Subscribe>

  export const Unsubscribe = z.object({
    type: z.literal("unsubscribe"),
    sessionId: z.string(),
  })
  export type Unsubscribe = z.infer<typeof Unsubscribe>

  export const Command = z.object({
    type: z.literal("command"),
    id: z.string(),
    command: z.string(),
    sessionId: z.string().optional(),
    data: z.unknown(),
  })
  export type Command = z.infer<typeof Command>

  export const System = z.object({
    type: z.literal("system"),
    event: z.string(),
    data: z.unknown(),
  })
  export type System = z.infer<typeof System>

  export const HeartbeatAck = z.object({
    type: z.literal("heartbeat_ack"),
    // Optional echo of the heartbeat's `sequence`. Present only on
    // acknowledged heartbeats; a missing sequence here means the legacy
    // fire-and-forget path resolved the sender.
    sequence: z.number().int().nonnegative().optional(),
  })
  export type HeartbeatAck = z.infer<typeof HeartbeatAck>

  export const Inbound = z.discriminatedUnion("type", [Subscribe, Unsubscribe, Command, System, HeartbeatAck])
  export type Inbound = z.infer<typeof Inbound>

  /** Lightweight schema for diagnostic logging before full parse. */
  export const Preview = z.object({ type: z.string(), id: z.string().optional() })
}
