import { describe, test, expect } from "bun:test"
import { loadQuickstartTemplates, getQuickstart, QUICKSTART_IDS } from "@/devilcode/team/quickstarts/index"
import type { QuickstartId } from "@/devilcode/team/quickstarts/index"
import { CanonicalTeamConfig } from "@/devilcode/team/config"
import { CanonicalPosition } from "@/devilcode/team/library"
import { STAGE_CAPABILITY_REQUIREMENTS } from "@/devilcode/team/capabilities"

// ---------------------------------------------------------------------------
// Quickstart bundle integrity
// ---------------------------------------------------------------------------

describe("Quickstart bundle integrity", () => {
  test("loadQuickstartTemplates returns exactly 5 entries keyed by QUICKSTART_IDS", () => {
    const templates = loadQuickstartTemplates()
    const keys = Object.keys(templates) as QuickstartId[]
    expect(keys.length).toBe(5)
    for (const id of QUICKSTART_IDS) {
      expect(keys).toContain(id)
    }
  })

  test("each template.team parses as CanonicalTeamConfig with enabled:true", () => {
    const templates = loadQuickstartTemplates()
    for (const id of QUICKSTART_IDS) {
      const template = templates[id]
      expect(template.team.enabled, `${id} team.enabled`).toBe(true)
      const result = CanonicalTeamConfig.safeParse(template.team)
      expect(result.success, `${id} CanonicalTeamConfig parse: ${!result.success ? result.error.message : "ok"}`).toBe(
        true,
      )
    }
  })

  test("each template's _meta.notes is non-empty", () => {
    const templates = loadQuickstartTemplates()
    for (const id of QUICKSTART_IDS) {
      expect(templates[id]._meta.notes.length, `${id} _meta.notes`).toBeGreaterThan(0)
    }
  })

  test("each template's id matches QUICKSTART_IDS", () => {
    const templates = loadQuickstartTemplates()
    for (const id of QUICKSTART_IDS) {
      expect(templates[id].id).toBe(id)
    }
  })

  test("getQuickstart returns undefined for unknown id", () => {
    const result = getQuickstart("totally-unknown-quickstart-xyz")
    expect(result).toBeUndefined()
  })

  test("getQuickstart('solo-enhanced') returns the template", () => {
    const result = getQuickstart("solo-enhanced")
    expect(result).toBeDefined()
    expect(result?.id).toBe("solo-enhanced")
  })

  test("every template's routing.defaultRole is a valid role key", () => {
    const templates = loadQuickstartTemplates()
    for (const id of QUICKSTART_IDS) {
      const team = templates[id].team
      expect(
        team.routing.defaultRole in team.roles,
        `${id} routing.defaultRole '${team.routing.defaultRole}' must be in roles`,
      ).toBe(true)
    }
  })

  test("every template's roles record has keys matching valid CanonicalPositions", () => {
    const templates = loadQuickstartTemplates()
    const validPositions = new Set(CanonicalPosition.options)
    for (const id of QUICKSTART_IDS) {
      const roleKeys = Object.keys(templates[id].team.roles)
      for (const key of roleKeys) {
        expect(validPositions.has(key as CanonicalPosition), `${id} role key '${key}' must be CanonicalPosition`).toBe(
          true,
        )
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Quickstart coverage matrix (5 quickstarts × 7 stages = 35 assertions)
// ---------------------------------------------------------------------------

describe("Quickstart coverage matrix", () => {
  const templates = loadQuickstartTemplates()
  const stageEntries = Object.entries(STAGE_CAPABILITY_REQUIREMENTS) as [string, string][]

  for (const id of QUICKSTART_IDS) {
    for (const [stage, cap] of stageEntries) {
      test(`${id} covers stage '${stage}' (capability: ${cap})`, () => {
        const roles = Object.values(templates[id].team.roles)
        const covered = roles.some((r) => (r.capabilities as string[]).includes(cap))
        expect(covered, `${id}: no role covers stage '${stage}' (${cap})`).toBe(true)
      })
    }
  }
})

// ---------------------------------------------------------------------------
// Quickstart tier preservation (5 assertions)
// ---------------------------------------------------------------------------

describe("Quickstart tier preservation", () => {
  // Expected count of tier-1 roles per quickstart, based on authored JSON files.
  // solo-enhanced: senior-dev(1) + coordinator(1) = 2
  // code-review-pair: senior-dev(1) + coordinator(1) + architect(1) = 3
  // full-stack-team: architect(1) + coordinator(1) = 2
  // ci-cd-pipeline: release-engineer(1) + coordinator(1) + architect(1) = 3
  // research-team: coordinator(1) + senior-dev(1) + architect(1) = 3
  const EXPECTED_PRIMARIES: Record<QuickstartId, number> = {
    "solo-enhanced": 2,
    "code-review-pair": 3,
    "full-stack-team": 2,
    "ci-cd-pipeline": 3,
    "research-team": 3,
  }

  const templates = loadQuickstartTemplates()

  for (const id of QUICKSTART_IDS) {
    test(`${id} has ${EXPECTED_PRIMARIES[id]} tier-1 role(s)`, () => {
      const tier1Count = Object.values(templates[id].team.roles).filter((r) => r.tier === 1).length
      expect(tier1Count).toBe(EXPECTED_PRIMARIES[id])
    })
  }
})

// ---------------------------------------------------------------------------
// Quickstart parent-role determinism (5 assertions)
// ---------------------------------------------------------------------------

describe("Quickstart parent-role determinism", () => {
  // findParentRole-mirror: first tier-1 role in Object.keys(team.roles) insertion order.
  // Expected winners based on authored JSON role ordering:
  // solo-enhanced:      first key is 'senior-dev'
  // code-review-pair:   first key is 'senior-dev'
  // full-stack-team:    first key is 'architect'
  // ci-cd-pipeline:     first key is 'release-engineer'
  // research-team:      first key is 'coordinator'
  const EXPECTED_PARENT: Record<QuickstartId, string> = {
    "solo-enhanced": "senior-dev",
    "code-review-pair": "senior-dev",
    "full-stack-team": "architect",
    "ci-cd-pipeline": "release-engineer",
    "research-team": "coordinator",
  }

  const templates = loadQuickstartTemplates()

  for (const id of QUICKSTART_IDS) {
    test(`${id} parent role (first tier-1 in insertion order) is '${EXPECTED_PARENT[id]}'`, () => {
      const roles = templates[id].team.roles
      const parentRole = Object.entries(roles).find(([, r]) => r.tier === 1)?.[0]
      expect(parentRole).toBe(EXPECTED_PARENT[id])
    })
  }
})
