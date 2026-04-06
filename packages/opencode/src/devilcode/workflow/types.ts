import z from "zod"

export const WorkflowStage = z.enum(["plan", "challenge", "build", "review", "ship", "retro"])
export type WorkflowStage = z.infer<typeof WorkflowStage>

export const PlanTask = z.object({
  id: z.string(),
  title: z.string(),
  role: z.string(),
  wave: z.number().int().positive(),
  dependsOn: z.array(z.string()).default([]),
  estimatedComplexity: z.enum(["low", "medium", "high"]).default("medium"),
  files: z.array(z.string()).default([]),
  verification: z.array(z.string()).default([]),
  description: z.string(),
})
export type PlanTask = z.infer<typeof PlanTask>

export const ChallengeConcernCategory = z.enum([
  "missing-dependency",
  "wrong-wave-ordering",
  "underestimated-complexity",
  "security-risk",
  "overengineered",
  "file-conflict",
  "missing-verification",
  "incorrect-assumption",
])
export type ChallengeConcernCategory = z.infer<typeof ChallengeConcernCategory>

export const ChallengeConcern = z.object({
  severity: z.enum(["critical", "moderate", "minor"]),
  category: ChallengeConcernCategory,
  description: z.string(),
  suggestedChange: z.string(),
  affectedTasks: z.array(z.string()),
})
export type ChallengeConcern = z.infer<typeof ChallengeConcern>

export const PlanChallenge = z.object({
  planId: z.string(),
  verdict: z.enum(["approved", "revise", "reject"]),
  concerns: z.array(ChallengeConcern),
  alternativeApproach: z.string().optional(),
  summary: z.string(),
})
export type PlanChallenge = z.infer<typeof PlanChallenge>

export const ReviewFinding = z.object({
  id: z.string(),
  severity: z.enum(["blocker", "warning", "suggestion"]),
  category: z.enum([
    "security",
    "correctness",
    "performance",
    "type-safety",
    "test-coverage",
    "style",
    "architecture",
    "compatibility",
  ]),
  file: z.string(),
  line: z.number().optional(),
  description: z.string(),
  suggestedFix: z.string().optional(),
  suggestedRole: z.string().optional(),
  verificationCommand: z.string().optional(),
})
export type ReviewFinding = z.infer<typeof ReviewFinding>

export const ReviewVerdict = z.object({
  verdict: z.enum(["pass", "fail", "escalate"]),
  cycle: z.number().int().positive(),
  findings: z.array(ReviewFinding),
  blockerCount: z.number().int().min(0),
  warningCount: z.number().int().min(0),
  suggestionCount: z.number().int().min(0),
  summary: z.string(),
})
export type ReviewVerdict = z.infer<typeof ReviewVerdict>

export const ActiveTask = z.object({
  id: z.string(),
  role: z.string(),
  status: z.enum(["pending", "in_progress", "completed", "escalated", "blocked", "failed"]),
})
export type ActiveTask = z.infer<typeof ActiveTask>

export const WorkflowState = z.object({
  project: z.string(),
  currentPhase: z.string(),
  currentStage: WorkflowStage,
  activeWave: z.number().int().min(0).optional(),
  totalWaves: z.number().int().min(0).optional(),
  activeTasks: z.array(ActiveTask).default([]),
  lastUpdated: z.string(),
})
export type WorkflowState = z.infer<typeof WorkflowState>
