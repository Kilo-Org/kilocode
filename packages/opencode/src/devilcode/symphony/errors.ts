import z from "zod"
import { NamedError } from "@opencode-ai/util/error"

export const SymphonyConfigError = NamedError.create(
  "SymphonyConfigError",
  z.object({
    message: z.string(),
    path: z.string().optional(),
  }),
)

export const SymphonyTrackerError = NamedError.create(
  "SymphonyTrackerError",
  z.object({
    message: z.string(),
    statusCode: z.number().optional(),
    graphqlErrors: z.array(z.unknown()).optional(),
  }),
)

export const SymphonyWorkspaceError = NamedError.create(
  "SymphonyWorkspaceError",
  z.object({
    message: z.string(),
    workspacePath: z.string().optional(),
    hook: z.string().optional(),
  }),
)

export const SymphonyDispatchError = NamedError.create(
  "SymphonyDispatchError",
  z.object({
    message: z.string(),
    issueIdentifier: z.string().optional(),
  }),
)

export const SymphonyStallError = NamedError.create(
  "SymphonyStallError",
  z.object({
    message: z.string(),
    issueIdentifier: z.string(),
    lastEventAt: z.number(),
    stallTimeoutMs: z.number(),
  }),
)
