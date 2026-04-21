import z from "zod"
import { CanonicalTeamConfig } from "../config"
import soloEnhanced from "./solo-enhanced.json" with { type: "json" }
import codeReviewPair from "./code-review-pair.json" with { type: "json" }
import fullStackTeam from "./full-stack-team.json" with { type: "json" }
import ciCdPipeline from "./ci-cd-pipeline.json" with { type: "json" }
import researchTeam from "./research-team.json" with { type: "json" }

export const QUICKSTART_IDS = [
  "solo-enhanced",
  "code-review-pair",
  "full-stack-team",
  "ci-cd-pipeline",
  "research-team",
] as const
export type QuickstartId = (typeof QUICKSTART_IDS)[number]

const QuickstartFile = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  team: CanonicalTeamConfig,
  _meta: z.object({
    migratedFrom: z.string(),
    addedRoles: z.array(z.string()),
    tierOverrides: z.array(z.string()).default([]),
    notes: z.string(),
  }),
})
export type QuickstartTemplate = z.infer<typeof QuickstartFile>

const RAW_TEMPLATES: Record<QuickstartId, unknown> = {
  "solo-enhanced": soloEnhanced,
  "code-review-pair": codeReviewPair,
  "full-stack-team": fullStackTeam,
  "ci-cd-pipeline": ciCdPipeline,
  "research-team": researchTeam,
}

let cache: Record<QuickstartId, QuickstartTemplate> | null = null

export function loadQuickstartTemplates(): Record<QuickstartId, QuickstartTemplate> {
  if (cache) return cache
  const result = {} as Record<QuickstartId, QuickstartTemplate>
  for (const id of QUICKSTART_IDS) {
    result[id] = QuickstartFile.parse(RAW_TEMPLATES[id])
  }
  cache = result
  return cache
}

export function getQuickstart(id: string): QuickstartTemplate | undefined {
  return loadQuickstartTemplates()[id as QuickstartId]
}
