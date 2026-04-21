/**
 * Canonical 11-position library for the workflow team model.
 *
 * Single source of truth for canonical role taxonomy. Additive to legacy TeamRole/TeamConfig
 * in config.ts — Phase 2 consumers will override presets to reference CanonicalPosition.
 *
 * See .planning/specs/01-foundation-spec.md
 */

import z from "zod"
import { CanonicalCapability } from "./capabilities"

// ---------------------------------------------------------------------------
// CanonicalPosition enum — 11 kebab-case values
// ---------------------------------------------------------------------------

export const CanonicalPosition = z.enum([
  "architect",
  "coordinator",
  "spec-writer",
  "senior-dev",
  "developer",
  "frontend-specialist",
  "backend-specialist",
  "reviewer",
  "qa-tester",
  "release-engineer",
  "researcher",
])
export type CanonicalPosition = z.infer<typeof CanonicalPosition>

// ---------------------------------------------------------------------------
// PositionLibraryEntry schema
// ---------------------------------------------------------------------------

export const PositionLibraryEntry = z
  .object({
    id: CanonicalPosition,
    displayName: z.string().min(1),
    tier: z.number().int().positive(),
    primaryCapability: CanonicalCapability,
    canonicalCapabilities: z.array(CanonicalCapability).nonempty(),
    defaultCanDelegate: z.array(CanonicalPosition).default([]),
    description: z.string().min(1),
  })
  .refine((e) => e.canonicalCapabilities.includes(e.primaryCapability), {
    message: "primaryCapability must be in canonicalCapabilities",
    path: ["primaryCapability"],
  })
export type PositionLibraryEntry = z.infer<typeof PositionLibraryEntry>

// ---------------------------------------------------------------------------
// POSITION_LIBRARY — 11 canonical entries
// ---------------------------------------------------------------------------

export const POSITION_LIBRARY: Record<CanonicalPosition, PositionLibraryEntry> = {
  architect: {
    id: "architect",
    displayName: "Architect",
    tier: 1,
    primaryCapability: "planning",
    canonicalCapabilities: ["planning", "design"],
    defaultCanDelegate: ["senior-dev", "spec-writer", "reviewer"],
    description: "Owns system design and high-level planning, delegating implementation to senior developers.",
  },
  coordinator: {
    id: "coordinator",
    displayName: "Coordinator",
    tier: 1,
    primaryCapability: "planning",
    canonicalCapabilities: ["planning", "retrospective"],
    defaultCanDelegate: [
      "architect",
      "spec-writer",
      "senior-dev",
      "developer",
      "frontend-specialist",
      "backend-specialist",
      "reviewer",
      "qa-tester",
      "release-engineer",
      "researcher",
    ],
    description:
      "Orchestrates multi-role workflows end-to-end, driving planning and retrospective ceremonies.",
  },
  "spec-writer": {
    id: "spec-writer",
    displayName: "Spec Writer",
    tier: 2,
    primaryCapability: "design",
    canonicalCapabilities: ["design"],
    defaultCanDelegate: [],
    description: "Produces detailed technical specifications and API contracts from high-level requirements.",
  },
  "senior-dev": {
    id: "senior-dev",
    displayName: "Senior Developer",
    tier: 1,
    primaryCapability: "implementation",
    canonicalCapabilities: ["implementation", "design"],
    defaultCanDelegate: ["developer", "frontend-specialist", "backend-specialist", "reviewer"],
    description:
      "Leads implementation work, contributes to design decisions, and mentors junior contributors.",
  },
  developer: {
    id: "developer",
    displayName: "Developer",
    tier: 2,
    primaryCapability: "implementation",
    canonicalCapabilities: ["implementation"],
    defaultCanDelegate: ["reviewer"],
    description: "Implements features and bug fixes within a defined scope, escalating blockers to senior roles.",
  },
  "frontend-specialist": {
    id: "frontend-specialist",
    displayName: "Frontend Specialist",
    tier: 2,
    primaryCapability: "implementation",
    canonicalCapabilities: ["implementation"],
    defaultCanDelegate: ["reviewer"],
    description: "Focuses on UI, accessibility, and client-side implementation concerns.",
  },
  "backend-specialist": {
    id: "backend-specialist",
    displayName: "Backend Specialist",
    tier: 2,
    primaryCapability: "implementation",
    canonicalCapabilities: ["implementation"],
    defaultCanDelegate: ["reviewer"],
    description: "Focuses on APIs, data storage, and server-side implementation concerns.",
  },
  reviewer: {
    id: "reviewer",
    displayName: "Reviewer",
    tier: 2,
    primaryCapability: "review",
    canonicalCapabilities: ["review"],
    defaultCanDelegate: [],
    description: "Performs code and design reviews, enforcing quality gates before changes are merged.",
  },
  "qa-tester": {
    id: "qa-tester",
    displayName: "QA Tester",
    tier: 2,
    primaryCapability: "review",
    canonicalCapabilities: ["review", "testing"],
    defaultCanDelegate: [],
    description: "Validates correctness through exploratory and structured testing, reporting defects.",
  },
  "release-engineer": {
    id: "release-engineer",
    displayName: "Release Engineer",
    tier: 2,
    primaryCapability: "release",
    canonicalCapabilities: ["release"],
    defaultCanDelegate: [],
    description: "Owns CI/CD pipelines, deployment gates, and release coordination.",
  },
  researcher: {
    id: "researcher",
    displayName: "Researcher",
    tier: 3,
    primaryCapability: "research",
    canonicalCapabilities: ["research"],
    defaultCanDelegate: [],
    description: "Conducts deep-dive investigations and synthesis tasks to inform architectural and design decisions.",
  },
}

// Compile-time exhaustiveness assertion — fails typecheck if a new CanonicalPosition
// is added without updating POSITION_LIBRARY.
const _libExhaustive: Record<CanonicalPosition, PositionLibraryEntry> = POSITION_LIBRARY
void _libExhaustive

// ---------------------------------------------------------------------------
// POSITION_CAPABILITY_MAP — derived from POSITION_LIBRARY at module load
// ---------------------------------------------------------------------------

export const POSITION_CAPABILITY_MAP: Readonly<Record<CanonicalPosition, CanonicalCapability>> = Object.freeze(
  Object.fromEntries(
    Object.entries(POSITION_LIBRARY).map(([id, entry]) => [id, entry.primaryCapability]),
  ) as Record<CanonicalPosition, CanonicalCapability>,
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the positions this role can delegate to.
 * For `coordinator`, returns all other 10 positions (it can delegate to anyone).
 * For all other positions, returns the `defaultCanDelegate` from the library entry.
 */
export function getDefaultCanDelegate(id: CanonicalPosition): CanonicalPosition[] {
  if (id === "coordinator") {
    return CanonicalPosition.options.filter((p) => p !== "coordinator")
  }
  return POSITION_LIBRARY[id].defaultCanDelegate
}

/**
 * Validates every entry in POSITION_LIBRARY against PositionLibraryEntry.
 * Throws a ZodError if any entry is malformed.
 * Call from tests or boot code to fail loudly if the library is broken.
 */
export function validatePositionLibrary(): void {
  for (const entry of Object.values(POSITION_LIBRARY)) {
    PositionLibraryEntry.parse(entry)
  }
}
