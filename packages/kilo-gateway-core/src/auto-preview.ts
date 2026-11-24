// Placeholder Auto Model preview classifier until the Cloud preview endpoint ships.
// Keeps the exact contract shape of `KiloGatewayRpc.AutoModelPreviewResult` so the plugin can
// swap this local stub for a Cloud request without changing clients.

export type Profile = "efficient" | "frontier"
export type RiskLevel = "low" | "medium" | "high"
export type TaskFit = "low" | "medium" | "high" | "very_high"

export interface CurrentModel {
  readonly providerID: string
  readonly id: string
  readonly name?: string
  readonly cost?: {
    readonly input: number
    readonly output: number
  }
}

export interface PreviewInput {
  readonly prompt: string
  readonly agent?: string
  readonly currentModel?: CurrentModel
  readonly profile?: Profile
}

export interface PreviewRisk {
  readonly level: RiskLevel
  readonly detail?: string
}

export interface PreviewAttributes {
  readonly contextComplexity: string | null
  readonly reasoningComplexity: string | null
  readonly risk: PreviewRisk | null
  readonly executionMode: string | null
  readonly toolsRequired: boolean | null
}

export interface PreviewCandidate {
  readonly modelID: string
  readonly modelName: string
  readonly estimatedCostUsd: number | null
  readonly taskFit: TaskFit
  readonly predicted: boolean
  readonly current?: boolean
}

export interface PreviewRecommendation {
  readonly suggestedProfile: Profile
  readonly reason: string
}

export interface PreviewResult {
  readonly profile: Profile
  readonly task: {
    readonly category: string
    readonly summary: string
  }
  readonly attributes: PreviewAttributes
  readonly selection: {
    readonly modelID: string
    readonly modelName: string
    readonly rationale: string
  }
  readonly candidates: readonly PreviewCandidate[]
  readonly recommendation: PreviewRecommendation | null
  readonly illustrative: boolean
}

interface CandidateSeed {
  readonly modelID: string
  readonly modelName: string
  readonly matchers: readonly string[]
  readonly estimatedCostUsd: number
  readonly taskFit: TaskFit
}

interface Scenario {
  readonly task: {
    readonly category: string
    readonly summary: string
  }
  readonly attributes: PreviewAttributes
  readonly tokens: { readonly input: number; readonly output: number }
  readonly efficientID: string
  readonly frontierID: string
  readonly efficientRationale: string
  readonly frontierRationale: string
  readonly candidates: readonly CandidateSeed[]
  readonly efficientRecommendation: PreviewRecommendation
  readonly frontierRecommendation: PreviewRecommendation
}

const SONNET = "anthropic/claude-sonnet-4.6"
const OPUS = "anthropic/claude-opus-4.6"
const FLASH = "google/gemini-2.5-flash"

const MATCHERS: Record<string, readonly string[]> = {
  [SONNET]: ["claude-sonnet", "sonnet"],
  [OPUS]: ["claude-opus", "opus"],
  [FLASH]: ["gemini-2.5-flash", "gemini-flash", "flash"],
}

function candidate(modelID: string, modelName: string, estimatedCostUsd: number, taskFit: TaskFit): CandidateSeed {
  return { modelID, modelName, matchers: MATCHERS[modelID] ?? [modelID], estimatedCostUsd, taskFit }
}

const SECURITY_PATTERN =
  /\b(auth|authentication|authorize|authorization|token|jwt|oauth|password|secret|credential|crypto|encrypt|permission|rbac|security|csrf|xss)\b/i
const ARCHITECTURE_PATTERN =
  /\b(architect|architecture|migrate|migration|schema|distributed|concurrency|multi-?file|rewrite|redesign|system design)\b/i
const DEBUG_PATTERN =
  /\b(bug|fix|crash|error|exception|failing|failure|broken|stack trace|debug|race condition|regression|investigate)\b/i
const QUESTION_PATTERN =
  /^\s*(what|why|how|explain|describe|summarize|list|compare|where|when|does|is|can)\b|\b(readme|docs|documentation|typo|comment)\b/i
const REFACTOR_TEST_PATTERN = /\b(refactor|test|tests|unit test|coverage|helper|cleanup)\b/i

function securityScenario(prompt: string): Scenario {
  const auth = /\b(auth|authentication|token|jwt|oauth|password|credential)\b/i.test(prompt)
  const refactorOrTest = REFACTOR_TEST_PATTERN.test(prompt)
  return {
    task: refactorOrTest
      ? {
          category: "Code refactoring & tests",
          summary: "Updating existing code and adding test coverage",
        }
      : {
          category: "Security-sensitive code change",
          summary: "Modifying security-critical logic with careful verification",
        },
    attributes: {
      contextComplexity: "Medium",
      reasoningComplexity: "Medium",
      risk: { level: "high", detail: auth ? "authentication" : "security" },
      executionMode: "Code change",
      toolsRequired: true,
    },
    tokens: { input: 10_000, output: 1_500 },
    efficientID: SONNET,
    frontierID: OPUS,
    efficientRationale:
      "A good fit for a focused code change: strong coding performance at a lower estimated cost.",
    frontierRationale:
      "Highest task fit for security-sensitive work where extra verification justifies higher estimated cost.",
    candidates: [
      candidate(SONNET, "Claude Sonnet", 0.04, "high"),
      candidate(OPUS, "Claude Opus", 0.16, "very_high"),
      candidate(FLASH, "Gemini Flash", 0.01, "medium"),
    ],
    efficientRecommendation: {
      suggestedProfile: "frontier",
      reason: "for this security-sensitive change if you value the extra task fit over the higher estimated cost.",
    },
    frontierRecommendation: {
      suggestedProfile: "efficient",
      reason: "if the change is well-scoped with existing tests and you prefer lower estimated cost.",
    },
  }
}

function architectureScenario(): Scenario {
  return {
    task: {
      category: "Architecture & system design",
      summary: "Planning cross-cutting structural changes with trade-off analysis",
    },
    attributes: {
      contextComplexity: "High",
      reasoningComplexity: "High",
      risk: { level: "medium", detail: "broad blast radius" },
      executionMode: "Planning & code change",
      toolsRequired: true,
    },
    tokens: { input: 16_000, output: 2_400 },
    efficientID: SONNET,
    frontierID: OPUS,
    efficientRationale:
      "Balances strong architectural reasoning against a significantly lower estimated cost than frontier models.",
    frontierRationale:
      "Best suited for deep multi-file design trade-offs where maximum reasoning accuracy reduces rework.",
    candidates: [
      candidate(SONNET, "Claude Sonnet", 0.06, "high"),
      candidate(OPUS, "Claude Opus", 0.24, "very_high"),
      candidate(FLASH, "Gemini Flash", 0.02, "low"),
    ],
    efficientRecommendation: {
      suggestedProfile: "frontier",
      reason: "for high-reasoning architectural work where deeper planning helps avoid costly rework.",
    },
    frontierRecommendation: {
      suggestedProfile: "efficient",
      reason: "once the architecture is settled and you move into narrower implementation steps.",
    },
  }
}

function debugScenario(): Scenario {
  return {
    task: {
      category: "Debugging & bug fix",
      summary: "Investigating a failure path and applying a targeted fix",
    },
    attributes: {
      contextComplexity: "Medium",
      reasoningComplexity: "High",
      risk: { level: "medium", detail: "regression risk" },
      executionMode: "Investigation & fix",
      toolsRequired: true,
    },
    tokens: { input: 10_000, output: 1_500 },
    efficientID: SONNET,
    frontierID: OPUS,
    efficientRationale:
      "Strong tool-assisted debugging and patch accuracy without paying frontier rates for iterative checks.",
    frontierRationale:
      "Provides extra reasoning headroom for subtle root-cause analysis across multiple interacting components.",
    candidates: [
      candidate(SONNET, "Claude Sonnet", 0.04, "high"),
      candidate(OPUS, "Claude Opus", 0.15, "very_high"),
      candidate(FLASH, "Gemini Flash", 0.01, "medium"),
    ],
    efficientRecommendation: {
      suggestedProfile: "efficient",
      reason: "for targeted debugging where iterative tool verification delivers high accuracy at lower cost.",
    },
    frontierRecommendation: {
      suggestedProfile: "efficient",
      reason: "unless the bug spans complex concurrency or subtle state interactions.",
    },
  }
}

function questionScenario(): Scenario {
  return {
    task: {
      category: "Explanation & Q&A",
      summary: "Answering a focused question without modifying code",
    },
    attributes: {
      contextComplexity: "Low",
      reasoningComplexity: "Low",
      risk: { level: "low" },
      executionMode: "Read-only answer",
      toolsRequired: false,
    },
    tokens: { input: 4_000, output: 800 },
    efficientID: FLASH,
    frontierID: SONNET,
    efficientRationale:
      "Fast, accurate response for a lightweight read-only prompt at a fraction of frontier model cost.",
    frontierRationale:
      "Delivers more detailed synthesis when nuance matters, though a lighter model already covers this task well.",
    candidates: [
      candidate(FLASH, "Gemini Flash", 0.01, "high"),
      candidate(SONNET, "Claude Sonnet", 0.04, "very_high"),
      candidate(OPUS, "Claude Opus", 0.14, "very_high"),
    ],
    efficientRecommendation: {
      suggestedProfile: "efficient",
      reason: "for fast, low-risk questions where a lightweight model delivers strong answers at minimal cost.",
    },
    frontierRecommendation: {
      suggestedProfile: "efficient",
      reason: "since read-only questions rarely benefit from frontier-tier pricing.",
    },
  }
}

function generalScenario(): Scenario {
  return {
    task: {
      category: "Focused code change",
      summary: "Implementing a scoped update in the workspace",
    },
    attributes: {
      contextComplexity: "Medium",
      reasoningComplexity: "Medium",
      risk: { level: "low" },
      executionMode: "Code change",
      toolsRequired: true,
    },
    tokens: { input: 8_000, output: 1_200 },
    efficientID: SONNET,
    frontierID: OPUS,
    efficientRationale:
      "A strong balance of coding accuracy and lower estimated cost for a scoped implementation task.",
    frontierRationale:
      "Offers top task fit when you want maximum reasoning quality despite the higher estimated cost.",
    candidates: [
      candidate(SONNET, "Claude Sonnet", 0.03, "high"),
      candidate(OPUS, "Claude Opus", 0.14, "very_high"),
      candidate(FLASH, "Gemini Flash", 0.01, "medium"),
    ],
    efficientRecommendation: {
      suggestedProfile: "efficient",
      reason: "for routine coding tasks where a balanced model keeps quality high while reducing spend.",
    },
    frontierRecommendation: {
      suggestedProfile: "efficient",
      reason: "to reduce spend on well-scoped changes while maintaining strong coding quality.",
    },
  }
}

function classify(prompt: string, agent?: string): Scenario {
  if (agent === "ask") return questionScenario()
  if (SECURITY_PATTERN.test(prompt)) return securityScenario(prompt)
  if (ARCHITECTURE_PATTERN.test(prompt)) return architectureScenario()
  if (DEBUG_PATTERN.test(prompt)) return debugScenario()
  if (QUESTION_PATTERN.test(prompt)) return questionScenario()
  return generalScenario()
}

function matchesCurrent(seed: CandidateSeed, current: CurrentModel | undefined): boolean {
  if (!current) return false
  const haystack = `${current.id} ${current.name ?? ""}`.toLowerCase()
  return seed.matchers.some((token) => haystack.includes(token))
}

function estimateCost(current: CurrentModel, tokens: { readonly input: number; readonly output: number }): number | null {
  if (!current.cost) return null
  const raw = (current.cost.input * tokens.input + current.cost.output * tokens.output) / 1_000_000
  if (!Number.isFinite(raw) || raw < 0) return null
  if (raw === 0) return 0
  return Math.max(0.01, Math.round(raw * 100) / 100)
}

function estimateFit(current: CurrentModel): TaskFit {
  const value = `${current.id} ${current.name ?? ""}`.toLowerCase()
  if (/(opus|o3|gpt-5|pro|reasoning|max)/.test(value)) return "very_high"
  if (/(mini|flash|haiku|nano|lite|small)/.test(value)) return "medium"
  return "high"
}

/**
 * Generates an illustrative Auto Model routing preview for the given prompt and optional explicit model.
 * Will be backed by the Cloud auto-routing preview API once available.
 */
export function preview(input: PreviewInput): PreviewResult {
  const profile: Profile = input.profile ?? "efficient"
  const scenario = classify(input.prompt.trim(), input.agent)
  const predictedID = profile === "frontier" ? scenario.frontierID : scenario.efficientID
  const matched = scenario.candidates.some((seed) => matchesCurrent(seed, input.currentModel))
  const candidates: PreviewCandidate[] = scenario.candidates.map((seed) => ({
    modelID: seed.modelID,
    modelName: seed.modelName,
    estimatedCostUsd: seed.estimatedCostUsd,
    taskFit: seed.taskFit,
    predicted: seed.modelID === predictedID,
    ...(matchesCurrent(seed, input.currentModel) ? { current: true } : {}),
  }))
  const current = input.currentModel
  if (current && !matched) {
    candidates.push({
      modelID: current.id,
      modelName: current.name?.trim() || current.id,
      estimatedCostUsd: estimateCost(current, scenario.tokens),
      taskFit: estimateFit(current),
      predicted: false,
      current: true,
    })
  }
  const picked = candidates.find((item) => item.predicted) ?? candidates[0]!
  return {
    profile,
    task: scenario.task,
    attributes: scenario.attributes,
    selection: {
      modelID: picked.modelID,
      modelName: picked.modelName,
      rationale: profile === "frontier" ? scenario.frontierRationale : scenario.efficientRationale,
    },
    candidates,
    recommendation: profile === "frontier" ? scenario.frontierRecommendation : scenario.efficientRecommendation,
    illustrative: true,
  }
}
