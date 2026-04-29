import z from "zod"

export const TokenAccounting = z.object({
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  totalTokens: z.number().default(0),
  secondsRunning: z.number().default(0),
})
export type TokenAccounting = z.infer<typeof TokenAccounting>

export const RateLimitSnapshot = z.object({
  requestsRemaining: z.number().optional(),
  tokensRemaining: z.number().optional(),
  resetAt: z.string().optional(),
})
export type RateLimitSnapshot = z.infer<typeof RateLimitSnapshot>

export const RunningEntry = z.object({
  issueId: z.string(),
  identifier: z.string(),
  state: z.string(),
  sessionId: z.string(),
  workspacePath: z.string(),
  turnCount: z.number().default(0),
  startedAt: z.number(),
  lastEventAt: z.number(),
  tokens: z.object({
    input: z.number().default(0),
    output: z.number().default(0),
    total: z.number().default(0),
  }),
})
export type RunningEntry = z.infer<typeof RunningEntry>

export const RetryEntry = z.object({
  issueId: z.string(),
  identifier: z.string(),
  attempt: z.number().min(1),
  dueAtMs: z.number(),
  error: z.string(),
})
export type RetryEntry = z.infer<typeof RetryEntry>
