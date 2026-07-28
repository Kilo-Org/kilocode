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
    // kilocode_change - K1 W1: per-session platform advertises the platform the
    // session was created on. Mirrors meta()'s resolution order:
    //   KiloSession.resolvePlatform(id) || process.env["KILO_PLATFORM"] || "cli"
    // Optional so legacy CLIs (no field) remain wire-compatible.
    platform: z.string().max(32).optional(),
  })
  export type SessionInfo = z.infer<typeof SessionInfo>

  // kilocode_change - K1 W1: instance advertisement. Presence on a heartbeat
  // means "this connection is a spawn-capable instance" and turns this CLI into
  // a row on the cloud-side instance picker. Legacy CLIs (no `instance`) are
  // wire-compatible and never regress.
  export const InstanceAdvertisement = z.object({
    name: z.string().min(1).max(64), // os.hostname(), truncated
    projectName: z.string().min(1).max(64), // basename(Instance.directory), truncated
    version: z.string().max(32).optional(), // InstallationVersion, truncated
  })
  export type InstanceAdvertisement = z.infer<typeof InstanceAdvertisement>

  // --- CLI → DO (Outbound) ---

  // Capability flags advertised in the heartbeat so the relay can stop
  // probing commands to discover what the CLI supports. Field name and
  // nesting are an exact contract with the mobile ingest service.
  export const Capabilities = z
    .object({
      attachments: z.boolean().optional(),
    })
    .optional()
  export const Heartbeat = z.object({
    type: z.literal("heartbeat"),
    sessions: z.array(SessionInfo),
    protocolVersion: z.string().optional(), // lets relay detect CLI capabilities without probing commands
    instance: InstanceAdvertisement.optional(), // kilocode_change - K1 W1
    capabilities: Capabilities,
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
  })
  export type HeartbeatAck = z.infer<typeof HeartbeatAck>

  export const Inbound = z.discriminatedUnion("type", [Subscribe, Unsubscribe, Command, System, HeartbeatAck])
  export type Inbound = z.infer<typeof Inbound>

  /** Lightweight schema for diagnostic logging before full parse. */
  export const Preview = z.object({ type: z.string(), id: z.string().optional() })
}
