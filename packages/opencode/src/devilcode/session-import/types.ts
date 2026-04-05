import z from "zod"

export namespace SessionImportType {
  export const UserMessageData = z.object({
    role: z.literal("user"),
    time: z.object({
      created: z.number(),
    }),
    agent: z.string(),
    model: z.object({
      providerID: z.string(),
      modelID: z.string(),
    }),
    tools: z.record(z.string(), z.boolean()).optional(),
  })

  export const AssistantMessageData = z.object({
    role: z.literal("assistant"),
    time: z.object({
      created: z.number(),
      completed: z.number().optional(),
    }),
    parentID: z.string(),
    modelID: z.string(),
    providerID: z.string(),
    mode: z.string(),
    agent: z.string(),
    path: z.object({
      cwd: z.string(),
      root: z.string(),
    }),
    summary: z.boolean().optional(),
    cost: z.number(),
    tokens: z.object({
      total: z.number().optional(),
      input: z.number(),
      output: z.number(),
      reasoning: z.number(),
      cache: z.object({
        read: z.number(),
        write: z.number(),
      }),
    }),
    structured: z.unknown().optional(),
    variant: z.string().optional(),
    finish: z.string().optional(),
  })

  export const MessageData = z.discriminatedUnion("role", [UserMessageData, AssistantMessageData])

  export const TextPartData = z.object({
    type: z.literal("text"),
    text: z.string(),
    synthetic: z.boolean().optional(),
    ignored: z.boolean().optional(),
    time: z
      .object({
        start: z.number(),
        end: z.number().optional(),
      })
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })

  export const ReasoningPartData = z.object({
    type: z.literal("reasoning"),
    text: z.string(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    time: z.object({
      start: z.number(),
      end: z.number().optional(),
    }),
  })

  export const ToolStatePending = z.object({
    status: z.literal("pending"),
    input: z.record(z.string(), z.unknown()),
    raw: z.string(),
  })

  export const ToolStateRunning = z.object({
    status: z.literal("running"),
    input: z.record(z.string(), z.unknown()),
    title: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    time: z.object({
      start: z.number(),
    }),
  })

  export const ToolStateCompleted = z.object({
    status: z.literal("completed"),
    input: z.record(z.string(), z.unknown()),
    output: z.string(),
    title: z.string(),
    metadata: z.record(z.string(), z.unknown()),
    time: z.object({
      start: z.number(),
      end: z.number(),
      compacted: z.number().optional(),
    }),
  })

  export const ToolStateError = z.object({
    status: z.literal("error"),
    input: z.record(z.string(), z.unknown()),
    error: z.string(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    time: z.object({
      start: z.number(),
      end: z.number(),
    }),
  })

  export const ToolState = z.discriminatedUnion("status", [ToolStatePending, ToolStateRunning, ToolStateCompleted, ToolStateError])

  export const ToolPartData = z.object({
    type: z.literal("tool"),
    callID: z.string(),
    tool: z.string(),
    state: ToolState,
    metadata: z.record(z.string(), z.unknown()).optional(),
  })

  export const PartData = z.discriminatedUnion("type", [TextPartData, ReasoningPartData, ToolPartData])

  export const Result = z.object({
    ok: z.boolean(),
    id: z.string(),
    skipped: z.boolean().optional(),
  })

  export const Project = z.object({
    id: z.string(),
    worktree: z.string(),
    vcs: z.string().optional(),
    name: z.string().optional(),
    iconUrl: z.string().optional(),
    iconColor: z.string().optional(),
    timeCreated: z.number(),
    timeUpdated: z.number(),
    timeInitialized: z.number().optional(),
    sandboxes: z.array(z.string()),
    commands: z
      .object({
        start: z.string().optional(),
      })
      .optional(),
  })

  export const Session = z.object({
    id: z.string(),
    projectID: z.string(),
    workspaceID: z.string().optional(),
    parentID: z.string().optional(),
    slug: z.string(),
    directory: z.string(),
    title: z.string(),
    version: z.string(),
    shareURL: z.string().optional(),
    summary: z
      .object({
        additions: z.number(),
        deletions: z.number(),
        files: z.number(),
        diffs: z.array(z.record(z.string(), z.unknown())).optional(),
      })
      .optional(),
    revert: z
      .object({
        messageID: z.string(),
        partID: z.string().optional(),
        snapshot: z.string().optional(),
        diff: z.string().optional(),
      })
      .optional(),
    permission: z.record(z.string(), z.unknown()).optional(),
    timeCreated: z.number(),
    timeUpdated: z.number(),
    timeCompacting: z.number().optional(),
    timeArchived: z.number().optional(),
  })

  export const Message = z.object({
    id: z.string(),
    sessionID: z.string(),
    timeCreated: z.number(),
    data: MessageData,
  })

  export const Part = z.object({
    id: z.string(),
    messageID: z.string(),
    sessionID: z.string(),
    timeCreated: z.number().optional(),
    data: PartData,
  })

  export type Result = z.infer<typeof Result>
  export type UserMessageData = z.infer<typeof UserMessageData>
  export type AssistantMessageData = z.infer<typeof AssistantMessageData>
  export type MessageData = z.infer<typeof MessageData>
  export type TextPartData = z.infer<typeof TextPartData>
  export type ReasoningPartData = z.infer<typeof ReasoningPartData>
  export type ToolStatePending = z.infer<typeof ToolStatePending>
  export type ToolStateRunning = z.infer<typeof ToolStateRunning>
  export type ToolStateCompleted = z.infer<typeof ToolStateCompleted>
  export type ToolStateError = z.infer<typeof ToolStateError>
  export type ToolState = z.infer<typeof ToolState>
  export type ToolPartData = z.infer<typeof ToolPartData>
  export type PartData = z.infer<typeof PartData>
  export type Project = z.infer<typeof Project>
  export type Session = z.infer<typeof Session>
  export type Message = z.infer<typeof Message>
  export type Part = z.infer<typeof Part>
}
