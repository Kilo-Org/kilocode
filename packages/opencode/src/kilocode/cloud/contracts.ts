import z from "zod"

export const MessageIdSchema = z.string().regex(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/)
export const CloudAgentSessionIdSchema = z
  .string()
  .regex(/^agent_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

const BranchSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-zA-Z0-9._\-/]+$/)
export const ModelSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-zA-Z0-9._\-/:]+$/)
export const ModeSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z][a-z0-9-]*$/)
const GithubRepoSchema = z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)
const GitUrlSchema = z
  .string()
  .url()
  .refine((url) => url.startsWith("https://"), "Only HTTPS URLs are supported")

export const RepositoryInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("github"), repo: GithubRepoSchema, branch: BranchSchema.optional() }).strict(),
  z.object({ type: z.literal("gitlab"), url: GitUrlSchema, branch: BranchSchema.optional() }).strict(),
  z
    .object({
      type: z.literal("git"),
      url: GitUrlSchema,
      token: z.string().optional(),
      branch: BranchSchema.optional(),
    })
    .strict(),
])

export const PromptSchema = z.string().min(1).max(100_000)
const StartMessageSchema = z.object({ prompt: PromptSchema, id: MessageIdSchema.optional() }).strict()
const SendMessageSchema = z.object({ prompt: PromptSchema, id: MessageIdSchema.nullish() }).strict()
const AgentSchema = z
  .object({
    mode: ModeSchema,
    model: ModelSchema,
    variant: z
      .string()
      .max(50)
      .regex(/^[a-zA-Z]+$/)
      .optional(),
  })
  .strict()

export const AgentStartRequestSchema = z
  .object({
    message: StartMessageSchema,
    agent: AgentSchema,
    repository: RepositoryInputSchema,
    options: z
      .object({
        createdOnPlatform: z.literal("kilo-cli"),
        kilocodeOrganizationId: z.string().uuid().optional(),
      })
      .strict(),
  })
  .strict()

export const AgentSendRequestSchema = z
  .object({ cloudAgentSessionId: CloudAgentSessionIdSchema, message: SendMessageSchema })
  .strict()

export const GetMessageResultInputSchema = z
  .object({ cloudAgentSessionId: CloudAgentSessionIdSchema, messageId: MessageIdSchema })
  .strict()

export const AgentStartResponseSchema = z
  .object({
    cloudAgentSessionId: CloudAgentSessionIdSchema,
    kiloSessionId: z.string(),
    messageId: MessageIdSchema,
    delivery: z.enum(["sent", "queued"]),
    streamUrl: z.string().min(1).optional(),
    wrapperRunId: z.string().optional(),
  })
  .strict()

export const AgentSendResponseSchema = z
  .object({
    cloudAgentSessionId: z.string(),
    status: z.literal("started"),
    streamUrl: z.string(),
    messageId: MessageIdSchema,
    delivery: z.enum(["sent", "queued"]),
    wrapperRunId: z.string().optional(),
  })
  .strict()

const FailureStageSchema = z.enum([
  "pre_dispatch",
  "post_dispatch_no_activity",
  "agent_activity",
  "interruption",
  "unknown",
])
const FailureCodeSchema = z.enum([
  "sandbox_connect_failed",
  "workspace_setup_failed",
  "kilo_server_failed",
  "wrapper_start_failed",
  "invalid_delivery_request",
  "session_metadata_missing",
  "model_missing",
  "delivery_failure_unknown",
  "wrapper_disconnected",
  "wrapper_no_output",
  "wrapper_ping_timeout",
  "wrapper_error_before_activity",
  "assistant_error",
  "wrapper_error_after_activity",
  "missing_assistant_reply",
  "payment_required",
  "user_interrupt",
  "container_shutdown",
  "system_interrupt",
  "unclassified",
])
const FailureSubtypeSchema = z.enum([
  "git_clone_timeout",
  "git_checkout_timeout",
  "git_authentication_failed",
  "git_network_failed",
  "git_pack_corrupt",
  "git_checkout_conflict",
  "git_branch_missing",
  "sandbox_storage_full",
  "kilo_import_timeout",
  "kilo_import_failed",
  "setup_command_timeout",
  "setup_command_failed",
  "workspace_setup_unknown",
])

export const SafeFailureSchema = z
  .object({
    stage: FailureStageSchema.optional(),
    code: FailureCodeSchema.optional(),
    subtype: FailureSubtypeSchema.optional(),
    attempts: z.number().int().nonnegative().optional(),
    message: z.string().min(1).max(4_096).optional(),
    retryable: z.boolean(),
  })
  .strict()
  .refine((failure) => failure.subtype === undefined || failure.code === "workspace_setup_failed", {
    message: "Workspace failure subtype requires workspace_setup_failed failure code",
    path: ["subtype"],
  })

export const GetMessageResultOutputSchema = z
  .object({
    cloudAgentSessionId: CloudAgentSessionIdSchema,
    messageId: MessageIdSchema,
    status: z.enum(["queued", "running", "completed", "failed", "interrupted"]),
    createdAt: z.number(),
    queuedAt: z.number().optional(),
    acceptedAt: z.number().optional(),
    terminalAt: z.number().optional(),
    completionSource: z
      .enum([
        "assistant_message_event",
        "manual_compact_summarize",
        "idle_reconciliation",
        "wrapper_failure",
        "interrupt",
        "delivery_failure",
      ])
      .optional(),
    failure: SafeFailureSchema.optional(),
    gateResult: z.enum(["pass", "fail"]).optional(),
    assistant: z.object({ messageId: z.string(), text: z.string().optional() }).strict().optional(),
  })
  .strict()
  .superRefine((result, ctx) => {
    const terminal = result.status === "completed" || result.status === "failed" || result.status === "interrupted"
    if (result.status === "queued" && result.acceptedAt !== undefined) {
      ctx.addIssue({ code: "custom", message: "Queued results cannot include acceptedAt", path: ["acceptedAt"] })
    }
    if (!terminal && result.terminalAt !== undefined) {
      ctx.addIssue({ code: "custom", message: "Active results cannot include terminalAt", path: ["terminalAt"] })
    }
    if (!terminal && result.completionSource !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Active results cannot include completionSource",
        path: ["completionSource"],
      })
    }
    if (result.status !== "failed" && result.status !== "interrupted" && result.failure !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Only failed or interrupted results can include failure details",
        path: ["failure"],
      })
    }
    if (result.status !== "completed" && result.gateResult !== undefined) {
      ctx.addIssue({ code: "custom", message: "Only completed results can include gateResult", path: ["gateResult"] })
    }
    if (result.status !== "completed" && result.assistant !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Only completed results can include an assistant response",
        path: ["assistant"],
      })
    }
  })

export type RepositoryInput = z.infer<typeof RepositoryInputSchema>
export type AgentStartRequest = z.infer<typeof AgentStartRequestSchema>
export type AgentSendRequest = z.infer<typeof AgentSendRequestSchema>
export type GetMessageResultInput = z.infer<typeof GetMessageResultInputSchema>
export type AgentStartResponse = z.infer<typeof AgentStartResponseSchema>
export type AgentSendResponse = z.infer<typeof AgentSendResponseSchema>
export type MessageResult = z.infer<typeof GetMessageResultOutputSchema>
export type AgentStatus = Omit<MessageResult, "assistant">
export type AgentResultExitCode = 0 | 2 | 3 | 4

export interface Decoder<T> {
  parse(value: unknown): T
}

export function projectStatus(result: MessageResult): AgentStatus {
  const { assistant: _, ...status } = result
  return status
}

export function resultExitCode(status: MessageResult["status"]): AgentResultExitCode {
  const codes = {
    completed: 0,
    queued: 2,
    running: 2,
    failed: 3,
    interrupted: 4,
  } as const
  return codes[status]
}
