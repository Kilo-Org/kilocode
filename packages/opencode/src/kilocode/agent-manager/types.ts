import z from "zod"
import { MessageV2 } from "@/session/message-v2"

export namespace AgentManagerTypes {
  export const Model = z
    .object({
      providerID: z.string(),
      modelID: z.string(),
    })
    .meta({
      ref: "AgentManagerModel",
    })

  export const ModelInput = z
    .union([z.string().describe("Model in provider/model format"), Model])
    .optional()
    .meta({
      ref: "AgentManagerModelInput",
    })

  export const Version = z
    .object({
      label: z.string().optional().describe("Display label for this variant"),
      name: z.string().optional().describe("Optional branch/worktree name hint for this variant"),
      prompt: z.string().optional().describe("Optional prompt override for this variant"),
      agent: z.string().optional().describe("Optional agent override for this variant"),
      model: ModelInput,
    })
    .meta({
      ref: "AgentManagerVersion",
    })

  export const CreateInput = z
    .object({
      name: z.string().optional().describe("Optional base name used when creating branches/worktrees"),
      prompt: z.string().optional().describe("Initial prompt applied to all variants unless overridden"),
      baseBranch: z.string().optional().describe("Base branch or ref to branch from"),
      agent: z.string().optional().describe("Default agent for all variants"),
      model: ModelInput,
      versions: z.array(Version).min(1).max(4).optional().describe("Optional per-variant configuration"),
    })
    .meta({
      ref: "AgentManagerCreateInput",
    })
  export type CreateInput = z.infer<typeof CreateInput>

  export const Worktree = z
    .object({
      id: z.string(),
      path: z.string(),
      branch: z.string(),
      baseBranch: z.string(),
    })
    .meta({
      ref: "AgentManagerWorktree",
    })
  export type Worktree = z.infer<typeof Worktree>

  export const Summary = z
    .object({
      additions: z.number(),
      deletions: z.number(),
      files: z.number(),
    })
    .optional()

  export const Session = z
    .object({
      sessionID: z.string(),
      groupID: z.string().optional(),
      worktree: Worktree,
      title: z.string().optional(),
      agent: z.string(),
      model: z.string().optional(),
      label: z.string().optional(),
      status: z.enum(["idle", "busy", "error"]),
      summary: Summary,
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .meta({
      ref: "AgentManagerSession",
    })
  export type Session = z.infer<typeof Session>

  export const SessionRecord = z
    .object({
      sessionID: z.string(),
      groupID: z.string().optional(),
      worktree: Worktree,
      agent: z.string(),
      model: z.string().optional(),
      label: z.string().optional(),
      failed: z.boolean().optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .meta({
      ref: "AgentManagerSessionRecord",
    })
  export type SessionRecord = z.infer<typeof SessionRecord>

  export const CreateOutput = z
    .object({
      groupID: z.string().optional(),
      sessions: z.array(Session),
    })
    .meta({
      ref: "AgentManagerCreateOutput",
    })
  export type CreateOutput = z.infer<typeof CreateOutput>

  export const ListInput = z
    .object({
      groupID: z.string().optional(),
      status: z.enum(["idle", "busy", "error"]).optional(),
      limit: z.coerce.number().optional(),
      cursor: z.string().optional(),
    })
    .meta({
      ref: "AgentManagerListInput",
    })
  export type ListInput = z.infer<typeof ListInput>

  export const ListOutput = z
    .object({
      sessions: z.array(Session),
      cursor: z.string().optional(),
    })
    .meta({
      ref: "AgentManagerListOutput",
    })
  export type ListOutput = z.infer<typeof ListOutput>

  export const DetailInput = z
    .object({
      sessionID: z.string(),
      limit: z.coerce.number().optional(),
    })
    .meta({
      ref: "AgentManagerDetailInput",
    })
  export type DetailInput = z.infer<typeof DetailInput>

  export const DetailOutput = z
    .object({
      session: Session,
      messages: z.array(MessageV2.WithParts),
    })
    .meta({
      ref: "AgentManagerDetailOutput",
    })
  export type DetailOutput = z.infer<typeof DetailOutput>

  export const CancelInput = z
    .object({
      sessionID: z.string(),
    })
    .meta({
      ref: "AgentManagerCancelInput",
    })
  export type CancelInput = z.infer<typeof CancelInput>

  export const DiffInput = z
    .object({
      sessionID: z.string(),
      cursor: z.string().optional(),
      limit: z.coerce.number().optional(),
      includePatch: z.coerce.boolean().optional(),
    })
    .meta({
      ref: "AgentManagerDiffInput",
    })
  export type DiffInput = z.infer<typeof DiffInput>

  export const DiffFile = z
    .object({
      path: z.string(),
      status: z.enum(["added", "modified", "deleted"]),
      additions: z.number(),
      deletions: z.number(),
      patch: z.string().optional(),
      patchTruncated: z.boolean().optional(),
    })
    .meta({
      ref: "AgentManagerDiffFile",
    })
  export type DiffFile = z.infer<typeof DiffFile>

  export const DiffOutput = z
    .object({
      files: z.array(DiffFile),
      summary: z.object({
        totalFiles: z.number(),
        totalAdditions: z.number(),
        totalDeletions: z.number(),
      }),
      cursor: z.string().optional(),
    })
    .meta({
      ref: "AgentManagerDiffOutput",
    })
  export type DiffOutput = z.infer<typeof DiffOutput>

  export const CreatedEvent = z
    .object({
      sessionID: z.string(),
      groupID: z.string().optional(),
      worktree: Worktree,
      model: z.string().optional(),
      label: z.string().optional(),
    })
    .meta({
      ref: "AgentManagerSessionCreatedEvent",
    })
}
