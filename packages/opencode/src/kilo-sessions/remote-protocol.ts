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
    // kilocode_change - PR link: the pull request linked to the worktree this
    // session is advertised from. Optional so legacy CLIs (no field) remain
    // wire-compatible. `platform` here is the PR host (e.g. "github"), distinct
    // from the session's `platform` (client OS) above.
    prLink: z
      .object({
        platform: z.string().min(1).max(32),
        prUrl: z.string().max(2048),
        prNumber: z.number().int().positive(),
      })
      .optional(),
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
      // kilocode_change - sessionClone: present only when the CLI accepts a
      // cloud-session clone (create_session.cloneFromKiloSessionId). The old
      // wire form omits sessionClone; remove the mobile fail-closed check
      // when every shipped CLI advertises it.
      sessionClone: z.boolean().optional(),
      // Old heartbeats omit browserJobsV1: normalize to unsupported until all old clients retire.
      browserJobsV1: z.boolean().optional(),
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
    // Old acknowledgements omit capabilities: normalize to unsupported until all old relays retire.
    capabilities: z.object({ browserJobsV1: z.boolean().optional() }).optional(),
  })
  export type HeartbeatAck = z.infer<typeof HeartbeatAck>

  export const Inbound = z.discriminatedUnion("type", [Subscribe, Unsubscribe, Command, System, HeartbeatAck])
  export type Inbound = z.infer<typeof Inbound>

  /** Lightweight schema for diagnostic logging before full parse. */
  export const Preview = z.object({ type: z.string(), id: z.string().optional() })

  // --- Negotiated browser jobs v1 ---
  // Match services/session-ingest/src/types/user-connection-protocol.ts and
  // packages/cloud-agent-sdk/src/schemas.ts. Legacy parsers above stay narrow.

  export const BROWSER_GOAL_MAX_BYTES = 16 * 1024
  export const BROWSER_RESULT_MAX_BYTES = 64 * 1024
  export const BROWSER_FRAME_MAX_BYTES = 128 * 1024
  export const BROWSER_PAGE_SIZE = 25

  export const BrowserCapabilities = z.object({ browserJobsV1: z.boolean().optional() })
  export const NormalizedBrowserCapabilities = BrowserCapabilities.optional()
    // Old peers omit capabilities or browserJobsV1. Keep this fallback until all old peers retire.
    .transform((capabilities) => ({ browserJobsV1: capabilities?.browserJobsV1 ?? false }))
  export type BrowserCapabilities = z.infer<typeof NormalizedBrowserCapabilities>

  export const Ping = z.object({
    type: z.literal("ping"),
    nonce: z.string(),
    // Old web peers omit capabilities: normalize to unsupported until all old peers retire.
    capabilities: BrowserCapabilities.optional(),
  })
  export const Pong = z.object({
    type: z.literal("pong"),
    nonce: z.string(),
    // Old web peers omit capabilities: normalize to unsupported until all old peers retire.
    capabilities: BrowserCapabilities.optional(),
  })
  export const WebOutbound = z.discriminatedUnion("type", [
    Subscribe,
    Unsubscribe,
    Command.extend({
      data: z.unknown().optional(),
      connectionId: z.string().optional(),
      mutationId: z.string().max(128).optional(),
    }),
    Ping,
  ])
  export type WebOutbound = z.infer<typeof WebOutbound>
  export const WebInbound = z.discriminatedUnion("type", [Event, System, Response, Pong])
  export type WebInbound = z.infer<typeof WebInbound>

  function text(limit: number) {
    return z
      .string()
      .max(limit)
      .refine((value) => new TextEncoder().encode(value).byteLength <= limit, {
        message: "Text exceeds the UTF-8 byte limit",
      })
  }

  // Do not propagate Zod issues from proof-bearing inputs: even unknown key names
  // can contain secrets. Consumers must not enable Zod's reportInput option.
  function boundary<T extends z.ZodType>(schema: T) {
    return z.unknown().transform((input, context): z.output<T> => {
      const parsed = schema.safeParse(input)
      if (
        parsed.success &&
        new TextEncoder().encode(JSON.stringify(parsed.data)).byteLength < BROWSER_FRAME_MAX_BYTES
      ) {
        return parsed.data
      }
      context.addIssue({ code: "custom", message: "Invalid browser message" })
      return z.NEVER
    })
  }

  export const BrowserProviderId = z.templateLiteral(["bp_", z.uuid()])
  export const BrowserTaskId = z.templateLiteral(["bt_", z.uuid()])
  export const BrowserJobId = z.templateLiteral(["bj_", z.uuid()])
  export const BrowserInvocationId = z
    .string()
    .regex(/^b1\.[1-9][0-9]{0,15}\.[a-f0-9]{64}$/)
    .refine(
      (value) => {
        const created = Number(value.split(".").at(1))
        return Number.isSafeInteger(created) && created <= 8_640_000_000_000_000
      },
      { message: "Invalid invocation timestamp" },
    )
  const correlation = z.uuid()
  const timestamp = z.iso.datetime({ precision: 3 })
  const fingerprint = z.string().regex(/^[a-f0-9]{64}$/)
  const proof = z.string().regex(/^[a-f0-9]{64}$/)
  const goal = text(BROWSER_GOAL_MAX_BYTES).min(1)
  const generation = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
  const tab = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
  const owner = z.strictObject({
    parentSessionId: text(128).regex(/^ses_[A-Za-z0-9_-]+$/),
    parentProof: proof,
  })

  export const BrowserJobStatus = z.enum([
    "queued",
    "awaiting_approval",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "interrupted",
    "timed_out",
  ])
  export const BrowserTerminalStatus = BrowserJobStatus.exclude(["queued", "awaiting_approval", "running"])
  export const BrowserFailureReason = z.enum([
    "approval_denied",
    "permission_denied",
    "invocation_expired",
    "invocation_conflict",
    "conversation_busy",
    "capacity_exceeded",
    "tab_lost",
    "provider_lost",
    "provider_unavailable",
    "queue_timeout",
    "approval_timeout",
    "execution_timeout",
    "lease_expired",
    "effects_uncertain",
    "cancelled",
    "runner_failed",
    "unsupported",
    "invalid_request",
    "owner_mismatch",
    "not_found",
  ])
  export const BrowserReasonCode = z.enum(["completed", ...BrowserFailureReason.options])

  const handle = {
    providerId: BrowserProviderId,
    browserTaskId: BrowserTaskId,
    jobId: BrowserJobId,
    invocationId: BrowserInvocationId,
  }
  export const BrowserJobHandle = z.strictObject(handle)
  export type BrowserJobHandle = z.infer<typeof BrowserJobHandle>
  const binding = { providerId: BrowserProviderId, generation }
  const bound = { ...handle, generation }

  export const BrowserApprovedTab = z.strictObject({
    tabId: tab,
    title: text(1024),
    url: text(8192).url(),
    effectiveMode: z.enum(["safe", "dangerous"]),
  })
  export const BrowserDeadlines = z.strictObject({
    queue: timestamp,
    approval: timestamp.optional(),
    execution: timestamp.optional(),
    lease: timestamp.optional(),
  })
  const metadata = {
    ...bound,
    payloadFingerprint: fingerprint,
    createdAt: timestamp,
    expiresAt: timestamp,
    deadlines: BrowserDeadlines,
  }
  const evidence = z
    .strictObject({
      text: text(8192).min(1).optional(),
      title: text(1024).min(1).optional(),
      url: text(8192).url().optional(),
    })
    .refine((evidence) => Object.keys(evidence).length > 0, {
      message: "Evidence must contain an observation",
    })
  const outcome = {
    ...handle,
    summary: text(32 * 1024).min(1),
    evidence: z.array(evidence).max(32),
  }
  export const BrowserResult = z
    .discriminatedUnion("status", [
      z.strictObject({
        ...outcome,
        status: z.literal("succeeded"),
        reason: z.literal("completed"),
        effectsUncertain: z.literal(false),
      }),
      z.strictObject({
        ...outcome,
        status: BrowserTerminalStatus.exclude(["succeeded"]),
        reason: BrowserFailureReason,
        effectsUncertain: z.boolean(),
      }),
    ])
    .refine((result) => new TextEncoder().encode(JSON.stringify(result)).byteLength <= BROWSER_RESULT_MAX_BYTES, {
      message: "Result exceeds the serialized UTF-8 byte limit",
    })
  export type BrowserResult = z.infer<typeof BrowserResult>

  function same(left: BrowserJobHandle, right: BrowserJobHandle) {
    return (
      left.providerId === right.providerId &&
      left.browserTaskId === right.browserTaskId &&
      left.jobId === right.jobId &&
      left.invocationId === right.invocationId
    )
  }

  export const BrowserJobSnapshot = z
    .strictObject({
      ...metadata,
      status: BrowserJobStatus,
      approvedTab: BrowserApprovedTab.optional(),
      result: BrowserResult.optional(),
    })
    .superRefine((job, context) => {
      const terminal = BrowserTerminalStatus.safeParse(job.status).success
      if (
        terminal !== (job.result !== undefined) ||
        (job.result && (job.status !== job.result.status || !same(job, job.result)))
      ) {
        context.addIssue({ code: "custom", message: "Result must match the terminal job" })
      }
      if (
        (job.status === "running" && !job.approvedTab) ||
        ((job.status === "queued" || job.status === "awaiting_approval") && job.approvedTab)
      ) {
        context.addIssue({ code: "custom", message: "Tab approval must match the job phase" })
      }
      const created = Date.parse(job.createdAt)
      const expires = Date.parse(job.expiresAt)
      if (
        created > expires ||
        Object.values(job.deadlines).some(
          (deadline) => deadline !== undefined && (Date.parse(deadline) < created || Date.parse(deadline) > expires),
        )
      ) {
        context.addIssue({ code: "custom", message: "Deadlines must stay within job retention" })
      }
    })
  export type BrowserJobSnapshot = z.infer<typeof BrowserJobSnapshot>

  // Model arguments never select parent, invocation, proof, user, or socket authority.
  export const BrowserTaskArguments = boundary(
    z.discriminatedUnion("operation", [
      z.strictObject({ operation: z.literal("list") }),
      z.strictObject({
        operation: z.literal("run"),
        provider_id: BrowserProviderId,
        goal,
        browser_task_id: BrowserTaskId.optional(),
      }),
      z.strictObject({
        operation: z.literal("status"),
        browser_task_id: BrowserTaskId,
        job_id: BrowserJobId.optional(),
      }),
      z.strictObject({
        operation: z.literal("cancel"),
        browser_task_id: BrowserTaskId,
        job_id: BrowserJobId.optional(),
      }),
      z.strictObject({ operation: z.literal("recover") }),
    ]),
  )
  export type BrowserTaskArguments = z.infer<typeof BrowserTaskArguments>

  const request = { type: z.literal("browser_request"), requestId: correlation }
  // An absent jobId selects only this conversation's latest job, after owner verification.
  const lookup = { owner, browserTaskId: BrowserTaskId, jobId: BrowserJobId.optional() }
  // Only authenticated, negotiated CLI sockets can submit these requests. Recover
  // looks up a persisted invocation; it cannot carry a new goal or choose a provider.
  export const BrowserRequest = boundary(
    z.discriminatedUnion("operation", [
      z.strictObject({ ...request, operation: z.literal("list"), cursor: BrowserProviderId.optional() }),
      z.strictObject({
        ...request,
        operation: z.literal("invoke"),
        owner,
        providerId: BrowserProviderId,
        browserTaskId: BrowserTaskId.optional(),
        invocationId: BrowserInvocationId,
        goal,
      }),
      z.strictObject({ ...request, operation: z.literal("status"), ...lookup }),
      z.strictObject({ ...request, operation: z.literal("cancel"), ...lookup }),
      z.strictObject({ ...request, operation: z.literal("recover"), owner, invocationId: BrowserInvocationId }),
    ]),
  )
  export type BrowserRequest = z.infer<typeof BrowserRequest>

  export const BrowserProviderDescriptor = z.strictObject({
    providerId: BrowserProviderId,
    label: text(128).min(1),
    availability: z.enum(["available", "busy", "unavailable"]),
    queueDepth: z.number().int().min(0).max(100),
  })
  export const BrowserResponse = boundary(
    z.strictObject({
      type: z.literal("browser_response"),
      requestId: correlation,
      response: z.discriminatedUnion("kind", [
        z.strictObject({
          kind: z.literal("providers"),
          providers: z.array(BrowserProviderDescriptor).max(BROWSER_PAGE_SIZE),
          nextCursor: BrowserProviderId.optional(),
        }),
        // An acknowledgement is not progress or a terminal result, including cancel.
        z.strictObject({ kind: z.literal("ack"), operation: z.enum(["invoke", "cancel"]), ...handle }),
        z.strictObject({ kind: z.literal("status"), job: BrowserJobSnapshot }),
        z.strictObject({ kind: z.literal("recovered"), job: BrowserJobSnapshot }),
        z.strictObject({ kind: z.literal("not_found"), invocationId: BrowserInvocationId }),
        z.strictObject({
          kind: z.literal("error"),
          code: BrowserFailureReason,
          message: text(1024).min(1),
          retryable: z.boolean(),
        }),
      ]),
    }),
  )
  export type BrowserResponse = z.infer<typeof BrowserResponse>
  export const BrowserEvent = boundary(
    z.discriminatedUnion("event", [
      z.strictObject({
        type: z.literal("browser_event"),
        requestId: correlation,
        event: z.literal("progress"),
        job: BrowserJobSnapshot.refine((job) => !BrowserTerminalStatus.safeParse(job.status).success, {
          message: "Progress cannot contain a terminal result",
        }),
      }),
      z.strictObject({
        type: z.literal("browser_event"),
        requestId: correlation,
        event: z.literal("result"),
        result: BrowserResult,
      }),
    ]),
  )
  export type BrowserEvent = z.infer<typeof BrowserEvent>
  export const BrowserCLIInbound = z.union([BrowserResponse, BrowserEvent])

  // The registration proof stays on the authenticated provider-to-relay boundary.
  // Generation zero means first registration; other values name the last grant.
  // The relay allocates the next generation and binds it to the actual socket.
  export const BrowserProviderOutbound = boundary(
    z
      .discriminatedUnion("type", [
        z.strictObject({
          type: z.literal("provider_register"),
          requestId: correlation,
          providerId: BrowserProviderId,
          generation: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
          providerProof: proof,
          label: text(128).min(1),
          enabled: z.literal(true),
          recovery: z
            .strictObject({
              invocationId: BrowserInvocationId,
              tabId: tab,
              tabClosed: z.literal(true),
              locksDrained: z.literal(true),
            })
            .optional(),
        }),
        // Read-only history requires proof, not registration or a generation grant.
        z.strictObject({
          type: z.literal("provider_status"),
          requestId: correlation,
          providerId: BrowserProviderId,
          providerProof: proof,
          cursor: BrowserJobId.optional(),
        }),
        z.strictObject({
          type: z.literal("provider_heartbeat"),
          requestId: correlation,
          ...binding,
          cursor: BrowserJobId.optional(),
        }),
        z.strictObject({
          type: z.literal("provider_approval"),
          ...bound,
          approval: z.discriminatedUnion("decision", [
            z.strictObject({ decision: z.literal("approved"), tab: BrowserApprovedTab }),
            z.strictObject({ decision: z.literal("denied"), reason: z.literal("approval_denied") }),
          ]),
        }),
        z.strictObject({
          type: z.literal("provider_result"),
          ...bound,
          tab: BrowserApprovedTab,
          result: BrowserResult,
        }),
        z.strictObject({ type: z.literal("provider_quiesced"), ...bound, tabId: tab }),
        z.strictObject({
          type: z.literal("provider_unavailable"),
          ...binding,
          reason: BrowserFailureReason,
          effectsUncertain: z.boolean(),
        }),
        // Provider Stop targets this profile's exact job, not a client-selected parent.
        z.strictObject({ type: z.literal("provider_cancel"), ...bound }),
      ])
      .refine((message) => message.type !== "provider_result" || same(message, message.result), {
        message: "Provider result must match the job",
      }),
  )
  export type BrowserProviderOutbound = z.infer<typeof BrowserProviderOutbound>

  // Provider frames never target ordinary web subscribers. Execution frames require
  // a registered socket; status results require a proof-authorized request.
  // A snapshot is reconciliation data, not permission to execute.
  export const BrowserProviderInbound = boundary(
    z
      .discriminatedUnion("type", [
        z.strictObject({
          type: z.literal("provider_job"),
          job: BrowserJobSnapshot.refine((job) => job.status === "awaiting_approval", {
            message: "Dispatch requires tab approval",
          }),
          goal,
          ownerLabel: text(128).min(1),
        }),
        z.strictObject({ type: z.literal("provider_job_cancel"), ...bound, reason: BrowserFailureReason }),
        z.strictObject({
          type: z.literal("provider_snapshot"),
          ...binding,
          requestId: correlation.optional(),
          jobs: z.array(BrowserJobSnapshot).max(BROWSER_PAGE_SIZE),
          nextCursor: BrowserJobId.optional(),
        }),
        // History grants no execution, lease, approval, or recovery authority.
        z
          .strictObject({
            type: z.literal("provider_status_result"),
            requestId: correlation,
            providerId: BrowserProviderId,
            jobs: z.array(BrowserJobSnapshot).max(BROWSER_PAGE_SIZE),
            nextCursor: BrowserJobId.optional(),
          })
          .refine((message) => message.jobs.every((job) => job.providerId === message.providerId), {
            message: "History must match the requested provider",
          }),
        z.strictObject({
          type: z.literal("provider_lease_ack"),
          ...binding,
          requestId: correlation,
          leaseExpiresAt: timestamp,
        }),
      ])
      .refine(
        (message) =>
          message.type !== "provider_snapshot" ||
          message.jobs.every((job) => job.providerId === message.providerId && job.generation === message.generation),
        { message: "Snapshot must match the registered provider" },
      ),
  )
  export type BrowserProviderInbound = z.infer<typeof BrowserProviderInbound>

  // Opt-in consumers adopt these separately; the legacy parser exports never widen.
  export const OutboundWithBrowser = z.union([Outbound, BrowserRequest])
  export type OutboundWithBrowser = z.infer<typeof OutboundWithBrowser>
  export const InboundWithBrowser = z.union([Inbound, BrowserCLIInbound])
  export type InboundWithBrowser = z.infer<typeof InboundWithBrowser>
  export const WebOutboundWithBrowser = z.union([WebOutbound, BrowserProviderOutbound])
  export type WebOutboundWithBrowser = z.infer<typeof WebOutboundWithBrowser>
  export const WebInboundWithBrowser = z.union([WebInbound, BrowserProviderInbound])
  export type WebInboundWithBrowser = z.infer<typeof WebInboundWithBrowser>
}
