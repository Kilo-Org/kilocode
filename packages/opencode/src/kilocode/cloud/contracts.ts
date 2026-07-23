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
const GithubRepoSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)
  .refine((value) => value.split("/").every((part) => part !== "." && part !== ".."))
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

export const AgentStartResponseSchema = z.object({
  cloudAgentSessionId: CloudAgentSessionIdSchema,
  kiloSessionId: z.string(),
  messageId: MessageIdSchema,
  delivery: z.string().min(1).max(50),
  streamUrl: z.string().min(1).optional(),
  wrapperRunId: z.string().optional(),
})

export const AgentSendResponseSchema = z.object({
  cloudAgentSessionId: CloudAgentSessionIdSchema,
  status: z.literal("started"),
  streamUrl: z.string().min(1),
  messageId: MessageIdSchema,
  delivery: z.string().min(1).max(50),
  wrapperRunId: z.string().optional(),
})

const FailureStageSchema = z.string().min(1).max(100)
const FailureCodeSchema = z.string().min(1).max(100)
const FailureSubtypeSchema = z.string().min(1).max(100)

export const SafeFailureSchema = z
  .object({
    stage: FailureStageSchema.optional(),
    code: FailureCodeSchema.optional(),
    subtype: FailureSubtypeSchema.optional(),
    attempts: z.number().int().nonnegative().optional(),
    message: z.string().min(1).max(4_096).optional(),
    retryable: z.boolean(),
  })
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
    completionSource: z.string().min(1).max(100).optional(),
    failure: SafeFailureSchema.optional(),
    gateResult: z.string().min(1).max(50).optional(),
    assistant: z.object({ messageId: z.string(), text: z.string().optional() }).optional(),
  })
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
